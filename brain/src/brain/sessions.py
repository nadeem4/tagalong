"""The one conversation: shared history and at most one running turn.
Every source saves an event (a say, a timer, a job's question or result); the runner alone
picks the next events and hands them here to start a turn (`start_events`), and a say on the
running turn's body joins it at its next step. A turn's end goes back to the runner.

Turn bookkeeping lives in a done callback, not in the task body, so `ended` is sent and the
turn cleared even if the task is cancelled before it ever ran.
"""

import asyncio
import json
import logging
import sqlite3
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from brain.app_tools import AppSource, app_home_tools
from brain.approvals import Approvals, approval_home_tools
from brain.apps import Apps, TokenFile
from brain.asks import Asks
from brain.bodies import Bodies
from brain.builtin_guards import (
    spend_guards,
    wake_caps,
)
from brain.choices import Choices
from brain.config import (
    DEFAULT_JOB_STEPS_MAX_BYTES,
    DEFAULT_JOB_STEPS_MAX_ENTRIES,
    DEFAULT_KEEP_ASKING_DAYS,
    DEFAULT_OFFER_MIN_APPROVALS,
    DEFAULT_OFFER_WINDOW_DAYS,
    DEFAULT_OUTPUTS_KEEP,
    DEFAULT_TOOL_PREVIEW_CHARS,
    DEFAULT_TURN_TIMEOUT_S,
    DEFAULT_WAKES_PER_HOUR,
    DEFAULT_WORK_KEEP_DAYS,
)
from brain.events import (
    EVENT_KINDS,
    Event,
    EventKind,
    EventLog,
    from_body,
    from_connect,
)
from brain.expert_apps import ExpertApps
from brain.experts import ExpertHosts, ExpertRun
from brain.holds import Holds
from brain.job_records import Job, JobRecords
from brain.jobs import Jobs
from brain.know import offer
from brain.know.runner import KnowMeRunner
from brain.know.source import default_sources
from brain.know.tools import know_me_tools
from brain.loops.service import LoopService
from brain.masking import Masker, mask_json, mask_message, mask_secrets
from brain.memory import Memory
from brain.mind.capabilities import AppCaps, BodyCaps, ExpertCaps, capability_picture
from brain.mind.prompt import (
    INTERRUPTED_MARK,
    check_part_sizes,
    ear_note,
    interjection_block,
    interruption_block,
    render_know,
    render_preferences,
    system_prompt,
    user_content,
)
from brain.mind.resume import rebuild_history
from brain.mind.turn import Call, Model, run_turn
from brain.models import DEFAULT_MODEL_ID
from brain.offers import Offers, OfferSettings
from brain.open_item_runner import AskRunner
from brain.open_items import OpenItems
from brain.outputs import OutputStore
from brain.permission import (
    ASK_WAIT_MIN,
    Engine,
    Person,
    SideCheckDecider,
    StandingRule,
    stored_auto_rules,
)
from brain.presence import Presence
from brain.protocol import (
    BODY_DESKTOP,
    ErrorCode,
    ReadAloudData,
    ReadingData,
    RpcError,
    SayParams,
    Tool,
)
from brain.questions import ScoutQuestions
from brain.reading import ReadingStore
from brain.reading_tools import reading_home_tools
from brain.retry import classify, safe_to_retry
from brain.runner import Runner, wake_text
from brain.setup.store import InstalledExpert
from brain.side_check import SideCheck
from brain.speech_tools import interject
from brain.store import rules
from brain.store.conversation import compaction_text
from brain.store.db import transaction
from brain.store.events import EventRow
from brain.store.work import TransitionRefused, WorkRow, WorkStore
from brain.task_tools import task_tools
from brain.tasks import Tasks, TaskStopHooks
from brain.tasks_tools import tasks_tools
from brain.timers import Timers
from brain.timers_home import timer_home_tools
from brain.toolbox import SEP, BodySource, BrainSource, Handler, Toolbox, ToolSpec
from brain.tools import (
    KeySettings,
    brain_tools,
    choice_tools,
    expert_tools,
    home_tools,
    model_tools,
    output_tools,
    preference_tools,
    question_tools,
    timer_tools,
    voice_tools,
    work_tools,
)
from brain.voice import VoiceHooks
from brain.voice.stt_tools import stt_tools
from brain.voice.tts_tools import tts_tools
from brain.web_tools import WebSource, without_server_blocks, without_thinking

log = logging.getLogger("brain")

# Tools that name a job: they bind an unbound turn to it and are recorded on it.
JOB_TOOLS = frozenset({"hand_off", "tell_expert", "stop_job", "close_job", "set_job_result"})
# Job bookkeeping Scout does about the job, not work for it: never on the timeline.
BOOKKEEPING_TOOLS = frozenset({"set_job_result", "watch_job", "work_status"})
_ARGS_CAP = 20_000  # raw characters of arguments looked at; the entry is masked, then clipped
# Tools that manage the goal itself are not steps of it, so they leave no work row.
_NOT_STEPS = JOB_TOOLS | {"resolve_step"}
_SUMMARY_CAP = 300  # characters of a tool result kept on its work row
_LATE_RESULT_CAP = 2000  # characters of a late tool result put in the news about it
_STEP_STATUS = {"ok": "done", "failed": "failed", "refused": "refused"}
# A resumed say is named by this much of its first line; its full words are in the history.
_GIST_CAP = 80
STOP_TURN_WAIT_S = 5.0  # a turn that ignores its cancel must not keep the brain open
INTERJECTION_TIMEOUT_S = 5.0  # the voice is paused meanwhile, so a slow call must not keep it


def _named(row: EventRow) -> EventRow:
    """A resumed row without its payload; a say keeps a short first line to be known by."""
    if row.kind != "say":
        return replace(row, payload={})
    first = row.payload.get("params", {}).get("text", "").split("\n", 1)[0]
    gist = first if len(first) <= _GIST_CAP else first[: _GIST_CAP - 1] + "…"
    return replace(row, payload={"text": gist})


@dataclass(frozen=True)
class Interruption:
    """The owner talked over a spoken turn: what the body finished playing, and what was left."""

    spoken: str
    unsaid: str


DEFAULT_OFFER_SETTINGS = OfferSettings(
    DEFAULT_OFFER_MIN_APPROVALS, DEFAULT_OFFER_WINDOW_DAYS, DEFAULT_KEEP_ASKING_DAYS
)


class Session:
    def __init__(
        self,
        model: Model,
        budget,
        bodies: Bodies,
        step_cap: int,
        memory: Memory,
        *,
        events: EventLog,
        now: Callable[[], datetime] = lambda: datetime.now().astimezone(),
        make_run: Callable[..., ExpertRun] | None = None,
        experts: Callable[[], list[InstalledExpert]] | None = None,
        apps: Apps | None = None,
        before_job: Callable[[], Awaitable[None]] | None = None,
        tokens: TokenFile | None = None,
        wakes_per_hour: int = DEFAULT_WAKES_PER_HOUR,
        kinds: dict[str, EventKind] | None = None,
        quiet: Callable[[datetime], bool] | None = None,
        offers: OfferSettings = DEFAULT_OFFER_SETTINGS,
        turn_timeout: float = DEFAULT_TURN_TIMEOUT_S,
        masker: Masker | None = None,
        keys: KeySettings | None = None,
        model_default: str = DEFAULT_MODEL_ID,  # TAGALONG_MODEL; a saved choice overrides it
        stt_default: tuple[str | None, str | None] = (None, None),  # TAGALONG_STT_LIVE, _FINAL
        voice_dir: Path = Path("voice"),  # <TAGALONG_HOME>/voice, where voices are installed
        extra_tools: list[tuple[ToolSpec, Handler]] | None = None,
        setup_facts: Callable[[], Awaitable[dict]] | None = None,
        preview_chars: int = DEFAULT_TOOL_PREVIEW_CHARS,
        job_steps_max_entries: int = DEFAULT_JOB_STEPS_MAX_ENTRIES,
        job_steps_max_bytes: int = DEFAULT_JOB_STEPS_MAX_BYTES,
        work_keep_days: int = DEFAULT_WORK_KEEP_DAYS,
        outputs_keep: int = DEFAULT_OUTPUTS_KEEP,
        know_sources: list | None = None,  # tests pass fakes; None reads GitHub, PDF and the web
    ) -> None:
        self._model = model
        self.reading = ReadingStore()  # how the connected body reads the screen, for Home
        self._apps_live = apps  # read each turn for the capability picture
        self._experts_live = experts or (lambda: [])
        # Set by main when voice is built; None answers `listen` with method_not_found.
        self.voice: VoiceHooks | None = None
        # Set by main: the loops service, which also hears focus and tab to surface held loops.
        self.loops: LoopService | None = None
        # Set by main: what each Watch task stands for (mail reading, update checks) is switched
        # off by the part that owns it when the task is stopped.
        self.watch_stops: list[Callable[[str], None]] = []
        self._budget = budget
        self._bodies = bodies
        self._step_cap = step_cap
        self._turn_timeout = turn_timeout
        self._memory = memory
        # One WorkStore for the jobs, asks, questions and the ask log: a job that ends takes its
        # open asks and questions with it, which only holds when they share the store's hooks.
        work = WorkStore(memory.db, now, lambda text: mask_json(self.guards, "work", text))
        self._asks = Asks(bodies)
        # One set of spend guards for the loop, the runner, the side-check and offers.
        self.guards = spend_guards(budget, step_cap)
        self.guards.add(wake_caps(wakes_per_hour))
        if masker is not None:  # what reaches disk (chat, approvals, job results) is masked
            self.guards.add(mask_secrets(masker))
        memory.mask = lambda text: mask_json(self.guards, "memory", text)
        # Everything said to Scout and every wake is saved here before anything acts on it.
        self.events = events
        # Long tool results and expert reports reach the model as a capped preview; the full text
        # is stored masked for read_output. At startup finished work goes first (with the reports
        # it points at), then the oldest outputs nothing points at. Handled events and ended
        # tasks are swept after the Asks settle below.
        outputs = OutputStore(memory, self.guards, preview_chars)
        work.sweep(work_keep_days)
        outputs.prune(outputs_keep)
        notify = bodies.notify
        # main passes the installed experts and the quiet threshold; the defaults keep tests short.
        make_run = make_run or ExpertHosts()
        # Built first: the questions and the timers emit through it. It only calls back into the
        # session once an event arrives, by which time the rest of __init__ has run.
        questions = ScoutQuestions(
            self.post_event, work, lambda: self.ready() and not self.runner.over_budget()
        )
        approvals = self.approvals = Approvals(memory, work, notify, now, guards=self.guards)
        # Scout's look before an ask reaches the person; shares the session's model and budget.
        side_check = SideCheck(model, budget, memory, work, guards=self.guards)
        items = self.items = OpenItems(memory.db, now)
        # The one place that decides which events start a turn, and when. A test's own kinds
        # join the real ones, so a say still has its kind. It only calls back into the session
        # from its loop, by which time the rest of __init__ has run.
        self._kinds = {**EVENT_KINDS, **(kinds or {})}
        self.presence = Presence(bodies, now)
        self.tasks = Tasks(
            memory.db,
            lambda text: mask_json(self.guards, "tasks", text),
            now,
            items=items,
            post=self.post_event,
        )
        self.runner = Runner(
            events, self.presence, bodies, self, now, self.guards, self.tasks,
            quiet=quiet, kinds=self._kinds,
        )  # fmt: skip
        self._interjection_cut = False  # the person talked over Scout during an interjection
        self._cut: tuple[str, Interruption] | None = None  # a running turn talked over, and how
        self._carried: list[dict] = []  # what an interjection changed, shown to the next turn
        # A say's own params until its event ends: the saved copy is masked, and an errored
        # turn's say is tried again with them.
        self._live_params: dict[str, SayParams] = {}
        self._ear_due = False  # read-aloud came on mid-turn: its next step gets the guide
        items.expire_live_only()  # what a last run left tied to a process can no longer run
        # Scout's offer to approve a repeated kind of ask; one service for tools and experts.
        offer = self._offers = Offers(
            model,
            budget,
            memory,
            self._asks,
            items,
            self.tasks,
            approvals,
            offers,
            now,
            guards=self.guards,
        )

        def modes() -> dict[str, str]:
            return rules.permission_modes(memory.db)

        # Tool calls and expert asks: a standing rule, then Scout's look, then the person.
        self.engine = Engine(
            [StandingRule(stored_auto_rules(modes)), SideCheckDecider(side_check), Person()],
            approvals,
            offer,
            set_auto=lambda name: self.toolbox.set_mode(name, "auto"),
        )
        self.records = JobRecords(work, memory.db, now)
        self.holds = Holds(self._asks, work, items, self.tasks)
        self.jobs = Jobs(
            self.records,
            self.holds,
            notify,
            experts or (lambda: []),
            make_run,
            on_finished=self._on_job_finished,
            scout_questions=questions,
            engine=self.engine,
            guards=self.guards,
            on_away=self._on_job_away,
            steps_max_entries=job_steps_max_entries,
            steps_max_bytes=job_steps_max_bytes,
            setup_facts=setup_facts,
            emit=self._emit_job_event,
            finish_news=self.events.finish_matching,
            news_waiting=self.events.has_new,
            on_timers_changed=lambda: timers.changed(),
            outputs=outputs,
            items=items,
            apps=apps,
            before_start=before_job,
        )
        # What a dead brain left: the events its turn held, then the parts it left running (held
        # for a carry-on, or failed) and their news, in one transaction: a crash between the scan
        # and the news would lose the news, since the scan never settles a row twice.
        with transaction(memory.db):
            events.recover()
            self.tasks.settle()
            self._tell_settled(self.jobs.startup())
        # Only now: a handled say swept first would leave its Ask open for good.
        events.sweep(work_keep_days)
        self.tasks.sweep(work_keep_days)
        timers = self.timers = Timers(
            self.records.work,
            self.post_event,
            now,
            job_facts=self.jobs.wake_facts,
            rerun=self._rerun_step,
            notify=notify,
            finish_news=self.events.finish_matching,
        )
        choices = Choices(self._asks, self.post_event, items)
        # Scout getting to know the person; its status goes out live to the body that asked.
        self.know_me = KnowMeRunner(
            default_sources(model, budget) if know_sources is None else know_sources,
            memory,
            model,
            budget,
            lambda b, p: bodies.send_live(b, "know_me_status", p),
            now,
            lambda: notify("changed", {"what": "memory"}),
        )
        tools = (
            brain_tools(memory, notify, lambda: self._said)
            + know_me_tools(self.know_me, memory, now, notify)
            + home_tools(budget, lambda: self.toolbox, keys)
            + model_tools(memory.db, model_default, notify)
            + voice_tools(lambda: self.voice)
            + stt_tools(memory.db, stt_default, notify, lambda: self.voice and self.voice.reload())
            + tts_tools(memory.db, notify, self._pick_voice, voice_dir, self._voice_download)
            + expert_tools(self.jobs, self.tasks, lambda: self._turn_cause)
            + work_tools(self.records.work, self.jobs, timers.changed)
            + timer_tools(self.records, timers, now, lambda: self._turn_cause, self.tasks)
            + task_tools(self.tasks, timers, self.jobs.running_for, lambda: self._turn_cause)
            + tasks_tools(self.tasks, events)
            + timer_home_tools(self.records.work, timers)
            + output_tools(outputs)
            + question_tools(questions)
            + choice_tools(choices)
            + preference_tools(approvals)
            + approval_home_tools(approvals)
            + reading_home_tools(self.reading)
            + (extra_tools or [])
        )
        sources: list = []
        if apps is not None and tokens is not None:  # the two always come as a pair
            tools += app_home_tools(apps, memory, tokens, notify, bodies)
            # Before bodies: BodySource.unavailable claims any `x__y` name whose prefix is not an
            # online body, which would hide an app's own "not connected" line behind its slug.
            sources.append(AppSource(apps))
        sources.append(WebSource())  # before bodies, whose tools come last in the model's list
        sources.append(BodySource(bodies))

        def save_mode(name: str, mode: str) -> None:
            # Every save (Home's set_permission or an "always" answer) refreshes open panels.
            rules.set_permission_mode(memory.db, name, mode)
            notify("changed", {"what": "permissions"})

        self.ask_runner = AskRunner(
            items,
            self._asks,
            lambda: self.toolbox,
            self.post_event,
            now,
            approvals,
            self.tasks,
            self._turn_task,
            lambda turn: self._turn_cause if turn and turn == self._turn_id else None,
            self.holds.close,
        )
        # Everything that stops with a task now exists (spec 6.13).
        self.tasks.hooks = TaskStopHooks(
            stop_jobs=self.jobs.stop_task,
            cancel_rows=timers.cancel_task,
            close_cards=self.ask_runner.close_cards,
            finish_events=lambda task: events.finish_task(task, "stopped"),
            cancel_turn_if_only=self.runner.cancel_if_only,
            stop_watch=lambda task: [stop(task) for stop in self.watch_stops],
        )
        self._asks.on_item_answer = self._card_answered
        self._asks.register(
            "ask", lambda ask, opt, body, _text, at: self.ask_runner.answered(ask, opt, body, at)
        )
        self.toolbox = Toolbox(
            [BrainSource(tools), *sources],
            modes,
            save_mode,
            self._asks,
            self.engine,
            person_task=self.person_task,
            on_call=self._on_tool_call,
            outputs=outputs,
            runner=self.ask_runner,
            tasks=self.tasks,
            cause=lambda: self._turn_cause,
        )
        if apps is not None and isinstance(make_run, ExpertHosts):
            # Experts reach apps only through the brain, by the same gate as Scout's own calls.
            make_run.bridge = ExpertApps(apps, lambda: self.toolbox, self.guards)
        self._now = now
        loaded = memory.load_messages()
        self.history, added = rebuild_history(loaded)
        self._saved = len(self.history)  # history[:_saved] is already in the database
        if added:
            # resume added a cancelled tool_result after a dangling tool_use; store it with the
            # next save so the stored chat stays valid.
            self._saved -= 1
        # True when the last turn was cancelled before any word and its request is still last in
        # history: the next turn drops it (see _drop_unanswered).
        self._wordless_cancel = False
        # How unsaved blocks are saved, by block identity: an event's own blocks become its row;
        # turn-only blocks are never saved. Each entry holds its block, so its id is not reused.
        # Cleared once everything is saved.
        self._row_of: dict[int, tuple[dict, str, str]] = {}
        self._unsaved: dict[int, dict] = {}
        self._last_rows: list[int] = []  # the saved rows of the newest message saved
        self._retried: list[str] = []  # the events the running turn took again (`resume`)
        self._cut_messages = 1  # how many messages a wordless cancel drops from the history
        self._rejected = False  # the API answered the running turn's request with a 400
        self._turn_id: str | None = None
        # True while the running turn is the owner's: they started it, or they typed into it.
        # A wake turn stays Scout's own until then, so its follow-ups still ask.
        self._said = ""  # the owner's words in the running turn: evidence for dates in remember
        self._task: asyncio.Task | None = None
        # Set when the owner talks over the running turn: it stops at once and winds down by itself.
        self._stop: asyncio.Event | None = None
        # Tools a paused turn left running; held here so they are not collected before they end.
        self._background: set[asyncio.Future] = set()
        self._last_turn: str | None = (
            None  # the turn that ended last, which can still be spoken over
        )
        self._turn_body: str | None = None  # the body showing the running turn
        self._turn_cause: str | None = None  # the event the running turn took (a say)
        # The job the running turn works for: a wake about it, or a job tool named it. Tool and
        # app calls in the turn are recorded on that job's timeline. Cleared when the turn ends.
        self._turn_job: str | None = None
        self._spoken: set[str] = set()  # running turns whose reply is read aloud
        # Each body's last `read_aloud` event: read every turn it shows aloud, in which voice, and
        # whether it uses its system voice. Kept across a reconnect; the body also resends it.
        self._read_aloud: dict[str, ReadAloudData] = {}
        bodies.on_connect = self._on_connect
        timers.start()
        self.ask_runner.start()
        self.runner.start()  # a no-op until a loop runs; a post starts it then

    def _tell_settled(self, settled: list[tuple[str, str]]) -> None:
        """A step the restart scan failed is told as given up; a job it left with no part
        running is told as ended (a held part waits for Scout to carry it on)."""
        work = self.records.work
        jobs: list[str] = []
        for work_id, _ in settled:
            row = work.get(work_id)
            if row is None:
                continue
            if row.kind == "tool_call" and row.state == "failed":
                self._tell_given_up(row)
            elif row.kind == "expert_call" and row.parent_id and row.parent_id not in jobs:
                jobs.append(row.parent_id)
        for job_id in jobs:
            job = self.records.get_job(job_id)
            if job is not None and job.state != "active":
                self._on_job_finished(job)

    async def say(self, body_id: str, params: SayParams) -> None:
        """Save the say; the runner starts its turn, or the running turn takes it in. A say
        that talks over Scout first stops the turn it names, then waits its turn in order."""
        check_part_sizes(params.parts or [])  # over_limit, before anything changes
        user_content(params)  # may raise ValueError before anything changes
        sender = self._bodies.body(body_id)
        headless = sender is not None and sender.display is False
        # Saved first, whatever happens to it next: a say that was heard is never lost.
        ask = self.tasks.new_id()
        say_event = Event(
            "say",
            body_id,
            {
                "text": params.text or "",
                "params": params.model_dump(mode="json", exclude_none=True),
            },
            id=params.id,
            task=ask,
        )
        # The Ask opens in the say's transaction: a retried say finds its id known and makes none.
        if not self.events.post(
            say_event,
            then=lambda _db: self.tasks.open("ask", body_id, id=ask),
            on_end=lambda _state: self._live_params.pop(say_event.id, None),
        ):
            return  # a retried say: already one event, already answered or being answered
        self._live_params[say_event.id] = params
        if not headless:
            self.presence.touch(body_id)
        if params.interrupted is not None and self.ready():
            cut = self.interrupt(params.interrupted.turn, params.interrupted.heard)
            if cut is not None:  # its turn is told what was said and what was left
                self.events.amend(say_event.id, {"cut": asdict(cut)})

    def post_event(
        self,
        event: Event,
        *,
        on_end: Callable[[str], None] | None = None,
        then: Callable[[sqlite3.Connection], None] | None = None,
    ) -> None:
        """Every news source posts here: the event is saved and the runner decides when it is
        told. `on_end(state)` hears once that it was handled, given up, or returned at a stop."""
        self.events.post(event, then=then, on_end=on_end)

    def start_events(
        self, turn_id: str, body: str, rows: list[EventRow], gave_up: list[EventRow]
    ) -> None:
        """The runner took these events for a turn on `body`: the person's words first, then
        each kind's news as one fenced block. A `resume` row was sent by a failed turn (an error
        or the step cap) and its words are still in the history: a marked fact names it, a say
        by its first line, since later turns may stand between it and its words. `gave_up` rows
        are told once, as marked facts, with only a say's words, never its settings."""
        if not self.ready():
            self._end_unanswered(turn_id, body, [r.id for r in rows])
            # Nothing can answer and no use asking again; a given-up rider was not told.
            self.runner.turn_ended(turn_id, "unanswered")
            return
        now = self._now()
        self._retried = [r.id for r in rows if r.resume]
        says = [(r, self._say_params(r)) for r in rows if r.kind == "say"]
        params = [p for _, p in says]
        content: list[dict] = []
        for r, p in says:
            if not r.resume:
                blocks = user_content(p, read_aloud=self._wants_speech(body, p))
                content += self._of_event(r, blocks)
        news: dict[str, list[EventRow]] = {}
        resumed: dict[tuple[str, str], list[EventRow]] = {}
        for row in rows:
            if row.resume:
                # Its payload is in the history already: only the fact that it goes on.
                resumed.setdefault((row.kind, row.end_reason or ""), []).append(_named(row))
            elif row.kind != "say":
                news.setdefault(row.kind, []).append(row)
        for kind, group in news.items():
            # One block per event, so each is saved as its own row; the note once per kind.
            note = self.runner.notes.get(kind, "")
            for n, row in enumerate(group):
                text = wake_text(self._kinds[kind], [row], note if n == 0 else "", now)
                content += self._of_event(row, [{"type": "text", "text": text}])
        # The marks below are for this turn only: each event got its row from the turn that
        # first took it, so they are never saved (one event, one row).
        for (kind, reason), group in resumed.items():
            attrs = {"resume": "true", "reason": reason}
            note = self.runner.notes.get(kind, "")
            text = wake_text(self._kinds[kind], group, note, now, attrs)
            content.append(self._turn_only({"type": "text", "text": text}))
        told: dict[tuple[str, str], list[EventRow]] = {}
        for row in gave_up:
            if row.resume:  # its words are in the history as its saved row: named only
                shown = _named(row)
            elif row.kind == "say":  # every start failed before the save: its words, in full
                shown = replace(row, payload={"text": row.payload.get("params", {}).get("text")})
            else:
                shown = row
            told.setdefault((row.kind, row.end_reason or ""), []).append(shown)
        for (kind, reason), group in told.items():
            attrs = {"gave_up": "true", "reason": reason}
            note = self.runner.notes.get(kind, "")
            text = wake_text(self._kinds[kind], group, note, now, attrs)
            content.append(self._turn_only({"type": "text", "text": text}))
        if not params and self._wants_speech(body, None):
            # How to write for the ear this turn: a note for the model, never a saved row.
            content.append(self._turn_only({"type": "text", "text": ear_note()}))
        cut = next((r.payload["cut"] for r, _ in says if "cut" in r.payload), None)
        # Before the turn starts: nothing after it may fail, or the runner would free the one
        # turn while this one still runs.
        self._speak(turn_id, body, params[-1] if params else None)
        self._start_turn(
            body,
            content,
            by_person=bool(params),
            cut=Interruption(**cut) if cut else None,
            turn_id=turn_id,
            said=" ".join(p.text for p in params if p.text),
            events=[r.id for r in rows],
        )
        # News of exactly one job binds the turn to it; with several, its first job tool does.
        jobs = {r.source[4:] for r in rows if r.source.startswith("job:")}
        if len(jobs) == 1:
            self._turn_job = jobs.pop()

    def _of_event(self, row: EventRow, blocks: list[dict]) -> list[dict]:
        """Blocks that render a taken event: they are saved as that event's own row."""
        for block in blocks:
            self._row_of[id(block)] = (block, row.id, row.source)
        return blocks

    def _turn_only(self, block: dict) -> dict:
        """A block told to the running turn alone, never saved."""
        self._unsaved[id(block)] = block
        return block

    def _say_params(self, row: EventRow) -> SayParams:
        live = self._live_params.get(row.id)
        return live if live is not None else SayParams.model_validate(row.payload["params"])

    def cancel_turn(self) -> None:
        if self._task is not None:
            self._task.cancel()

    def _turn_task(self, turn_id: str) -> str | None:
        """The task the running turn works on (its first event's), None once it is over."""
        row = (
            self.events.get(self._turn_cause)
            if turn_id == self._turn_id and self._turn_cause
            else None
        )
        return None if row is None else row.task

    async def open_card(self, tool: str, args: dict) -> str:
        """Home's setup card for `tool`: put it up and return its id. The person's answer, whenever
        it comes, runs the install through the same gate as Scout's, as a Home press."""
        spec, kind = self.toolbox.spec_named(tool) or (None, "")
        if spec is None:
            raise RpcError(ErrorCode.unknown_tool, f"No tool named {tool}.")
        call = Call(id=f"home:{uuid.uuid4().hex}", name=tool, input=args, turn="", text="")
        req = await self.toolbox.ask_request(call, spec, kind, job_id=None, ask_id=call.id)
        return self.ask_runner.open(call, req, ASK_WAIT_MIN, home=True).id

    def _card_answered(self, ask_id: str, option: str, body_id: str) -> None:
        """Every card answer is saved as a `card_answer` event that code handles, so it starts no
        turn; the handler of the card's kind then does what the answer means."""
        self.presence.touch(body_id)  # the person is at the body that answered
        answer = Event("card_answer", body_id, {"ask": ask_id, "option": option})
        self.post_event(answer)
        self.events.finish([answer.id], "handled")  # before the runner looks: its poke waits a tick

    async def interject(self, body_id: str, content: list) -> bool:
        """News due at a sentence break while Scout speaks: the voice pauses, one short call sees
        the news and the sentences the body has not finished, and Scout continues or says new
        words instead (no choice resumes). True only when words replaced the rest, which is what
        tells the news; a continue (or no voice, no ready model, no live turn) leaves it for a
        plain turn."""
        voice = self.voice
        turn = self._turn_id or self._last_turn
        if voice is None or turn is None or not self.ready() or not voice.speaking(turn, body_id):
            return False
        sentences = voice.sentences(turn)
        heard_turn, n = self.presence.heard(body_id)
        heard = n if heard_turn == turn else 0
        spoken, unsaid = sentences[:heard], sentences[heard:]
        self._interjection_cut = False
        voice.pause()
        words = None
        try:
            _, words = await asyncio.wait_for(
                interject(self._model, self._budget, self.guards, content, unsaid),
                INTERJECTION_TIMEOUT_S,
            )
        finally:
            # The person talked over Scout meanwhile (or the turn was cleared): the pause is
            # theirs now and the turn is gone, so nothing is replaced and the player is left alone.
            cut = self._interjection_cut or not voice.speaking(turn, body_id)
            if words is not None and not cut and voice.replace(turn, body_id, words) is not None:
                self._carried.append(interjection_block(content, " ".join(spoken), words, unsaid))
            else:
                words = None
            voice.resume(tell=not cut)  # whatever happened, the voice never stays paused
        return words is not None

    def interrupt(self, turn: str, heard: int) -> Interruption | None:
        """The owner spoke over `turn` after the body played `heard` of its sentences. Stops what
        is still being said and pauses the turn if it is running: generation ends, tools already
        running finish in the background (their results come back as events in the log) and
        nothing else is cancelled, open items included. History keeps the heard part once the
        turn has ended. Returns what was said and what was left, or None when there is nothing
        to hand over: a turn this session no longer knows, or one the owner heard to the end
        (then their words are a plain say)."""
        live = turn == self._turn_id
        if self.voice is None or not (live or (turn == self._last_turn and not self._busy())):
            return None
        sentences = self.voice.sentences(turn)
        unsaid = " ".join(sentences[heard:])
        # A turn still running is paused even with nothing unsaid: the model has more to come.
        if not unsaid and not (live and self._busy()):
            return None
        self._interjection_cut = True
        if self._turn_body is not None:
            self.voice.hush(self._turn_body)  # queued sentences must not keep coming
        cut = Interruption(" ".join(sentences[:heard]), unsaid)
        if live and self._busy() and self._stop is not None:
            self._cut = (turn, cut)  # its end writes it, before any later turn adds to history
            self._stop.set()
        else:
            self._record_cut(cut)
        return cut

    async def stop_turn(self) -> None:
        """The brain is closing: the runner stops (the turn's events wait as `new`, no attempt)
        and cancels the running turn, which is awaited so its end saves what it did. A turn
        that saved any of it leaves its events marked `resume`, so the next run names them
        instead of sending their words again; a wordless cancel saved nothing to resume."""
        task = self._task
        ids = await self.runner.stop()
        if task is None:
            return
        done, _ = await asyncio.wait({task}, timeout=STOP_TURN_WAIT_S)
        if not done:
            log.warning("the turn did not end within %.0f s of its cancel", STOP_TURN_WAIT_S)
            # Its request was saved before the model was asked, and with no end to mark it
            # cut, the next run would load its words: name it instead of sending them again.
            self.events.set_resume(ids)
            return
        if ids and not self._wordless_cancel:
            self.events.set_resume(ids)

    async def stop_background(self) -> None:
        """The brain is closing: tools a paused turn left running end with it. (The Stop button
        cannot reach them; a paused turn is gone, so nothing holds their calls any more.)"""
        left = list(self._background)
        for task in left:
            task.cancel()
        await asyncio.gather(*left, return_exceptions=True)

    def _detached(self, call: dict, task: asyncio.Future) -> None:
        """A tool the paused turn left running: when it ends, its result is saved like any other
        news, so a later turn (not this one) tells the owner."""
        self._background.add(task)
        cause = self._turn_cause  # read now: the turn is gone when the tool ends

        def done(t: asyncio.Future) -> None:
            self._background.discard(t)
            if t.cancelled():
                return
            result = t.result()
            content = result["content"]
            text = (
                content
                if isinstance(content, str)
                else " ".join(b.get("text", "") for b in content if b.get("type") == "text")
            )
            facts = {
                "tool": call["name"],
                "ok": "is_error" not in result,
                "result": text[:_LATE_RESULT_CAP],
            }
            self.post_event(Event("tool_result", f"tool:{call['name']}", facts, caused_by=cause))

        task.add_done_callback(done)

    def _record_cut(self, cut: Interruption) -> None:
        """History keeps what the owner heard, marked as cut off, never the unsaid rest."""
        if self._wordless_cancel:  # the request gets its (heard) answer below, so it is kept
            self._wordless_cancel = False
            self._mark_cut(False)
        text = (cut.spoken + "\n\n" if cut.spoken else "") + INTERRUPTED_MARK
        block = {"type": "text", "text": text}
        last = self.history[-1] if self.history else None
        if last and last["role"] == "assistant" and isinstance(last["content"], list):
            # The turn finished and wrote its reply in full; swap the words for the heard part.
            last["content"] = [b for b in last["content"] if b.get("type") != "text"] + [block]
            if self._saved == len(self.history):  # already on disk
                try:
                    self._memory.replace_last_message(self._masked(last))
                except Exception:
                    log.exception("could not rewrite the cut-off reply")
        else:
            # Cancelled before any word was streamed, so no reply was kept; keep the heard words.
            self.history.append({"role": "assistant", "content": [block]})

    def _drop_unanswered(self) -> None:
        """A turn cancelled before any word leaves its request unanswered (see `_ended`). Out of
        the model's history it goes, so the next request is not answered together with it. An
        error or a timeout keeps its request: the person may say "try again"."""
        if not self._wordless_cancel:
            return
        self._wordless_cancel = False
        # The flag is set right after the save, so history still ends on that saved request:
        # nothing appends to history between the end of a turn and the next prepare(). The
        # checks guard the pop anyway; the row's `cut` mark then still matches what was dropped.
        for _ in range(self._cut_messages):  # a cut retry drops the request it retried
            last = self.history[-1] if self.history else None
            if last is None or last["role"] != "user" or self._saved != len(self.history):
                break
            self.history.pop()
            self._saved = len(self.history)

    def _reject(self) -> None:
        self._rejected = True

    def _mark_cut(self, cut: bool) -> None:
        try:
            self._memory.set_cut(self._last_rows, cut)
        except Exception:
            log.exception("could not mark the cut-off request")

    def claim_task(self, given: object, kind: str, title: str) -> str:
        """The task a setup call works for: the open one it named, else a new one for this turn.
        It waits on what the call sets going."""
        id = self.tasks.claim(given, self._turn_cause, kind, title)
        self.tasks.wait(id)
        return id

    def person_task(self, turn_id: str | None) -> bool:
        """True while this turn runs and its first event is a person's say, so a follow-up in it
        needs no ask. A body's wake, a timer or a job's news is not a person."""
        if turn_id is None or turn_id != self._turn_id or not self._busy():
            return False
        return self.tasks.person_cause(self._turn_cause)

    def ready(self) -> bool:
        return getattr(self._model, "ready", True)  # fakes and other models need no key

    def _end_unanswered(self, turn_id: str, body_id: str, events: list[str]) -> None:
        """No key: the turn starts and ends at once, no reply, no history. The app says why."""
        notify = self._bodies.notify
        loop = asyncio.get_running_loop()
        loop.call_soon(
            notify,
            "turn",
            self._started_frame(turn_id, body_id, events),
        )
        loop.call_soon(
            notify,
            "turn",
            {"turn": turn_id, "body": body_id, "state": "ended", "reason": "error"},
        )

    def _started_frame(self, turn_id: str, body_id: str | None, events: list[str]) -> dict:
        """The `started` frame: the events the turn took and the first one's source (a say's is
        the body, news's its source), so a body can tell which of its says it answers."""
        frame = {
            "turn": turn_id,
            "body": body_id,
            "state": "started",
            "events": events,
            "source": self._event_source(events[0] if events else None, body_id),
        }
        if tasks := self.tasks.named_by(events):
            frame["tasks"] = tasks
        return frame

    def _event_source(self, event_id: str | None, body_id: str | None) -> str:
        row = self.events.get(event_id) if event_id else None
        return row.source if row is not None else (body_id or "brain")

    def _end_cancelled(self, turn_id: str, body_id: str | None, event_id: str) -> None:
        """A say cancelled before its turn began: the body still sees it start and end."""
        notify = self._bodies.notify
        notify("turn", self._started_frame(turn_id, body_id, [event_id]))
        notify("turn", {"turn": turn_id, "body": body_id, "state": "ended", "reason": "cancelled"})

    def _pick_voice(self, voice_id: str) -> None:
        """Home chose a voice: the mouth switches at the next chunk, fetching it if needed."""
        if self.voice is not None:
            self.voice.choose_voice(voice_id)

    def _voice_download(self) -> dict:
        if self.voice is None:
            return {"voice": "", "status": "idle", "progress": 0.0}
        return self.voice.voice_download()

    def _wants_speech(self, shown_on: str | None, params: SayParams | None) -> bool:
        """Whether a turn shown on `shown_on` is read aloud: a voice exists, and the user spoke or
        the body asked for read-aloud. A body that turned read-aloud off silences everything."""
        if self.voice is None or shown_on is None:
            return False
        ask = self._read_aloud.get(shown_on)
        if ask is not None and not ask.on:
            return False
        return bool((params is not None and params.spoken) or (ask and ask.on))

    def _speak(self, turn: str | None, shown_on: str | None, params: SayParams | None) -> None:
        """A turn is read aloud when the user spoke (`params.spoken`) or the body showing it asked
        for read-aloud; on that body only, because speech never goes to a body that did not
        display the turn. A body that turned read-aloud off silences everything, spoken or not.
        `params` is None for a turn the brain started."""
        # The first three checks are for type narrowing; `_wants_speech` holds the rule.
        if turn is None or shown_on is None or self.voice is None:
            return
        if not self._wants_speech(shown_on, params):
            return
        ask = self._read_aloud.get(shown_on)
        speed = ask.speed if ask else None
        if params is not None and params.speed is not None:
            speed = params.speed
        self._spoken.add(turn)
        # Every time: the voice drops a hushed turn, and a later say must re-arm it. It ignores
        # a say for a turn it is already speaking.
        self.voice.spoken(turn, shown_on, speed, ask.system_voice if ask else False)

    def body_event(self, body_id: str, name: str, data: object) -> None:
        if name == "read_aloud":  # a setting of the body, not something that happened
            try:
                ask = ReadAloudData.model_validate(data)
            except ValidationError:
                return
            self._read_aloud[body_id] = ask
            # It arrives after the connect, so a wake the connect started may be running already.
            if (
                ask.on
                and self._busy()
                and self._turn_body == body_id
                and self._turn_id not in self._spoken
            ):
                self._speak(self._turn_id, body_id, None)
                self._ear_due = True  # the turn began without the guide; its next step gets it
            return
        if name == "reading":  # a status of the body for Home, not something that happened
            try:
                status = ReadingData.model_validate(data)
            except ValidationError:
                log.warning("dropped a malformed reading event from %s", body_id)
                return
            if self.reading.set(body_id, status):
                self._bodies.notify("changed", {"what": "reading"})
            return
        event = from_body(body_id, name, data)
        if event is not None:
            if self.loops is not None and event.kind in ("focus", "tab", "back"):
                try:
                    self.loops.saw(event)
                except Exception:  # a store error must not stop the wake path
                    log.exception("loops.saw failed")
            self._from_body(event)

    def _from_body(self, event: Event) -> None:
        """A body's event is saved when it can wake Scout; one that only keeps context is kept
        as the latest of its kind, ahead of the next turn."""
        # The person is at this body now (a WhatsApp tap or reply to an ask counts too).
        if event.kind in ("focus", "back", "ask_closed", "many_pending"):
            self.presence.touch(event.source)
        if self._kinds.get(event.kind, EventKind(event.kind, wakes=False)).wakes:
            self.post_event(event)
        else:
            self.presence.record(event.kind, event.source, event.payload)

    def body_gone(self, body_id: str) -> None:
        """A body disconnected for good: its reading status must not outlive it."""
        self.know_me.drop_watcher(body_id)
        if self.reading.forget(body_id):
            self._bodies.notify("changed", {"what": "reading"})

    def _on_connect(self, body_id: str, away: float | None) -> None:
        kind = next((b.kind for b in self._bodies.online() if b.id == body_id), None)
        event = from_connect(body_id, away, kind)
        if event is not None:
            if self.loops is not None:  # the day's first return also brings the held-today line
                try:
                    self.loops.saw(event)
                except Exception:
                    log.exception("loops.saw failed")
            self._from_body(event)
        self.runner.poke()  # news that waited for a body can go now
        body = self._bodies.body(body_id)
        if body is not None and body.display is not False:
            self.ask_runner.returned(away)  # cards come back, ended ones close, Scout is told
            self._offers.resume()  # offers the last run left unanswered are shown again

    def _on_job_finished(self, job: Job) -> None:
        # One id per ending, so telling it twice (a restart re-deriving it) is one event.
        self._emit_job_event(
            Event(
                "job_ended",
                f"job:{job.id}",
                {"report": self.jobs.note(job)},
                id=f"job_ended:{job.id}@{job.ended_at}",
            ),
        )

    def _emit_job_event(self, event: Event, **hooks) -> None:
        """Post a job's event under the job's task, caused by the event that handed it off."""
        job = event.source[4:] if event.source.startswith("job:") else ""
        task = self.jobs.task_of(job) if job else None
        cause = self.jobs.caused_by(job) if job else None
        self.post_event(replace(event, caused_by=cause, task=task), **hooks)

    def _on_tool_call(
        self,
        call: Call,
        spec: ToolSpec,
        kind: str,
        status: str,
        result: str | None,
        error: BaseException | None = None,
    ) -> None:
        """Put a tool or app call of a job-bound turn on that job's timeline. Which calls count
        is mechanical: every one, except the job bookkeeping tools."""
        if call.turn != self._turn_id:
            return
        if spec.name in JOB_TOOLS:
            job = self._job_named(call, status, result)
            if job is not None and self._turn_job is None and status == "ok":
                self._turn_job = job
        else:
            job = self._turn_job
        if job is None or spec.name in BOOKKEEPING_TOOLS:
            return
        name, _, short = spec.name.partition(SEP)
        if kind == "app":
            source, label = f"app:{name}", short
        else:
            source, label = f"scout:{spec.name}", spec.name
        args = json.dumps(call.input, ensure_ascii=False, default=str)[:_ARGS_CAP]
        text = f"{label} {args}" if call.input else label
        self.jobs.record_step(job, source, text, _STEP_STATUS[status])
        if spec.name not in _NOT_STEPS:
            self._record_tool_row(job, call, spec, status, result, error)

    def _record_tool_row(
        self,
        job: str,
        call: Call,
        spec: ToolSpec,
        status: str,
        result: str | None,
        error: BaseException | None,
    ) -> None:
        """A goal's tool call becomes a `tool_call` row: done with its result's start, or failed
        through the retry rule. A refused call never ran, so it leaves no row."""
        if status == "refused":
            return
        work = self.records.work
        raw = {"name": call.name, "input": call.input}
        payload = mask_json(self.guards, "work", raw)
        try:
            row = work.create(
                "tool_call",
                call.name,
                parent_id=job,
                state="active",
                input=payload,
                # A masked input would replay as the literal "[secret]": never repeat it on its own.
                safe_to_retry=safe_to_retry(spec) and payload == raw,
            )
            if status == "ok":
                work.update(row.id, summary=(result or "")[:_SUMMARY_CAP])
                work.transition(row.id, "done", reason="ok")
            else:
                self._step_failed(row.id, error)
        except TransitionRefused:
            return  # the goal ended meanwhile: nothing to record against

    def _step_failed(self, id: str, error: BaseException | None) -> None:
        """A step failed: the retry rule backs it off or ends it. A step that ended is news."""
        work = self.records.work
        # The failure and its news are one save: a crash between them would leave a failed step
        # no restart tells, since the scan settles only unfinished rows.
        with transaction(work.db):
            try:
                row = work.fail(id, classify(error or RuntimeError()), str(error or "failed"))
            except TransitionRefused:
                # The goal was closed while it ran (handled), or a failed start already ended the
                # row itself; its news has one id per failure, so a second tell is a no-op.
                row = work.get(id)
                if row is None or row.state != "failed":
                    return
            if row.state == "failed":
                self._tell_given_up(row)
                return
        self.timers.changed()  # the next try is waiting out its backoff

    def _tell_given_up(self, row: WorkRow) -> None:
        """Scout is told once about a step that ended failed: the event's id names this failure,
        so telling it again is refused by the log."""
        facts = {
            "goal": row.root_id,
            "step": row.id,
            "title": row.title,
            "reason": row.end_reason or "",
        }
        self.post_event(
            Event("work_failed", "scout", facts, id=f"work_failed:{row.id}@{row.ended_at}")
        )

    async def _rerun_step(self, row: WorkRow) -> None:
        """The runner found a step due again: run it as Scout would, outside any turn."""
        work = self.records.work
        try:
            if row.kind == "expert_call":
                await self.jobs.run_planned(row)
                return
            wanted = row.input or {}
            call = Call(
                f"rerun:{row.id}", wanted.get("name", ""), wanted.get("input") or {}, "", ""
            )
            result = await self.toolbox.run(call, caller="scout", job_id=row.root_id)
            text = result if isinstance(result, str) else ""
            work.update(row.id, summary=text[:_SUMMARY_CAP])
            work.transition(row.id, "done", reason="ok", expect="active")
        except TransitionRefused:
            return  # skipped or the goal closed while it ran: already handled
        except Exception as err:
            self._step_failed(row.id, err)

    def _job_named(self, call: Call, status: str, result: str | None) -> str | None:
        """The job a job tool worked on: the one in its arguments, or for a new hand-off the
        one its result names. Only a job that exists."""
        job = call.input.get("job")
        if not isinstance(job, str) and call.name == "hand_off" and status == "ok":
            try:
                job = json.loads(result or "").get("job")
            except (ValueError, AttributeError):
                job = None
        if isinstance(job, str) and self.records.get_job(job) is not None:
            return job
        return None

    def _on_job_away(self, job_id: str, what: str) -> None:
        # No body was online to ask, so hold the news until one connects (no question id: nothing
        # is waiting on Scout). One held item per job.
        self.post_event(
            Event(
                "job_question",
                f"job:{job_id}",
                {"job": job_id, "message": what},
                caused_by=self.jobs.caused_by(job_id),
                task=self.jobs.task_of(job_id),
            )
        )

    def _busy(self) -> bool:
        return self._task is not None and not self._task.done()

    def _start_turn(
        self,
        body_id: str | None,
        content: list,
        by_person: bool = True,
        *,
        cut: Interruption | None = None,
        turn_id: str,
        said: str = "",
        events: list[str],
    ) -> str:
        """`cut` is what the owner talked over, told to this turn only. `events` are the ones the
        turn took; the first is its cause."""
        self._turn_id = turn_id
        self._ear_due = False
        self._turn_job = None
        self._stop = stop = asyncio.Event()
        # Only the person's typed words count as date evidence, never body context or parts.
        self._said = said if by_person else ""
        self._turn_body = body_id
        self._turn_cause = events[0] if events else None
        # Read once per turn so the system prompt stays identical across its steps (cache).
        # Read before any state changes: a failed read leaves no half request for the retry to
        # join and keeps what an interjection changed for it.
        know = render_know(
            self._memory.always_loaded(), self._memory.asked_topics(), self._memory.shape()
        )
        prefs = render_preferences(rules.list_preferences(self._memory.db))
        lead = [interruption_block(cut.spoken, cut.unsaid)] if cut is not None else []
        lead = [self._turn_only(b) for b in [*self._carried, *lead]]  # an interjection's, once
        self._carried = []

        self._drop_unanswered()
        self._append_user(lead + content)
        notify = self._bodies.notify
        # Deferred a tick so the say result goes out before the started notification.
        asyncio.get_running_loop().call_soon(
            notify,
            "turn",
            self._started_frame(turn_id, body_id, events),
        )

        def take_more() -> list[dict]:
            """The person's words that arrived on this body since the last step."""
            if self._turn_id != turn_id or stop.is_set():  # a stopped turn takes in nothing
                return []
            blocks = []
            if self._ear_due:  # the guide is for this turn's model only, never a saved row
                blocks.append(self._turn_only({"type": "text", "text": ear_note()}))
            self._ear_due = False
            for row in self.runner.take_more():
                params = self._say_params(row)
                said = user_content(params, read_aloud=self._wants_speech(body_id, params))
                blocks += self._of_event(row, said)
                self._speak(turn_id, body_id, params)
            return blocks

        def spoken_notify(method: str, params: dict) -> None:
            notify(method, params)
            if method == "reply" and turn_id in self._spoken and self.voice is not None:
                self.voice.reply(turn_id, body_id, params)

        async def run() -> str:
            return await run_turn(
                turn_id=turn_id,
                body_id=body_id,
                model=self._model,
                system=lambda: system_prompt(
                    self._now(),
                    self._bodies.online(),
                    know,
                    self._latest("focus"),
                    self._latest("tab"),
                    self._latest("download"),
                    prefs,
                    self._capabilities(),
                    self.tasks.open_block(),
                ),
                history=self.history,
                tools=self.toolbox.model_tools,
                run_tool=self.toolbox.run,
                notify=spoken_notify,
                budget=self._budget,
                step_cap=self._step_cap,
                guards=self.guards,
                turn_timeout=self._turn_timeout,
                take_more=take_more,
                on_rejected=self._reject,
                stop=stop,
                on_detached=self._detached,
                on_step=lambda _step: self._save_new(body_kind),
            )

        # resolved now: the body may leave before the turn ends, and the saved rows keep its kind
        shown = self._bodies.body(body_id) if body_id is not None else None
        body_kind = shown.kind if shown is not None else BODY_DESKTOP
        task = asyncio.create_task(run())
        self._task = task
        task.add_done_callback(lambda t: self._ended(t, turn_id, body_id, lead, body_kind))
        # Saved before the model is asked, so a crash keeps the request; the task cannot run
        # before this returns.
        self._save_new(body_kind)
        return turn_id

    def _capabilities(self) -> str:
        """The picture of what Scout can do now, from live state, read once per system prompt.

        Built from the toolbox's active specs grouped by source type, so a tool set Off drops out
        of the picture exactly as it drops out of the model's tool list."""
        active = {s.name for s in self.toolbox.active_specs()}
        builtin: list[str] = []
        by_body: dict[str, list[str]] = {}
        by_app: dict[str, list[ToolSpec]] = {}
        for source in self.toolbox.sources:
            for spec in source.specs():
                if spec.name not in active or "scout" not in spec.audience:
                    continue
                prefix, _, plain = spec.name.partition(SEP)
                if isinstance(source, BodySource):
                    by_body.setdefault(prefix, []).append(plain)
                elif isinstance(source, AppSource):
                    by_app.setdefault(prefix, []).append(spec)
                else:
                    builtin.append(spec.name)
        bodies = [
            BodyCaps(b.id, b.kind, by_body[b.id]) for b in self._bodies.online() if b.id in by_body
        ]
        apps = [
            AppCaps(
                app_id,
                self._apps_live.name(app_id) if self._apps_live is not None else app_id,
                next((sp.description for sp in specs if sp.description), ""),
            )
            for app_id, specs in by_app.items()
        ]
        experts = [ExpertCaps(e.id, e.logged_in) for e in self._experts_live()]
        asking = any(
            self.toolbox.mode(s) == "ask"
            for s in self.toolbox.active_specs()
            if "scout" in s.audience and s.server_tool is None
        )
        return capability_picture(
            builtin,
            bodies,
            apps,
            experts,
            self.reading.ocr_problem(),
            asks=asking,
            know_me_offer=offer.allowed(offer.load(self._memory.db), self._now()),
        )

    def cancel(self, id: str) -> None:
        """Stop the running turn, or a say still waiting for its turn (by the say's id)."""
        if id == self._turn_id and self._task is not None:
            self._task.cancel()
            return
        row = self.events.get(id)
        if row is not None and row.kind == "say" and row.state == "new":
            self.events.finish([id], "handled", end_reason="cancelled")
            self._live_params.pop(id, None)
            # With no screen there is no target: the body it came from still hears it end.
            body = self.runner.target(row) or row.source
            self._end_cancelled(uuid.uuid4().hex, body, id)

    def answer(
        self,
        ask_id: str,
        option: str,
        body_id: str,
        text: str | None = None,
        check_back_at: str | None = None,
    ) -> None:
        try:
            self._asks.answer(ask_id, option, body_id, text, check_back_at)
        except RpcError as err:
            item = self.items.get(ask_id)
            expired = item is not None and (item.kind, item.state) == ("expert_ask", "expired")
            if err.code is ErrorCode.not_found and expired:
                # An expert's ask ends with its process; say so rather than "no open ask".
                raise RpcError(ErrorCode.not_found, "that ask expired; the expert stopped") from err
            raise

    @property
    def asks(self) -> Asks:
        return self._asks

    def open_asks(self) -> list[dict]:
        return self._asks.open_asks()

    def home_tools(self) -> list[Tool]:
        return self.toolbox.home_tools()

    async def call_home(self, tool: str, tool_input: dict) -> str:
        """Run a Home tool through the toolbox gate (caller "home" skips the ask)."""
        out = await self.toolbox.run(Call(uuid.uuid4().hex, tool, tool_input, "", ""), "home")
        return out if isinstance(out, str) else json.dumps(out)

    def _latest(self, kind: str) -> dict:
        return self.presence.latest(kind)

    def _append_user(self, content: list) -> None:
        # Input arriving while the last user message is still unsaved joins it, so one burst is
        # one saved message. (The API would also accept two user messages in a row and join them.)
        if len(self.history) > self._saved and self.history[-1]["role"] == "user":
            self.history[-1]["content"] += content
        else:
            self.history.append({"role": "user", "content": content})

    def _drop_lead(self, lead: list) -> None:
        """The interruption block is for its own turn only: out of history before it is saved."""
        if not lead:
            return
        for message in self.history:
            if message["role"] == "user" and isinstance(message["content"], list):
                message["content"][:] = [b for b in message["content"] if not _is_in(b, lead)]

    def _ended(
        self, task: asyncio.Task, turn_id: str, body_id: str, lead: list, body_kind: str
    ) -> None:
        self._drop_lead(lead)
        if self._cut is not None and self._cut[0] == turn_id:
            self._record_cut(self._cut[1])
            self._cut = None
        if task.cancelled():
            reason = "cancelled"
        elif task.exception() is not None:
            log.error("turn failed", exc_info=task.exception())
            reason = "error"
        else:
            reason = task.result()
        owns = self._task is task  # a newer turn may already own the session
        last = self.history[-1] if self.history else None
        rejected, self._rejected = self._rejected, False
        # A request the API rejects is dropped like a wordless cancel: kept in the saved chat
        # (marked cut) but out of the history that every later turn would send again.
        unanswered = (
            owns
            and (reason == "cancelled" or rejected)
            and last is not None
            and last["role"] == "user"
            and not _has_tool_result(last)
        )
        if owns:
            self._turn_id = None
            self._turn_cause = None  # a later outside-turn ask must not inherit this say's cause
            self._turn_job = None
            self._task = None
        self._last_turn = turn_id
        self._save_new(body_kind)  # the closing reply; earlier steps were saved as they ended
        if unanswered and self._saved == len(self.history):
            self._wordless_cancel = True
            self._mark_cut(True)  # the saved chat keeps it; a restart skips it
        if turn_id in self._spoken:
            self._spoken.discard(turn_id)
            if self.voice is not None:
                self.voice.turn_ended(turn_id)
        self._bodies.notify(
            "turn", {"turn": turn_id, "body": body_id, "state": "ended", "reason": reason}
        )
        # after ended, so the next turn's started comes second
        self.runner.turn_ended(turn_id, "rejected" if rejected else reason)

    def _masked(self, message: dict[str, Any]) -> dict[str, Any]:
        """The copy saved to disk. A thinking block that masking would change cannot be replayed
        (its signature covers the original text) and a partial run is rejected too, so all the
        message's thinking is dropped."""
        message = without_server_blocks(message)
        content = message["content"]
        if message["role"] == "assistant" and isinstance(content, list):
            if any(self._thinking_changes(b) for b in content):
                content = without_thinking(content)
            # an emptied reply stays empty: resume drops it with the message it answered
            message = {**message, "content": content}
        return mask_message(self.guards, "chat", message)

    def _thinking_changes(self, block: Any) -> bool:
        if not isinstance(block, dict) or block.get("type") != "thinking":
            return False
        return mask_json(self.guards, "chat", block.get("thinking", "")) != block.get("thinking")

    def _save_new(self, body: str) -> None:
        """Save the history not on disk yet: at a turn's start, after each tool round and at its
        end. Each taken event's blocks are their own row; turn-only blocks are left out."""
        # Saving is best effort: a full disk must not stop the turn or its ended notification.
        try:
            per = [self._rows_of(m) for m in self.history[self._saved :]]
            rows = [row for message_rows in per for row in message_rows]
            ids = []
            new = [self._masked(m) for m, _, _ in rows]
            if rows:
                # A masked copy goes to disk; self.history keeps the real values for the turn.
                ids = self._memory.save_messages(
                    new, body, event_ids=[e for _, e, _ in rows], sources=[s for _, _, s in rows]
                )
            if per:
                # The message before the new one, when it was the newest saved: its rows.
                before = self._last_rows if len(per) == 1 else None
                # The newest message's rows: what a wordless cancel marks as cut.
                self._last_rows = ids[len(ids) - len(per[-1]) :]
                self._cut_messages = 1
                if not self._last_rows and self._retries_its_request(before):
                    # A retry's message is turn-only: its request is the say saved before it,
                    # which a wordless cancel cuts too, or it is answered again next time.
                    self._last_rows = self._memory.rows_of_events(self._retried)
                    self._cut_messages = 2
            self._saved = len(self.history)  # before summaries, so a failure there cannot re-save
            # All on disk now; a failed save keeps the marks so a later one still splits it.
            self._row_of.clear()
            self._unsaved.clear()
            for message in new:
                if message["role"] != "assistant" or isinstance(message["content"], str):
                    continue
                for block in message["content"]:
                    if block.get("type") == "compaction" and (text := compaction_text(block)):
                        self._memory.add_summary(text)
        except Exception:
            log.exception("could not save the chat")

    def _retries_its_request(self, before: list[int] | None) -> bool:
        """The newest message only names retried events, right after their request: a message
        whose rows are exactly theirs (one earlier turn saved them all, and nothing after)."""
        if not self._retried or len(self.history) < 2 or before is None:
            return False
        request = self.history[-2]
        if request["role"] != "user" or _has_tool_result(request):
            return False
        return bool(before) and before == self._memory.rows_of_events(self._retried)

    def _rows_of(self, message: dict) -> list[tuple[dict, str | None, str | None]]:
        """The rows `message` is saved as, each with its event id and source. A run of blocks
        that render one event is that event's row; other blocks share a row of their own."""
        content = message["content"]
        if message["role"] != "user" or isinstance(content, str):
            return [(message, None, None)]
        rows: list[tuple[dict, str | None, str | None]] = []
        for block in content:
            if id(block) in self._unsaved:
                continue
            _, event, source = self._row_of.get(id(block), (None, None, None))
            if rows and rows[-1][1] == event:
                rows[-1][0]["content"].append(block)
            else:
                rows.append(({"role": "user", "content": [block]}, event, source))
        return rows


def _is_in(block: Any, blocks: list) -> bool:
    return any(block is b for b in blocks)


def _has_tool_result(message: dict) -> bool:
    """A user message that answers tool calls: dropping it would orphan them."""
    content = message["content"]
    return isinstance(content, list) and any(b.get("type") == "tool_result" for b in content)
