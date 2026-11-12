"""The one conversation: shared history and at most one running turn.
Every source enters through the Dispatcher (a say, a timer, a job's question or result, a card
answer); a say that arrives mid-turn gets a turn of its own after it, shown on the body it came
from. The Dispatcher also starts the wake turns; the session only says whether it is busy.

Turn bookkeeping lives in a done callback, not in the task body, so `ended` is sent and the
turn cleared even if the task is cancelled before it ever ran.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Literal

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
from brain.dispatcher import Dispatcher, Item, WakeSkipped
from brain.events import BRAIN, EVENT_KINDS, Event, EventKind, from_body, from_connect
from brain.expert_apps import ExpertApps
from brain.experts import ExpertHosts, ExpertRun
from brain.job_records import Job, JobRecords
from brain.jobs import Jobs
from brain.loops.service import LoopService
from brain.masking import Masker, mask_json, mask_message, mask_secrets
from brain.memory import Memory
from brain.mind.capabilities import AppCaps, BodyCaps, ExpertCaps, capability_picture
from brain.mind.prompt import (
    INTERRUPTED_MARK,
    check_part_sizes,
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
from brain.permission import Engine, Person, SideCheckDecider, StandingRule, stored_auto_rules
from brain.protocol import (
    BODY_DESKTOP,
    ErrorCode,
    ReadAloudData,
    ReadingData,
    RpcError,
    SayParams,
    SayResult,
    Tool,
)
from brain.questions import ScoutQuestions
from brain.reading import ReadingStore
from brain.reading_tools import reading_home_tools
from brain.retry import classify, safe_to_retry
from brain.setup.store import InstalledExpert
from brain.side_check import SideCheck
from brain.speech_tools import interject
from brain.store import rules
from brain.store.conversation import compaction_text
from brain.store.work import TransitionRefused, WorkRow, WorkStore
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
INTERJECTION_TIMEOUT_S = 15.0  # the queue is held meanwhile, so a slow call must not keep it


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
        extra_tools: list[tuple[ToolSpec, Handler]] | None = None,
        setup_facts: Callable[[], Awaitable[dict]] | None = None,
        preview_chars: int = DEFAULT_TOOL_PREVIEW_CHARS,
        job_steps_max_entries: int = DEFAULT_JOB_STEPS_MAX_ENTRIES,
        job_steps_max_bytes: int = DEFAULT_JOB_STEPS_MAX_BYTES,
        work_keep_days: int = DEFAULT_WORK_KEEP_DAYS,
        outputs_keep: int = DEFAULT_OUTPUTS_KEEP,
    ) -> None:
        self._model = model
        self.reading = ReadingStore()  # how the connected body reads the screen, for Home
        self._apps_live = apps  # read each turn for the capability picture
        self._experts_live = experts or (lambda: [])
        # Set by main when voice is built; None answers `listen` with method_not_found.
        self.voice: VoiceHooks | None = None
        # Set by main: the loops service, which also hears focus and tab to surface held loops.
        self.loops: LoopService | None = None
        self._budget = budget
        self._bodies = bodies
        self._step_cap = step_cap
        self._turn_timeout = turn_timeout
        self._memory = memory
        # One WorkStore for the jobs, asks, questions and the ask log: a job that ends takes its
        # open asks and questions with it, which only holds when they share the store's hooks.
        work = WorkStore(memory.db, now, lambda text: mask_json(self.guards, "work", text))
        self._asks = Asks(bodies, work)
        # One set of spend guards for the loop, the dispatcher, the side-check and offers.
        self.guards = spend_guards(budget, step_cap)
        self.guards.add(wake_caps(wakes_per_hour))
        if masker is not None:  # what reaches disk (chat, approvals, job results) is masked
            self.guards.add(mask_secrets(masker))
        memory.mask = lambda text: mask_json(self.guards, "memory", text)
        # Long tool results and expert reports reach the model as a capped preview; the full text
        # is stored masked for read_output. At startup finished work goes first (with the reports
        # it points at), then the oldest outputs nothing points at.
        outputs = OutputStore(memory, self.guards, preview_chars)
        work.sweep(work_keep_days)
        outputs.prune(outputs_keep)
        notify = bodies.notify
        # main passes the installed experts and the quiet threshold; the defaults keep tests short.
        make_run = make_run or ExpertHosts()
        # Built first: the questions and the timers emit through it. It only calls back into the
        # session once an event arrives, by which time the rest of __init__ has run.
        questions = ScoutQuestions(self.post_event, work)
        approvals = self.approvals = Approvals(memory, work, notify, now, guards=self.guards)
        # Scout's look before an ask reaches the person; shares the session's model and budget.
        side_check = SideCheck(model, budget, memory, work, guards=self.guards)
        items = self.items = OpenItems(memory.db, now)
        # The front door, the one place that decides when news is told or held. A test's own
        # kinds join the real ones, so a say still has its kind. Built before the questions and
        # timers post to it, but they only do so once an event arrives.
        self._kinds = {**EVENT_KINDS, **(kinds or {})}
        self.dispatcher = Dispatcher(
            self._deliver,
            items,
            bodies=bodies,
            guards=self.guards,
            busy=self._busy_for_wakes,
            last_body=lambda: self._last_body,
            start=self._start_wake,
            now=now,
            gave_up=self._say_gave_up,
            quiet=quiet,
            kinds=self._kinds,
            interject=self._interject,
        )
        self._says_waiting: set[str] = set()  # says posted, not yet delivered: wakes wait for them
        # Says from another body that arrived mid-turn: each starts a turn when that one ends.
        self._later: list[tuple[str | None, str, list, SayParams]] = []
        # The owner's words that joined the running turn: it takes them in at its next step.
        self._inbox: list = []
        self._joined: tuple[str | None, SayParams] | None = None
        # False once the running turn has done its last read of what was said: later words start
        # a turn of their own, because this one would end without answering them.
        self._inbox_open = True
        self._starting: str | None = None  # a say's turn id between its reply and its start
        items.expire_live_only()  # what a last run left tied to a process can no longer run
        # Scout's offer to approve a repeated kind of ask; one service for tools and experts.
        offer = self._offers = Offers(
            model,
            budget,
            memory,
            self._asks,
            items,
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
        self.jobs = Jobs(
            self.records,
            self._asks,
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
            origin_body=self._turn_origin,
            drop=self._drop_news,
            on_timers_changed=lambda: timers.changed(),
            outputs=outputs,
            items=items,
            apps=apps,
            before_start=before_job,
        )
        self.jobs.startup()  # parts left running by a dead brain: held for a carry-on, or failed
        timers = self.timers = Timers(
            self.records.work,
            self.post_event,
            now,
            job_facts=self.jobs.wake_facts,
            rerun=self._rerun_step,
            notify=notify,
        )
        choices = Choices(self._asks, self.post_event, items)
        tools = (
            brain_tools(memory, notify)
            + home_tools(budget, lambda: self.toolbox, keys)
            + model_tools(memory.db, model_default, notify)
            + voice_tools(lambda: self.voice)
            + expert_tools(self.jobs, self.owner_turn)
            + work_tools(self.records.work, self.jobs, timers.changed)
            + timer_tools(self.records, timers, now)
            + timer_home_tools(self.records.work, timers)
            + output_tools(outputs)
            + question_tools(questions)
            + choice_tools(choices)
            + preference_tools(approvals, self._asks)
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
            OpenItems(memory.db, now),
            self._asks,
            lambda: self.toolbox,
            self.post_event,
            now,
            approvals,
            self._turn_origin,
        )
        self._asks.on_item_answer = self._post_card_answer
        self.toolbox = Toolbox(
            [BrainSource(tools), *sources],
            modes,
            save_mode,
            self._asks,
            self.engine,
            owner_turn=lambda turn_id: self._owner_turn and turn_id == self._turn_id,
            on_call=self._on_tool_call,
            outputs=outputs,
            runner=self.ask_runner,
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
        self._rejected = False  # the API answered the running turn's request with a 400
        self._turn_id: str | None = None
        # True while the running turn is the owner's: they started it, or they typed into it.
        # A wake turn stays Scout's own until then, so its follow-ups still ask.
        self._owner_turn = False
        self._task: asyncio.Task | None = None
        # Set when the owner talks over the running turn: it stops at once and winds down by itself.
        self._stop: asyncio.Event | None = None
        # Tools a paused turn left running; held here so they are not collected before they end.
        self._background: set[asyncio.Future] = set()
        self._last_turn: str | None = (
            None  # the turn that ended last, which can still be spoken over
        )
        self._last_body: str | None = None  # where a wake turn goes first
        self._turn_body: str | None = None  # the body showing the running turn
        # The job the running turn works for: a wake about it, or a job tool named it. Tool and
        # app calls in the turn are recorded on that job's timeline. Cleared when the turn ends.
        self._turn_job: str | None = None
        self._wake_jobs: set[str] = set()
        self._spoken: set[str] = set()  # running turns whose reply is read aloud
        # Each body's last `read_aloud` event: read every turn it shows aloud, in which voice, and
        # whether it uses its system voice. Kept across a reconnect; the body also resends it.
        self._read_aloud: dict[str, ReadAloudData] = {}
        bodies.on_connect = self._on_connect
        for job in self.records.unreported_jobs():  # ended while the brain was down, or never told
            self._on_job_finished(job)
        self._tell_paused_watches()
        # Steps that gave up (or that the restart scan could not vouch for) and were never told.
        for step in self.records.work.of_kind("tool_call", ["failed"]):
            if step.reported_at is None:
                self._tell_given_up(step)
        timers.start()
        self.ask_runner.start()
        self.dispatcher.start()  # a no-op until a loop runs; a post starts it then

    def _tell_paused_watches(self) -> None:
        """Watches a migration paused are mentioned once, then marked told."""
        work = self.records.work
        paused = [w for w in work.of_kind("watch", ["paused"]) if w.reported_at is None]
        if not paused:
            return
        entries = [
            f"{w.id}: {w.title}"
            + (f" ({(w.input or {})['cadence']})" if (w.input or {}).get("cadence") else "")
            for w in paused
        ]
        told = [entries[0][:1500]]  # whole entries only; one alone may be cut
        for entry in entries[1:]:
            if len("; ".join([*told, entry])) > 1500:
                break
            told.append(entry)
        self.post_event(Event("watches_paused", {"watches": "; ".join(told)}))
        for w in paused[: len(told)]:  # the rest are told at the next start
            work.mark_reported(w.id)

    async def say(self, body_id: str, params: SayParams) -> SayResult:
        check_part_sizes(params.parts or [])  # over_limit, before anything changes
        content = user_content(params)  # may raise ValueError before anything changes
        sender = self._bodies.body(body_id)
        shown_on: str | None = body_id
        if sender is not None and sender.display is False:
            shown_on = self._display_target()  # its answer must appear where someone can see it
        else:
            self._last_body = body_id
        if params.interrupted is not None and self._ready():
            after = self._task if self._busy() else None
            cut = self.interrupt(params.interrupted.turn, params.interrupted.heard)
            if cut is not None:
                turn = self._start_turn(shown_on, content, after=after, cut=cut)
                self._speak(turn, shown_on, params)
                return SayResult(turn=turn, joined=False)
        if not self._ready():
            return SayResult(turn=self._end_unanswered(shown_on), joined=False)
        # Through the front door like every source. Whether it joins the running turn or starts
        # one is decided when the door delivers it, so the answer is never stale.
        result: asyncio.Future[SayResult] = asyncio.get_running_loop().create_future()
        token = uuid.uuid4().hex
        self._says_waiting.add(token)
        payload = {"token": token, "result": result, "content": content, "params": params}
        self.dispatcher.post(Item("say", shown_on or BRAIN, payload, "now"))
        # Shielded: a body that disconnects cancels its caller, but the say is still delivered.
        return await asyncio.shield(result)

    def post_event(
        self,
        event: Event,
        *,
        on_start: Callable[[], None] | None = None,
        on_drop: Callable[[], None] | None = None,
        on_end: Callable[[str], None] | None = None,
        retell: bool = False,
    ) -> None:
        """Every wake source posts here: the dispatcher decides when, batches and
        caps it, and the wake turn is shown on the event's origin body when it can."""
        ended = on_end
        if on_end is not None and retell:

            def ended(reason: str) -> None:
                on_end(reason)
                if reason == "cancelled":  # news a cancelled turn did not tell: once more, no more
                    self.post_event(event, on_start=on_start, on_drop=on_drop, on_end=on_end)

        item = Item(
            event.kind,
            event.origin_body,
            dict(event.facts),
            "idle",
            event.key,
            on_start,
            on_drop,
            ended,
        )
        self.dispatcher.post(item)

    def _post_card_answer(self, ask_id: str, option: str, body_id: str) -> None:
        self.dispatcher.post(Item("card_answer", body_id, {"ask": ask_id, "option": option}, "now"))

    async def _deliver(self, item: Item) -> None:
        """The dispatcher's hand-over for kinds that never wake: a say becomes a turn, a card
        answer runs its saved call, and context (focus, tab, setup progress) is kept."""
        if item.kind == "say":
            await self._deliver_say(item)
        elif item.kind == "card_answer":
            self.ask_runner.answered(item.payload["ask"], item.payload["option"], item.origin_body)
        else:
            self.dispatcher.record(
                Event(item.kind, item.payload, key=item.key, origin_body=item.origin_body)
            )

    def _say_gave_up(self, item: Item) -> None:
        """The dispatcher gave up on a say (or is stopping): its caller hears it failed, and its
        token goes, else `_busy_for_wakes` would stay true and no wake would ever start."""
        if item.kind != "say":
            return
        self._says_waiting.discard(item.payload["token"])
        result: asyncio.Future[SayResult] = item.payload["result"]
        if not result.done():
            result.set_exception(RuntimeError("the say could not be delivered"))

    async def _deliver_say(self, item: Item) -> None:
        """Never waits on a turn: words arriving mid-turn join it at its next step (same body, and
        the turn still reading), another body's wait for their own turn, and with no turn running
        they start one. The say's caller is answered here, with the turn that really has them."""
        shown = None if item.origin_body == BRAIN else item.origin_body
        content, params = item.payload["content"], item.payload["params"]
        result: asyncio.Future[SayResult] = item.payload["result"]
        try:
            while self._task is not None and self._task.done():
                await asyncio.sleep(0)  # its done callback runs next and clears the turn
            if self._busy() and self._inbox_open and self._turn_body == shown:
                self._inbox.append(content)
                self._joined = (shown, params)  # the newest, if its turn is cut
                self._speak(self._turn_id, self._turn_body, params)
                if not result.done():
                    result.set_result(SayResult(turn=self._turn_id or "", joined=True))
            elif self._busy():
                turn = uuid.uuid4().hex
                self._later.append((shown, turn, content, params))
                if not result.done():
                    result.set_result(SayResult(turn=turn, joined=False))
            else:
                turn = uuid.uuid4().hex
                # The caller learns the turn id before its `started` goes out.
                if not result.done():
                    result.set_result(SayResult(turn=turn, joined=False))
                self._starting = turn
                await asyncio.sleep(0)
                cut = self._starting != turn  # cancelled in the moment before its turn began
                self._starting = None
                if cut:
                    self._end_cancelled(turn, shown)
                else:
                    self._start_turn(shown, content, turn_id=turn)
                    self._speak(turn, shown, params)
        except BaseException as err:
            if not result.done():
                result.set_exception(err)
            if not isinstance(err, Exception):
                raise
            log.exception("could not deliver a say")
        finally:
            self._says_waiting.discard(item.payload["token"])  # the dispatcher pumps wakes next

    async def _interject(self, body_id: str, content: list) -> bool:
        """News due at a sentence break while Scout speaks: the queue holds, one short call sees
        the news and the sentences not yet said, and Scout continues or says new words instead
        (no choice resumes). The running turn keeps owning the queue; this only borrows it.
        False when there is no voice, no ready model or nothing queued: a plain wake follows."""
        voice = self.voice
        if voice is None or not self._ready():
            return False
        turn, unsaid = voice.queued(body_id)
        if turn is None:
            return False
        voice.pause()
        try:
            ran, words = await asyncio.wait_for(
                interject(self._model, self._budget, self.guards, content, unsaid),
                INTERJECTION_TIMEOUT_S,
            )
            if words is not None:
                voice.replace(turn, body_id, words)
        finally:
            voice.resume()  # whatever happened, the queue never stays held
        return ran

    def _turn_origin(self, turn_id: str | None = None) -> str:
        """The body showing the running turn (or the given one), "brain" when none."""
        if turn_id is not None and turn_id != self._turn_id:
            return BRAIN
        return self._turn_body or BRAIN

    def _busy_for_wakes(self) -> bool:
        # A say waiting its turn goes before any wake: the dispatcher holds its batch meanwhile.
        return self._busy() or bool(self._says_waiting) or bool(self._later)

    def interrupt(self, turn: str, heard: int) -> Interruption | None:
        """The owner spoke over `turn` after the body played `heard` of its sentences. Stops what
        is still being said and pauses the turn if it is running: generation ends, tools already
        running finish in the background (their results come back through the front door) and
        nothing else is cancelled, open items included. Returns what was said and what was left,
        or None when there is nothing to hand over: a turn this session no longer knows, or one
        the owner heard to the end (then their words are a plain say)."""
        live = turn == self._turn_id
        if self.voice is None or not (live or (turn == self._last_turn and not self._busy())):
            return None
        sentences = self.voice.sentences(turn)
        unsaid = " ".join(sentences[heard:])
        # A turn still running is paused even with nothing unsaid: the model has more to come.
        if not unsaid and not (live and self._busy()):
            return None
        if self._turn_body is not None:
            self.voice.hush(self._turn_body)  # queued sentences must not keep coming
        if live and self._busy() and self._stop is not None:
            self._stop.set()
        return Interruption(" ".join(sentences[:heard]), unsaid)

    async def stop_background(self) -> None:
        """The brain is closing: tools a paused turn left running end with it. (The Stop button
        cannot reach them; a paused turn is gone, so nothing holds their calls any more.)"""
        left = list(self._background)
        for task in left:
            task.cancel()
        await asyncio.gather(*left, return_exceptions=True)

    def _detached(self, call: dict, task: asyncio.Future, body_id: str | None) -> None:
        """A tool the paused turn left running: when it ends, its result enters the front door
        like any other news, so a later turn (not this one) tells the owner."""
        self._background.add(task)

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
            self.post_event(
                Event("tool_result", facts, key=call["id"], origin_body=body_id or BRAIN)
            )

        task.add_done_callback(done)

    def _record_cut(self, cut: Interruption) -> None:
        """History keeps what the owner heard, marked as cut off, never the unsaid rest."""
        if self._wordless_cancel:  # the request gets its (heard) answer below, so it is kept
            self._wordless_cancel = False
            self._set_last_cut(False)
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
        last = self.history[-1] if self.history else None
        if last is not None and last["role"] == "user" and self._saved == len(self.history):
            self.history.pop()
            self._saved = len(self.history)

    def _reject(self) -> None:
        self._rejected = True

    def _set_last_cut(self, cut: bool) -> None:
        try:
            self._memory.set_last_cut(cut)
        except Exception:
            log.exception("could not mark the cut-off request")

    def _close_inbox(self) -> None:
        self._inbox_open = False

    def _owner_joined(self) -> None:
        # The owner's words reached the model, so a nudge from here on is theirs; one already
        # in flight when they joined still asks.
        self._owner_turn = True

    def owner_turn(self) -> bool:
        """True while the running turn is the owner's, so a follow-up in it needs no ask."""
        return self._owner_turn and self._busy()

    def _ready(self) -> bool:
        return getattr(self._model, "ready", True)  # fakes and other models need no key

    def _end_unanswered(self, body_id: str | None) -> str:
        """No key: the turn starts and ends at once, no reply, no history. The app says why."""
        turn_id = uuid.uuid4().hex
        notify = self._bodies.notify
        loop = asyncio.get_running_loop()
        loop.call_soon(
            notify,
            "turn",
            {"turn": turn_id, "body": body_id, "state": "started", "started_by": "user"},
        )
        loop.call_soon(
            notify,
            "turn",
            {"turn": turn_id, "body": body_id, "state": "ended", "reason": "error"},
        )
        return turn_id

    def _end_cancelled(self, turn_id: str, body_id: str | None) -> None:
        """A say cancelled before its turn began: the body still sees it start and end."""
        notify = self._bodies.notify
        started = {"turn": turn_id, "body": body_id, "state": "started", "started_by": "user"}
        notify("turn", started)
        notify("turn", {"turn": turn_id, "body": body_id, "state": "ended", "reason": "cancelled"})

    def _speak(self, turn: str | None, shown_on: str | None, params: SayParams | None) -> None:
        """A turn is read aloud when the user spoke (`params.spoken`) or the body showing it asked
        for read-aloud; on that body only, because speech never goes to a body that did not
        display the turn. A body that turned read-aloud off silences everything, spoken or not.
        `params` is None for a turn the brain started."""
        if self.voice is None or shown_on is None or turn is None:
            return
        ask = self._read_aloud.get(shown_on)
        if ask is not None and not ask.on:
            return
        if not (params is not None and params.spoken) and not (ask and ask.on):
            return
        voice, speed = (ask.voice, ask.speed) if ask else (None, None)
        if params is not None:
            voice = params.voice if params.voice is not None else voice
            speed = params.speed if params.speed is not None else speed
        self._spoken.add(turn)
        # Every time: the voice drops a hushed turn, and a later say must re-arm it. It ignores
        # a say for a turn it is already speaking.
        self.voice.spoken(turn, shown_on, voice, speed, ask.system_voice if ask else False)

    def _drop_news(self, kind: str, key: str) -> None:
        """A waiting event is superseded: the dispatcher forgets it wherever it waits."""
        self.dispatcher.drop(kind, key)

    def _display_target(self) -> str | None:
        shown = self._bodies.display_ids()
        last = self._last_body
        # A page's words are not shown on the phone while a screen is online.
        if last in shown and (last == shown[0] or not self._bodies.is_phone(last)):
            return last
        return shown[0] if shown else None

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
            self._from_body(replace(event, origin_body=body_id))

    def _from_body(self, event: Event) -> None:
        """A body's event enters the front door when it can wake Scout, so the reply goes back
        to that body; one that only keeps context is stored at once, ahead of the next turn."""
        if self._kinds.get(event.kind, EventKind(event.kind, wakes=False)).wakes:
            self.post_event(event)
        else:
            self.dispatcher.record(event)

    def body_gone(self, body_id: str) -> None:
        """A body disconnected for good: its reading status must not outlive it."""
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
            self._from_body(replace(event, origin_body=body_id))
        self.dispatcher.pump()  # also starts a wake that was waiting for a body
        body = self._bodies.body(body_id)
        if body is not None and body.display is not False:
            self.ask_runner.returned(away)  # cards come back, ended ones close, Scout is told
            self._offers.resume()  # offers the last run left unanswered are shown again

    def _on_job_finished(self, job: Job) -> None:
        self._emit_job_event(
            Event("job_ended", {"report": self.jobs.note(job)}, key=job.id),
            on_end=_when_told(lambda: self.records.mark_reported(job.id)),
            retell=True,
        )

    def _emit_job_event(self, event: Event, **hooks) -> None:
        """Emit a job's event; the wake turn it starts is bound to that job."""
        key = event.key or ""
        job = key[4:] if key.startswith("job:") else (key if event.kind == "job_ended" else "")
        on_start = hooks.pop("on_start", None)

        def started() -> None:
            if job:
                # A batched wake can carry several jobs: bind only when it is exactly one, else
                # the first job tool of the turn decides.
                self._wake_jobs.add(job)
                self._turn_job = job if len(self._wake_jobs) == 1 else None
            if on_start is not None:
                on_start()

        origin = self.jobs.origin(job)
        self.post_event(replace(event, origin_body=origin), on_start=started, **hooks)

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
        try:
            row = work.fail(id, classify(error or RuntimeError()), str(error or "failed"))
        except TransitionRefused:
            # The goal was closed while it ran (handled), or a failed start already ended the
            # row itself and nobody has been told.
            row = work.get(id)
            if row is None or row.state != "failed" or row.reported_at is not None:
                return
        if row.state != "failed":
            self.timers.changed()  # the next try is waiting out its backoff
            return
        self._tell_given_up(row)

    def _tell_given_up(self, row: WorkRow) -> None:
        """Scout is woken once about a step that ended failed; the wake starting marks it told."""
        work = self.records.work
        facts = {
            "goal": row.root_id,
            "step": row.id,
            "title": row.title,
            "reason": row.end_reason or "",
        }
        self.post_event(
            Event("work_failed", facts, key=f"work_failed:{row.id}"),
            on_end=_when_told(lambda: work.mark_reported(row.id)),
            retell=True,
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
                {"job": job_id, "message": what},
                key=job_id,
                origin_body=self.jobs.origin(job_id),
            )
        )

    def _busy(self) -> bool:
        return self._task is not None and not self._task.done()

    def _start_wake(self, body_id: str | None, content: list) -> str:
        if not self._ready():
            raise WakeSkipped  # dropped quietly; unreported jobs are told at a later start
        turn = self._start_turn(body_id, content, "brain")
        self._speak(turn, body_id, None)  # remarks and hellos are read aloud like any reply
        return turn

    def _start_turn(
        self,
        body_id: str | None,
        content: list,
        started_by: Literal["user", "brain"] = "user",
        *,
        after: asyncio.Task | None = None,
        cut: Interruption | None = None,
        turn_id: str | None = None,
    ) -> str:
        """`after` is a cancelled turn still winding down: this one waits for it, so the history it
        closes is valid before anything is added. `cut` is what the owner talked over.
        `turn_id` is the id a say already told its body."""
        turn_id = turn_id or uuid.uuid4().hex
        self._turn_id = turn_id
        self._inbox_open = True
        self._turn_job = None
        self._wake_jobs = set()
        self._stop = stop = asyncio.Event()
        self._owner_turn = started_by == "user"
        self._turn_body = body_id
        lead = [interruption_block(cut.spoken, cut.unsaid)] if cut is not None else []

        def prepare() -> None:
            if cut is not None:
                self._record_cut(cut)
            else:
                self._drop_unanswered()
            if self._inbox:  # says from the finished turn come before this newer one
                self._append_user([b for s in self._inbox for b in s])
                self._inbox.clear()
            self._append_user(lead + content)

        if after is None:
            prepare()
        # Read once per turn so the system prompt stays identical across its steps (cache).
        know = render_know(self._memory.always_loaded())
        prefs = render_preferences(rules.list_preferences(self._memory.db))
        notify = self._bodies.notify
        # Deferred a tick so the say result goes out before the started notification.
        asyncio.get_running_loop().call_soon(
            notify,
            "turn",
            {"turn": turn_id, "body": body_id, "state": "started", "started_by": started_by},
        )

        def spoken_notify(method: str, params: dict) -> None:
            notify(method, params)
            if method == "reply" and turn_id in self._spoken and self.voice is not None:
                self.voice.reply(turn_id, body_id, params)

        async def run() -> str:
            if after is not None:
                await asyncio.wait({after})
                prepare()
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
                ),
                history=self.history,
                tools=self.toolbox.model_tools,
                run_tool=self.toolbox.run,
                notify=spoken_notify,
                budget=self._budget,
                step_cap=self._step_cap,
                guards=self.guards,
                turn_timeout=self._turn_timeout,
                inbox=self._inbox,
                on_owner_input=self._owner_joined,
                on_last_read=self._close_inbox,
                on_rejected=self._reject,
                stop=stop,
                on_detached=lambda call, task: self._detached(call, task, body_id),
            )

        task = asyncio.create_task(run())
        self._task = task
        # resolved now: the body may leave before the turn ends, and the saved rows keep its kind
        shown = self._bodies.body(body_id) if body_id is not None else None
        body_kind = shown.kind if shown is not None else BODY_DESKTOP
        task.add_done_callback(lambda t: self._ended(t, turn_id, body_id, lead, body_kind))
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
            builtin, bodies, apps, experts, self.reading.ocr_problem(), asks=asking
        )

    def cancel(self, turn_id: str) -> None:
        if turn_id == self._turn_id and self._task is not None:
            self._task.cancel()
        elif turn_id == self._starting:
            self._starting = None
        elif any(turn == turn_id for _, turn, _, _ in self._later):
            shown = next(b for b, turn, _, _ in self._later if turn == turn_id)
            self._later = [x for x in self._later if x[1] != turn_id]
            self._end_cancelled(turn_id, shown)
            self.dispatcher.pump()

    def answer(
        self,
        ask_id: str,
        option: str,
        body_id: str,
        text: str | None = None,
        apps: list[str] | None = None,
    ) -> None:
        try:
            self._asks.answer(ask_id, option, body_id, text, apps)
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
        return {key: ev.facts for key, ev in self.dispatcher.latest(kind).items()}

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
        if task.cancelled():
            reason = "cancelled"
        elif task.exception() is not None:
            log.error("turn failed", exc_info=task.exception())
            reason = "error"
        else:
            reason = task.result()
        pending: list = []
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
            and not (
                isinstance(last["content"], list)
                and any(b.get("type") == "tool_result" for b in last["content"])
            )
        )
        if owns:
            if self._inbox and (reason != "done" or rejected):
                # Joined a turn that did not finish: they get a turn of their own, not a
                # silent place in an unanswered one.
                pending = [b for s in self._inbox for b in s]
                self._inbox.clear()
            elif self._inbox:  # says that arrived too late for the loop must not be lost
                self._append_user([b for s in self._inbox for b in s])
                self._inbox.clear()
            self._turn_id = None
            self._turn_job = None
            self._owner_turn = False
            self._task = None
        self._last_turn = turn_id
        joined, self._joined = self._joined, None
        self._persist(body_kind)
        if unanswered and self._saved == len(self.history):
            self._wordless_cancel = True
            self._set_last_cut(True)  # the saved chat keeps it; a restart skips it
        if turn_id in self._spoken:
            self._spoken.discard(turn_id)
            if self.voice is not None:
                self.voice.turn_ended(turn_id)
        self._bodies.notify(
            "turn", {"turn": turn_id, "body": body_id, "state": "ended", "reason": reason}
        )
        # after ended, so the next turn's started comes second
        self.dispatcher.turn_ended(turn_id, reason)
        if pending:
            shown, params = joined if joined is not None else (body_id, None)
            self._speak(self._start_turn(shown, pending), shown, params)
        elif self._later and self._task is None:
            shown, turn, content, params = self._later.pop(0)
            self._start_turn(shown, content, turn_id=turn)
            self._speak(turn, shown, params)

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

    def _persist(self, body: str) -> None:
        # Saving is best effort: a full disk must not stop the ended notification.
        try:
            # A masked copy goes to disk; self.history keeps the real values for the live turn.
            new = [self._masked(m) for m in self.history[self._saved :]]
            self._memory.save_messages(new, body)
            self._saved = len(self.history)  # before summaries, so a failure there cannot re-save
            for message in new:
                if message["role"] != "assistant" or isinstance(message["content"], str):
                    continue
                for block in message["content"]:
                    if block.get("type") == "compaction" and (text := compaction_text(block)):
                        self._memory.add_summary(text)
        except Exception:
            log.exception("could not save the chat")


def _when_told(mark: Callable[[], None]) -> Callable[[str], None]:
    """Mark news told only when the turn carrying it finished: a cancelled or failed turn did not
    tell it, so it stays for the next start (a cancelled one is also posted again, once)."""

    def on_end(reason: str) -> None:
        if reason == "done":
            mark()

    return on_end


def _is_in(block: Any, blocks: list) -> bool:
    return any(block is b for b in blocks)
