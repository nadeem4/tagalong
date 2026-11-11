"""Jobs: Scout's hand-offs to Claude Code, from the folder check to the finished row.
Owns the running ExpertRuns, asks the user to pick a mode (the hand-off ask), relays Claude
Code's own permission and question prompts as turn-less asks, and keeps the job records current.
It tells bodies through the injected notify (`changed: jobs`, `changed: job_activity`).
"""

import asyncio
import inspect
import logging
import shutil
import time
import uuid
from collections.abc import Awaitable, Callable, Sequence
from contextlib import suppress
from dataclasses import asdict, replace
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Literal

from brain.asks import Answer, Asks
from brain.config import DEFAULT_JOB_STEPS_MAX_BYTES, DEFAULT_JOB_STEPS_MAX_ENTRIES
from brain.events import Event
from brain.experts import ExpertHosts, ExpertRun, PermissionRequest, Question, QuietFacts
from brain.guards import Guards
from brain.job_activity import PAGE_LIMIT, JobActivity, _clip, activity_line, activity_summary
from brain.job_records import Job, JobPart, JobRecords, home_state
from brain.masking import mask_json
from brain.open_items import OpenItemRefused, OpenItems
from brain.outputs import OutputStore, preview
from brain.permission import (
    AskRequest,
    Engine,
    NoOneThere,
    PersonAnswer,
    Tier,
    expert_asker,
    summarise,
)
from brain.protocol import ErrorCode, RpcError
from brain.questions import ScoutQuestions
from brain.setup.install import NODE_FLOOR
from brain.setup.store import InstalledExpert
from brain.store.work import OPEN, ActivityEntry, TransitionRefused, WorkRow

log = logging.getLogger("brain")

# The approvals source for every expert's asks (memory.py constrains the value); the tool
# prefix and group key come from the job's expert (see _prefix), so a preference saved for one
# expert never approves another's asks.
AGENT = "claude_code"


WATCH_MAX_ITEMS = 10
WATCH_TEXT_MAX = 200


def _prefix(agent: str) -> str:
    """Claude Code keeps its old `claude_code` prefix, so saved preferences and the bodies' label
    for its asks still match; any other expert is keyed by its own id."""
    return AGENT if agent == "claude-acp" else agent


# What an expert's run reports when it ends, in the words of a work row.
_WORK_STATE = {"done": "done", "error": "failed", "stopped": "cancelled"}

CANCEL = "cancel"
PROGRESS_NOTIFY_S = 2.0  # progress chunks are cheap; bodies refetch at most this often
ACTIVITY_NOTIFY_S = 0.25  # a watched job's steps: a page of Home or the bubble polls this often
LIST_LIMIT = 20
TITLE_FALLBACK_CHARS = 80


class JobError(Exception):
    """A plain message for the model or the user; never a crash. `facts` (JSON-able ids and
    numbers, no sentences) lets Scout reason about a setup problem and word it himself."""

    def __init__(self, message: str, facts: dict | None = None) -> None:
        super().__init__(message)
        self.facts = facts or {}


class JobId(str):
    """A job id that also carries the session facts of its start, for the hand_off result."""

    def __new__(
        cls,
        job_id: str,
        session: str = "fresh",
        why_fresh: str | None = None,
        parent_job: str | None = None,
        part: str = "p1",
        title: str | None = None,
    ):
        self = super().__new__(cls, job_id)
        self.part = part  # the part this start made
        self.parent_job = parent_job  # the job whose session this one continues, if any
        self.session = session  # "continued" or "fresh"
        self.why_fresh = why_fresh
        self.title = title  # the saved, masked title of a job this start opened
        self.mode: str | None = None  # the mode the person chose on the card, by its name
        return self


class Jobs:
    def __init__(
        self,
        records: JobRecords,
        asks: Asks,
        notify: Callable[[str, dict], None],
        experts: Callable[[], list[InstalledExpert]],
        make_run: Callable[..., ExpertRun],
        max_running: int = 2,
        on_finished: Callable[[Job], object] = lambda job: None,
        clock: Callable[[], float] = time.monotonic,
        scout_questions: ScoutQuestions | None = None,
        engine: Engine | None = None,
        guards: Guards | None = None,
        on_away: Callable[[str, str], None] = lambda job_id, what: None,
        setup_facts: Callable[[], Awaitable[dict]] | None = None,
        emit: Callable[[Event], None] = lambda event: None,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        drop: Callable[[str, str], None] = lambda kind, key: None,
        on_timers_changed: Callable[[], None] = lambda: None,
        outputs: OutputStore | None = None,
        items: OpenItems | None = None,
        apps=None,
        before_start: Callable[[], Awaitable[None]] | None = None,
        steps_max_entries: int = DEFAULT_JOB_STEPS_MAX_ENTRIES,
        steps_max_bytes: int = DEFAULT_JOB_STEPS_MAX_BYTES,
    ) -> None:
        self._items = items  # an expert's permission ask is a live-only item; None: none kept
        self._steps_max_entries = steps_max_entries  # caps of one job's step log (settings)
        self._steps_max_bytes = steps_max_bytes
        self._before_start = before_start  # awaited before a run starts: no update mid-swap
        self._apps = apps  # the connected apps (ids, names, state); None: none can be handed over
        self._outputs = outputs  # caps the report a wake carries; None leaves it whole
        self._timers_changed = on_timers_changed  # a deleted job timer must re-arm the sleeper
        self._now = now  # wall time for activity stamps and how long a step has run
        self._emit = emit  # the Scheduler's emit: a quiet job wakes Scout through it
        self._drop = drop  # the Scheduler's drop: a held job event goes when the job ends
        self._records = records  # the jobs themselves: goal and expert-call rows
        self._setup_facts = setup_facts  # machine and registry facts for a setup refusal
        self._asks = asks
        self._notify = notify
        self._experts = experts  # read afresh: an install adds one while the brain runs
        # Called with the expert, then the job id and the callbacks as keywords.
        self._make_run = make_run
        self._hosts = make_run if isinstance(make_run, ExpertHosts) else None
        self._max_running = max_running
        self._on_finished = on_finished
        self._on_away = on_away  # an ask found nobody online: (job id, what it asked)
        self._clock = clock
        self._scout = scout_questions
        self._engine = engine  # decides every expert ask; None refuses them all
        self._guards = guards if guards is not None else Guards()  # masking only
        self._runs: dict[str, dict[str, ExpertRun]] = {}  # job -> part -> its running expert
        self._activity: dict[str, dict[str, JobActivity]] = {}
        self._scout_steps: dict[str, JobActivity] = {}  # job -> writer of Scout's own steps
        self._reserved: dict[str, set[str]] = {}  # job -> part ids promised to starts in flight
        self._starting = 0  # hand-offs waiting on their ask also hold a slot
        self._ask_ids: dict[tuple[str, str], set[str]] = {}  # (job, part) -> its open asks
        self._progress_sent: dict[str, float] = {}
        self._activity_sent: dict[str, float] = {}
        self._activity_trailing: dict[str, asyncio.Task] = {}

    @property
    def starting(self) -> int:
        """Hand-offs that hold a slot but have no row yet (waiting on their card)."""
        return self._starting

    def startup(self) -> list[tuple[str, str]]:
        """Settle what a dead brain left running (the resume scan): a call that saved a session is
        held for Scout to carry on, any other ends as failed. Each such part's log ends there and
        its timers stay planned. Returns the scan's (work id, outcome) pairs."""
        work = self._records.work
        settled = work.resume_scan(self.can_resume_row)
        # The end lines come after the scan commits; a crash between only loses them, because
        # resume_scan is idempotent and will not settle these rows twice.
        for work_id, outcome in settled:
            row = work.get(work_id)
            if outcome == "held a secret":
                continue  # Scout's own ask: the waiting asks tell him once, when his wake starts
            if row is not None and row.kind in ("ask", "question"):
                work.mark_reported(work_id)  # nobody is told of an ask that died with the brain
                continue
            if row is None or row.kind != "expert_call" or row.parent_id is None:
                continue
            job_id = row.parent_id
            work.save_activity(
                job_id,
                ActivityEntry(
                    rev=work.last_rev(job_id) + 1,
                    seq=work.max_seq(job_id) + 1,
                    at=self._now().isoformat(),
                    kind="end",
                    text="# stopped",
                    part=work_id.split(".", 1)[1],
                ),
            )
            self._close_open_steps(job_id, work_id.split(".", 1)[1])
        return settled

    def _close_open_steps(self, job_id: str, part: str) -> None:
        """A part that ended with the brain keeps no step "running": close each as stopped."""
        work = self._records.work
        for e in work.activity_after(job_id, 0, 100_000):
            if e.part == part and e.status in ("running", "pending"):
                work.save_activity(
                    job_id,
                    replace(e, rev=work.last_rev(job_id) + 1, status="stopped"),
                )

    def can_resume_row(self, row: WorkRow) -> bool | None:
        """Whether the expert that ran this call reopens sessions; None when not known yet."""
        agent = (self._records.work.job_detail(row.id) or {}).get("agent")
        return self.can_resume(agent) if agent else None

    def installed(self) -> list[InstalledExpert]:
        return self._experts()

    def can_resume(self, expert_id: str) -> bool | None:
        """Whether the expert's adapter reopens sessions; None until it has been started."""
        return self._hosts.can_resume(expert_id) if self._hosts else None

    def _earlier(self, job_id: str, folder: str, expert: str | None) -> Job:
        """The finished job a follow-up continues; the refusals are facts for the model."""
        earlier = self._records.get_job(job_id)
        if earlier is None:
            raise JobError(f"no job {job_id}")
        if earlier.state == "active":
            raise JobError(f"job {job_id} is still running; send it a note instead")
        ran_on = earlier.parts[-1].agent
        if expert is not None and expert != ran_on:
            raise JobError(f"job {job_id} ran on {ran_on}, which is another expert")
        worked_in = earlier.parts[-1].folder or earlier.folder
        if Path(folder) != Path(worked_in):
            raise JobError(f"job {job_id} worked in {worked_in}, which is another folder")
        return earlier

    async def _refusal(
        self, message: str, problem: str, expert: str | None = None, **more: object
    ) -> JobError:
        """A refusal Scout can act on: the problem, what is needed and what this machine and the
        registry offer. The facts source failing never hides the refusal itself."""
        facts: dict = {"problem": problem, **more}
        if problem in ("no_expert", "expert_missing_node"):
            facts["needs"] = {"node_major": NODE_FLOOR}
        if expert is not None:
            facts["expert"] = expert
        if self._setup_facts is not None:
            try:
                facts.update(await self._setup_facts())
            except Exception:
                log.warning("setup facts failed", exc_info=True)
        return JobError(message, facts)

    async def _pick(self, named: str | None) -> InstalledExpert:
        """The named expert, or the only one; the refusals are facts for the model to word."""
        found = self._experts()
        ids = ", ".join(e.id for e in found)
        if named is not None:
            match = next((e for e in found if e.id == named), None)
            if match is None:
                message = f"expert {named} is not installed; installed: {ids or 'none'}"
                raise await self._refusal(
                    message, "unknown_expert", named, installed=[e.id for e in found]
                )
            return await self._usable(match)
        if not found:
            raise await self._refusal("no experts installed", "no_expert")
        if len(found) > 1:
            raise JobError(f"several experts installed, name one: {ids}")
        return await self._usable(found[0])

    async def _usable(self, expert: InstalledExpert) -> InstalledExpert:
        """Refuse before spawning when the record already says it cannot work."""
        if expert.logged_in is False:
            raise await self._refusal(
                f"{expert.id} is not logged in", "expert_not_logged_in", expert.id
            )
        if expert.node is not None and shutil.which(expert.command[0]) is None:
            raise await self._refusal(
                f"{expert.id} cannot find its node", "expert_missing_node", expert.id
            )
        return expert

    async def start(
        self,
        task: str,
        folder: str,
        expert: str | None = None,
        continue_job: str | None = None,
        *,
        fresh: bool = False,
        job: str | None = None,
        title: str | None = None,
        apps: Sequence[str] = (),
    ) -> JobId:
        """Hand the task to an expert once the user picks a mode. Returns the job id.

        continue_job reopens that finished job's session (same expert, same folder); when the
        expert cannot, a fresh session starts and the result says why. The caller
        has already checked that a person's message started this. Without continue_job the
        expert's last finished session in this folder is continued (its mode is not carried over,
        the card is shown as for any new job); fresh=True skips that. job adds a part to that open
        job (title is then ignored); otherwise a new job opens with Scout's title, if any.

        apps are connected app ids the expert may use through the brain. They are listed on the
        card and the person may remove some; Send approves the rest, and the job starts with
        only those. Unknown or unavailable ids are refused before anything starts."""
        if continue_job and fresh:
            raise JobError("pass continue_job or fresh, not both")
        earlier = self._earlier(continue_job, folder, expert) if continue_job else None
        earlier_part = earlier.parts[-1] if earlier else None
        if job is not None:
            existing = self._records.get_job(job)
            if existing is None:
                raise JobError(f"no job {job}")
            if existing.closed_at:
                raise JobError(f"job {job} is closed; open a new job instead")
        chosen = await self._pick(earlier_part.agent if earlier_part else expert)
        offered = self._check_apps(apps)
        path = Path(folder)
        if not (path.is_absolute() and path.is_dir()):
            raise JobError(f"no folder at {folder}")
        if earlier is None and not fresh:
            found = self._records.last_part_for(chosen.id, str(path))
            earlier, earlier_part = found if found else (None, None)
        started = await self._start_part(
            job or uuid.uuid4().hex[:8],
            chosen,
            task,
            path,
            earlier=earlier,
            earlier_part=earlier_part,
            new_job=job is None,
            apps=offered,
        )
        if earlier and earlier_part:
            # An explicit carry-on closes whatever a restart, shutdown or stop left behind. The
            # implicit same-folder path only settles a part the restart held, so a genuine
            # failure is not hidden by an unrelated new task.
            held = earlier_part.state == "blocked"
            if held or (continue_job and earlier_part.state in ("failed", "cancelled")):
                self._supersede(earlier, earlier_part, job)
        clean = mask_json(self._guards, "job_title", title.strip()) if title else ""
        if job is None and clean.strip():
            self._records.set_title(str(started), clean.strip())
        if job is None:
            saved = self._records.get_job(str(started))
            started.title = job_title(saved) if saved else None
        return started

    def _supersede(self, earlier: Job, part: JobPart, into: str | None) -> None:
        """Carried on: a part a restart, a shutdown or a stop left behind is done with once its
        continuation runs, so its job stops showing as open instead of lingering beside the new
        one. A part added to the same job, or another part still open, keeps the job open.
        Marking a failed or stopped part reported is safe only because the caller passed an
        explicit continue_job: the person asked to carry on, so nothing is hidden from them."""
        if part.state == "blocked":
            self._records.update_part(
                earlier.id, part.id, state="cancelled", reason="carried on", reported=True
            )
        else:
            self._records.update_part(earlier.id, part.id, reported=True)
        if into != earlier.id and not any(
            c.state in OPEN for c in self._records.work.children(earlier.id)
        ):
            goal = self._records.work.get(earlier.id)
            if goal is not None and goal.state in OPEN:
                self._records.work.transition(earlier.id, "cancelled", reason="carried on")
            self._records.mark_reported(earlier.id)

    def _check_apps(self, wanted: Sequence[str]) -> tuple[str, ...]:
        """The offered apps, deduplicated; a plain refusal for one that is unknown or not usable."""
        offered = tuple(dict.fromkeys(wanted))
        known = self._apps.ids() if self._apps is not None else []
        for app_id in offered:
            if app_id not in known:
                raise JobError(f"no app {app_id}; connected apps: {', '.join(known) or 'none'}")
            state = self._apps.status(app_id).state
            if state != "connected":
                raise JobError(
                    f"{app_id} is not connected (it is {state}); it cannot be handed over"
                )
        return offered

    def _card_apps(self, offered: tuple[str, ...]) -> list[dict]:
        return [{"id": a, "name": self._apps.name(a)} for a in offered]

    async def _start_part(
        self,
        job_id: str,
        chosen: InstalledExpert,
        task: str,
        path: Path,
        *,
        earlier: Job | None = None,
        earlier_part: JobPart | None = None,
        new_job: bool = True,
        apps: tuple[str, ...] = (),
        redo: WorkRow | None = None,
    ) -> JobId:
        """The one seam that starts an expert run: a new job's first part, or (new_job False) a
        further part of an existing job. redo is a part's own row, already active, run again in
        the job's mode: no card, no new row."""
        if self._before_start is not None:
            # Nothing between this wait and `_starting += 1` awaits, so an update that looks at
            # the jobs after it sees this one.
            await self._before_start()
            # An update may have swapped this expert's command while the job waited.
            chosen = next((e for e in self._experts() if e.id == chosen.id), chosen)
        running = [
            (j, p)
            for j in self._records.running_jobs()
            for p in j.parts
            if p.state == "active" and (j.id, p.id) != (job_id, redo and redo.id.split(".")[1])
        ]
        if len(running) + self._starting >= self._max_running:
            names = ", ".join(f"{j.id} ({p.task[:40]})" for j, p in running)
            raise JobError(f"{self._max_running} jobs are already running: {names}")
        # Named before the run exists so callbacks fired while it starts file under this part.
        if redo is not None:
            part = redo.id.split(".", 1)[1]
        else:
            part = "p1" if new_job else self._reserve_part(job_id)
        run = self._make_run(
            chosen,
            job_id=job_id,
            on_permission=lambda request: self._permission(job_id, request, part),
            on_question=lambda question: self._question(job_id, question, part),
            on_progress=lambda text: self._progress(job_id, text, part),
            on_end=lambda state, reason, result: self._end(job_id, state, reason, result, part),
            on_update=lambda update: self._activity_update(job_id, update, part),
            on_quiet=lambda facts: self._quiet(job_id, facts, part),
            apps=apps,
        )
        self._starting += 1
        slot_held = True  # released once the row exists, so a job never counts twice
        handed_off = False
        try:
            try:
                resume = earlier_part.session_id if earlier_part else None
                modes = await run.start(path, resume=resume)
            except Exception as exc:  # ExpertError, or the adapter refusing (e.g. auth required)
                raise JobError(str(exc) or type(exc).__name__) from exc
            if apps and not run.has_grant:
                # No bridge or no http MCP: the card would promise apps the expert can't reach.
                raise JobError("this expert can't take connected apps")
            by_name = {m.name: m.id for m in modes}
            mode_id = None
            if redo is not None:
                mode_id = self._redo_mode(job_id, by_name.values())
            kept = apps
            if mode_id is None:
                mode_id, kept = await self._hand_off_mode(chosen, task, path, by_name, apps)
                await run.keep_apps(kept)
            if redo is not None:
                pass  # the row exists and is active; the run attaches to it
            elif new_job:
                parent = earlier.id if earlier else None
                self._records.add_job(job_id, chosen.id, task, str(path), mode_id, parent)
            else:
                # Scout may have closed the job while the start awaited the expert or the card.
                current = self._records.get_job(job_id)
                if current is None or current.closed_at:
                    raise JobError(f"job {job_id} is closed; open a new job instead")
                added = self._records.add_part(job_id, chosen.id, task, str(path), part)
                assert added == part
            self._runs.setdefault(job_id, {})[part] = run
            self._activity.setdefault(job_id, {})[part] = JobActivity(
                job_id,
                self._records.work,
                lambda text: mask_json(self._guards, "job_activity", text),
                self._now,
                on_change=lambda: self._activity_changed(job_id),
                on_failed=lambda entry: self._step_failed(job_id, entry),
                part=part,
                max_entries=self._steps_max_entries,
                max_bytes=self._steps_max_bytes,
            )
            handed_off = True
            self._starting -= 1
            slot_held = False
            self._changed()
            try:
                await run.begin(mode_id, task)
            except BaseException as exc:
                # The row exists but nothing runs: end it, free the slot, kill the adapter.
                message = str(exc) or type(exc).__name__
                self._settle(job_id, part, "error", message, None)
                self._forget(job_id, part)
                self._changed()
                await run.close()
                if isinstance(exc, Exception):
                    raise JobError(message) from exc
                raise
            self._records.update_part(job_id, part, session_id=run.session_id)
            started = self._started(job_id, part, earlier_part, run)
            started.mode = next((n for n, i in by_name.items() if i == mode_id), None)
            return started
        finally:
            if not new_job:
                self._reserved.get(job_id, set()).discard(part)
            if slot_held:
                self._starting -= 1
            if not handed_off:
                await run.close()

    async def run_planned(self, row: WorkRow) -> JobId:
        """The due runner restarts an expert call that went back to planned: the same row runs
        again with its task, reopening its saved session when the expert can."""
        job = self._records.get_job(row.parent_id or "")
        if job is None or job.closed_at:
            raise JobError(f"job {row.parent_id} is closed; open a new job instead")
        part = next((p for p in job.parts if p.id == row.id.split(".", 1)[1]), None)
        chosen = next((e for e in self._experts() if part and e.id == part.agent), None)
        if part is None or chosen is None:
            raise JobError("the expert that ran this part is not installed any more")
        return await self._start_part(
            job.id,
            chosen,
            part.task,
            Path(part.folder),
            earlier_part=part,
            new_job=False,
            redo=row,
        )

    def _redo_mode(self, job_id: str, offered) -> str:
        job = self._records.get_job(job_id)
        mode = job.mode if job else ""
        if mode not in offered:
            raise JobError("the expert no longer offers the mode this job ran in")
        return mode

    def _reserve_part(self, job_id: str) -> str:
        """The next part id, promised to this start so a concurrent one cannot take it."""
        taken = self._reserved.setdefault(job_id, set())
        stored = self._records.next_part_id(job_id)
        top = max([int(stored[1:]), *(int(r[1:]) + 1 for r in taken)])
        part = f"p{top}"
        taken.add(part)
        return part

    async def _hand_off_mode(
        self,
        chosen: InstalledExpert,
        task: str,
        path: Path,
        by_name: dict[str, str],
        apps: tuple[str, ...],
    ) -> tuple[str, tuple[str, ...]]:
        """The mode to start in, and the apps kept. The card is the owner's own question; the
        engine is asked only when apps ride along, so the person's pick is logged. Apps on the
        card are the person's to approve, so nothing but the person answers for them."""
        kept = apps

        async def card() -> PersonAnswer:
            nonlocal kept
            shown: dict = {"folder": str(path)}
            if apps:
                shown["apps"] = self._card_apps(apps)
            answer = await self._open_ask(
                text=task, tool="hand_off", input=shown, options=[*by_name, CANCEL]
            )
            if answer.option is None:
                raise NoOneThere
            mode = by_name.get(answer.option)
            if mode is None:
                raise RpcError(ErrorCode.cancelled, "the ask was cancelled")
            # Send is the approval for the apps still on the card; the answer can only narrow.
            if apps and answer.apps is not None:
                kept = tuple(a for a in apps if a in answer.apps)
                facts["apps"] = list(kept)
            return PersonAnswer("allow", option_id=mode)

        facts: dict = {"folder": str(path)}
        if apps:
            facts["apps"] = list(apps)
        if self._engine is None or not apps:
            try:
                return (await card()).option_id, kept
            except NoOneThere as err:
                raise JobError("not started: nobody was there to answer") from err
            except RpcError as err:
                declined = err.code == ErrorCode.cancelled
                why = "the person declined" if declined else "nobody was there to answer"
                raise JobError(f"not started: {why}") from err
        decision = await self._engine.decide(
            AskRequest(
                kind="hand_off_followup",
                source=AGENT,
                tool="hand_off",
                group_key=f"{_prefix(chosen.id)}:{path}",
                summary=summarise(task, "hand_off", facts),
                input=facts,
                tier=Tier.ask,
                how_to_ask=card,
                can_allow_once=False,  # only the person answers for apps
                offer=False,
            )
        )
        if not decision.allowed or decision.option_id is None:
            raise JobError(f"not started: {decision.reason or 'the person declined'}")
        return decision.option_id, kept

    @staticmethod
    def _started(job_id: str, part: str, earlier: JobPart | None, run: ExpertRun) -> JobId:
        if earlier is None:
            return JobId(job_id, part=part)
        parent = earlier.job_id
        if earlier.session_id is None:
            return JobId(job_id, "fresh", "the earlier job saved no session", parent, part)
        if run.resumed:
            return JobId(job_id, "continued", None, parent, part)
        return JobId(job_id, "fresh", run.fresh_reason, parent, part)

    def close(self, job_id: str, outcome: Literal["done", "failed"] = "done") -> None:
        """Scout judges the work finished, as done or as failed. A job with a running part cannot
        be closed."""
        job = self._records.get_job(job_id)
        if job is None:
            raise JobError(f"no job {job_id}")
        if job.closed_at:
            raise JobError(f"job {job_id} is already closed")
        running = [p.id for p in job.parts if p.state == "active"]
        if running:
            raise JobError(
                f"job {job_id} still running: {', '.join(running)}",
                {"running_parts": running},
            )
        work = self._records.work
        timers = [t.id for t in work.children(job_id) if t.kind in ("timer", "watch")]
        try:
            self._records.close_job(job_id, outcome)
        except TransitionRefused as err:
            raise JobError(f"job {job_id} cannot be closed: {err}") from err
        # Closing cancelled the job's check-back timers: drop their held wakes, re-arm the sleeper.
        for timer_id in timers:
            self._drop("timer", f"timer:{timer_id}")
        if timers:
            self._timers_changed()
        self._changed()

    def tell(self, job_id: str, note: str, part: str | None = None) -> None:
        run = self._running(job_id, part, "name one")
        if not run.note(note):
            raise JobError(f"job {job_id} is not running")

    async def stop(self, job_id: str, part: str | None = None) -> None:
        """Stop the named part, or every running part of the job."""
        runs = self._running_parts(job_id, part)
        for stopped_part, run in list(runs.items()):
            if activity := self._activity.get(job_id, {}).get(stopped_part):
                activity.stopping()  # the cancelled ask's rejection must not read as a failure
            await run.stop()

    async def shutdown(self) -> None:
        """Stop every running job before the brain exits; one stuck run must not block the rest."""
        # The exiting brain would drop any turn a report starts, so leave the report for the
        # next start (unreported jobs are re-queued then).
        self._on_finished = lambda job: None
        for job_id, runs in list(self._runs.items()):
            for part, run in list(runs.items()):
                if activity := self._activity.get(job_id, {}).get(part):
                    activity.stopping()
                with suppress(Exception):
                    await run.stop()
        for job_id in list(self._activity_trailing):
            self._stop_activity_notes(job_id)
        if self._hosts is not None:  # warm adapters waiting for a follow-up go too
            await self._hosts.shutdown()

    def with_activity(self) -> set[str]:
        return self._records.work.jobs_with_activity()

    def activity_page(self, job_id: str, after_rev: int) -> dict:
        """A job's steps after the cursor (rows are masked when written); `rev` is the cursor
        to pass next time. `watch` is filled by the watch feature later."""
        job = self._records.get_job(job_id)
        if job is None:
            raise JobError(f"no job {job_id}")
        rows = self._records.work.activity_after(job_id, after_rev, PAGE_LIMIT + 1)
        more = len(rows) > PAGE_LIMIT
        rows = rows[:PAGE_LIMIT]
        return {
            "job": job_id,
            "title": job.title,
            "state": home_state(job.state),
            "started_at": job.started_at,
            "ended_at": job.ended_at,
            "closed_at": job.closed_at,
            "result": job.scout_result,
            "parts": [
                {
                    "id": p.id,
                    "expert": p.agent,
                    "state": home_state(p.state),
                    "reason": p.reason,
                    "folder": p.folder,
                    "started_at": p.started_at,
                    "ended_at": p.ended_at,
                }
                for p in job.parts
            ],
            "rev": rows[-1].rev if more else self._records.work.last_rev(job_id),
            "entries": [asdict(r) for r in rows],
            "more": more,
            "watch": job.watch,
        }

    def part_report(self, job_id: str, part: str) -> str | None:
        """One part's report for the job page's Reports tab (masked when it was saved)."""
        job = self._records.get_job(job_id)
        if job is None:
            raise JobError(f"no job {job_id}")
        for p in job.parts:
            if p.id == part:
                return p.report
        raise JobError(f"no part {part} in job {job_id}")

    def set_watch(self, job_id: str, items: object) -> list[dict]:
        """Replace Scout's watch list for a job. A bad shape is refused with a plain line and the
        old list stays; text is masked before it is saved, like anything model-written."""
        if self._records.get_job(job_id) is None:
            raise JobError(f"no job {job_id}")
        clean = _check_watch(items)
        clean = mask_json(self._guards, "job_watch", clean)
        self._records.set_watch(job_id, clean)
        self._activity_changed(job_id)  # an open job page redraws its header
        return clean

    def set_result(self, job_id: str, text: str) -> None:
        """Store Scout's own result for the job (masked, replaceable, even after close). No
        template or length rule: only the storage cap."""
        if self._records.get_job(job_id) is None:
            raise JobError(f"no job {job_id}")
        self._records.set_result(job_id, mask_json(self._guards, "job_result", text))
        self._activity_changed(job_id)  # an open job page redraws its overview

    def record_step(self, job_id: str, source: str, text: str, status: str) -> None:
        """A step Scout took itself for the job (its own tool or a connected app) joins the
        timeline beside the experts' steps: what was tried and how it went, never the result."""
        if self._records.get_job(job_id) is None:
            return
        steps = self._scout_steps.get(job_id)
        if steps is None:
            steps = self._scout_steps[job_id] = JobActivity(
                job_id,
                self._records.work,
                lambda t: mask_json(self._guards, "job_activity", t),
                self._now,
                on_change=lambda: self._activity_changed(job_id),
                part="scout",
                max_entries=self._steps_max_entries,
                max_bytes=self._steps_max_bytes,
            )
        steps.tool_step(source, text, status)

    def _part_fact(self, job_id: str, part: str) -> dict[str, str]:
        """Names the part in a wake, but only when the job has several and it matters which."""
        parts = self._records.parts_of(job_id)
        found = next((p for p in parts if p.id == part), None)
        return {"part": part, "expert": found.agent} if found and len(parts) > 1 else {}

    async def _quiet(self, job_id: str, facts: QuietFacts, part: str = "p1") -> None:
        """A running job showed nothing new for the threshold: tell Scout the facts. Code never
        stops or nudges it; Scout decides."""
        event_facts: dict[str, str | int] = {
            "job": job_id,
            **self._part_fact(job_id, part),
            "quiet_minutes": int(facts.quiet_s // 60),
            "adapter_alive": "yes" if facts.adapter_alive else "no",
        }
        activity = self._activity.get(job_id, {}).get(part)
        step = activity.running_step() if activity else None
        if step is not None:
            began = datetime.fromisoformat(step.at)
            event_facts["running"] = step.text
            event_facts["running_minutes"] = max(
                0, int((self._now() - began).total_seconds() // 60)
            )
        event_facts.update(self.wake_facts(job_id))
        self._emit(Event("job_quiet", event_facts, key=f"job:{job_id}"))

    def _step_failed(self, job_id: str, entry: ActivityEntry) -> None:
        """A command failed: tell Scout the facts (batched and capped by the scheduler)."""
        facts: dict[str, str | int] = {
            "job": job_id,
            **self._part_fact(job_id, entry.part),
            "step": _clip(entry.text),
            "exit": "" if entry.exit is None else entry.exit,
        }
        facts.update(self.wake_facts(job_id))
        self._emit(Event("job_step_failed", facts, key=f"job:{job_id}"))

    def wake_facts(self, job_id: str) -> dict[str, str]:
        """Facts every job wake carries: a short summary of what the job did, read from its
        stored log (so a job from before a restart has one too) and masked once more."""
        summary = activity_summary(self._records.work, self._records, job_id, self._now())
        facts = {"activity": mask_json(self._guards, "job_summary", summary)}
        job = self._records.get_job(job_id)
        if job is not None and job.watch:  # already masked when saved
            facts["watching"] = render_watch(job.watch)
        return facts

    def note(self, job: Job) -> str:
        """The wake text for a finished job: its row and the summary of its steps."""
        return job_note(job, self.wake_facts(job.id), self._outputs)

    def activity_line(self, job_id: str) -> str:
        """One line about a job's steps for list_jobs; empty when it recorded none."""
        line = activity_line(self._records.work, job_id, self._now())
        return mask_json(self._guards, "job_summary", line) if line else ""

    def running_steps(self) -> list[dict]:
        """The step each running job is on now, for the bubble's one live line."""
        names = {e.id: e.name for e in self._experts()}
        out = []
        for job in self._records.running_jobs():
            for part in job.parts:
                activity = self._activity.get(job.id, {}).get(part.id)
                step = activity.running_step() if activity else None
                if step is not None:
                    out.append(
                        {
                            "job": job.id,
                            "part": part.id,
                            "expert": names.get(part.agent, part.agent),
                            "text": step.text,
                            "kind": step.kind,
                            "title": job.title,
                            "at": step.at,
                        }
                    )
        return out

    def list(self) -> list[Job]:
        return self._records.list_jobs(LIST_LIMIT)

    def _running_parts(self, job_id: str, part: str | None = None) -> dict[str, ExpertRun]:
        """The job's running parts, or just the named one; a plain refusal when none."""
        runs = self._runs.get(job_id, {})
        if part is not None:
            runs = {part: runs[part]} if part in runs else {}
        if runs:
            return runs
        if self._records.get_job(job_id) is None:
            raise JobError(f"no job {job_id}")
        raise JobError(f"job {job_id} is not running")

    def _running(self, job_id: str, part: str | None, what: str) -> ExpertRun:
        """One running part: the named one, or the only one the job has."""
        runs = self._running_parts(job_id, part)
        if len(runs) > 1:
            names = ", ".join(sorted(runs))
            raise JobError(f"job {job_id} has several running parts: {names}; {what}")
        return next(iter(runs.values()))

    def _changed(self) -> None:
        self._notify("changed", {"what": "jobs"})

    async def _open_ask(self, *, job_id: str | None = None, part: str = "p1", **kw) -> Answer:
        """Open an ask and raise its RpcError, so callers can tell a timeout from a cancel."""
        ask_id = kw.pop("ask_id", None) or uuid.uuid4().hex
        key = (job_id, part)
        if job_id is not None:
            self._ask_ids.setdefault(key, set()).add(ask_id)
        try:
            return await self._asks.open(ask_id=ask_id, parent_id=job_id, **kw)
        finally:
            if job_id is not None:
                self._ask_ids.get(key, set()).discard(ask_id)

    async def _ask_or_none(self, **kw) -> Answer | None:
        """Open an ask; None when nobody can answer (offline, timed out, cancelled)."""
        try:
            answer = await self._open_ask(**kw)
        except RpcError:
            return None
        return answer if answer.option is not None else None

    def _agent_of(self, job: Job | None, part: str) -> str:
        """The expert that runs this part (a job's parts may use different experts)."""
        found = next((p for p in job.parts if p.id == part), None) if job else None
        return found.agent if found else AGENT

    async def _permission(
        self, job_id: str, request: PermissionRequest, part: str = "p1"
    ) -> str | None:
        if self._engine is None:
            return None
        once = next((o for o in request.options if o.kind == "allow_once"), None)
        job = self._records.get_job(job_id)
        folder = job.folder if job is not None else ""
        agent = _prefix(self._agent_of(job, part))
        tool = f"{agent}:{request.title}"
        ask_id = uuid.uuid4().hex  # the ask's work row is also its log entry
        person = expert_asker(
            partial(self._open_ask, job_id=job_id, part=part, stay_open=True),
            tool,
            request.input,
            request.options,
            ask_id,
        )

        async def ask_person():
            # Only what waits on the person is an item, so a rule's or Scout's grant leaves none.
            if self._items is None:
                return await person()
            self._items.open("expert_ask", "brain", live_only=True, job_id=job_id, id=ask_id)
            try:
                answer = await person()
            except BaseException:  # the part stopped or the ask failed: nobody can answer now
                with suppress(OpenItemRefused):
                    self._items.expire(ask_id, "process_ended")
                raise
            self._items.finish(ask_id, "answered")
            return answer

        decision = await self._engine.decide(
            AskRequest(
                kind="expert_request",
                source=AGENT,
                tool=tool,
                group_key=f"{agent}:{folder}",
                summary=summarise(request.title, tool, request.input),
                input=request.input,
                tier=Tier.ask,
                how_to_ask=ask_person,
                job_id=job_id,
                ask_id=ask_id,
                can_allow_once=once is not None and job is not None,  # never allow_always
            )
        )
        self._changed()
        if decision.allowed:
            # The person's own pick, else the expert's allow-once for a rule or Scout grant.
            return decision.option_id or (once.id if once is not None else None)
        return decision.option_id  # the person's reject; None when nobody picked

    async def _question(self, job_id: str, question: Question, part: str = "p1") -> dict | None:
        if self._scout is not None and self._asks.anyone_online():
            # Scout answers when he can; None (passed, dropped, wake over) means ask the user.
            scout_content = await self._scout.ask(job_id, question)
            if part not in self._runs.get(job_id, {}):  # the part ended while Scout thought
                return None
            if scout_content is not None:
                self._changed()
                return scout_content
        content: dict = {}
        for field in question.fields:
            # A lone question's text is the message; several carry theirs in the description.
            text = field.description or (
                question.message if len(question.fields) == 1 else field.title
            )
            answer = await self._ask_or_none(
                job_id=job_id, part=part, text=text, options=field.options, free_text=True
            )
            if answer is None:
                if not self._asks.anyone_online():
                    self._on_away(job_id, question.message)
                self._changed()
                return None
            if answer.text:
                content[f"{field.key}_custom"] = answer.text
            else:
                content[field.key] = [answer.option] if field.multi else answer.option
        self._changed()
        return content

    async def _progress(self, job_id: str, text: str, part: str = "p1") -> None:
        masked = mask_json(self._guards, "job_progress", text)
        self._records.update_part(job_id, part, progress=masked)
        now = self._clock()
        if now - self._progress_sent.get(job_id, -PROGRESS_NOTIFY_S) >= PROGRESS_NOTIFY_S:
            self._progress_sent[job_id] = now
            self._changed()

    def _activity_changed(self, job_id: str) -> None:
        """Tell bodies a job's log moved, at most once per ACTIVITY_NOTIFY_S: the first change
        at once, a burst as one trailing flush so the last write is never left unannounced."""
        now = self._clock()
        last = self._activity_sent.get(job_id)
        if last is None or now - last >= ACTIVITY_NOTIFY_S:
            self._send_activity(job_id)
        elif job_id not in self._activity_trailing:
            wait = ACTIVITY_NOTIFY_S - (now - last)
            self._activity_trailing[job_id] = asyncio.create_task(
                self._flush_activity(job_id, wait)
            )

    async def _flush_activity(self, job_id: str, wait: float) -> None:
        await asyncio.sleep(wait)
        self._activity_trailing.pop(job_id, None)
        self._send_activity(job_id)

    def _send_activity(self, job_id: str) -> None:
        self._activity_sent[job_id] = self._clock()
        self._notify("changed", {"what": "job_activity"})

    def _stop_activity_notes(self, job_id: str) -> None:
        task = self._activity_trailing.pop(job_id, None)
        if task:
            task.cancel()
        self._activity_sent.pop(job_id, None)

    async def _activity_update(self, job_id: str, update: object, part: str = "p1") -> None:
        if activity := self._activity.get(job_id, {}).get(part):
            activity.on_update(update)

    def _settle(
        self, job_id: str, part: str, state: str, reason: str, report: str | None
    ) -> Job | None:
        """Record how a part ended. The job takes that outcome once no part is still running."""
        try:
            self._records.update_part(
                job_id, part, state=_WORK_STATE[state], reason=reason or state, report=report
            )
        except TransitionRefused:
            pass  # the part had already ended: another writer got there first
        return self._records.get_job(job_id)

    def _forget(self, job_id: str, part: str) -> bool:
        """Drop a finished part's run, activity and asks. True when the job has none left running:
        then its notes, timers and Scout questions go too."""
        self._asks.cancel_all(self._ask_ids.pop((job_id, part), set()))
        for books in (self._runs, self._activity):
            books.get(job_id, {}).pop(part, None)
            if not books.get(job_id, True):
                del books[job_id]
        if job_id in self._runs:
            return False
        if self._items is not None:  # no process of this job is left to answer its asks
            self._items.expire_live_only(job_id=job_id)
        self._stop_activity_notes(job_id)
        self._progress_sent.pop(job_id, None)
        return True

    async def _end(
        self, job_id: str, state: str, reason: str, result: str | None, part: str = "p1"
    ) -> None:
        result = mask_json(self._guards, "job_result", result)
        job = self._settle(job_id, part, state, reason, result)
        activity = self._activity.get(job_id, {}).get(part)
        done = self._forget(job_id, part)
        if done:
            # job_ended carries the same facts, so held failure and quiet news is stale now
            self._drop("job_step_failed", f"job:{job_id}")
            self._drop("job_quiet", f"job:{job_id}")
            if self._scout is not None:
                self._scout.cancel_job(job_id)
        if activity:
            activity.end(state, reason)  # its change notice is the one, sent after the end row
            if done:
                self._activity_sent.pop(job_id, None)
        self._changed()
        if done:  # a job with a part still running is not finished
            outcome = self._on_finished(job)
            if inspect.isawaitable(outcome):
                await outcome


def _check_watch(items: object) -> list[dict]:
    if not isinstance(items, list):
        raise JobError("watch_job needs items as a list of {text, done}.")
    if len(items) > WATCH_MAX_ITEMS:
        raise JobError(
            f"watch_job takes at most {WATCH_MAX_ITEMS} items; keep the few that matter."
        )
    clean = []
    for item in items:
        text = item.get("text") if isinstance(item, dict) else None
        done = item.get("done") if isinstance(item, dict) else None
        text = text.strip() if isinstance(text, str) else None
        if not text or len(text) > WATCH_TEXT_MAX:
            raise JobError(f"Each watch item needs text of 1 to {WATCH_TEXT_MAX} characters.")
        if not isinstance(done, bool):
            raise JobError("Each watch item needs done as true or false.")
        clean.append({"text": text, "done": done})
    return clean


def render_watch(items: list[dict] | None) -> str:
    """The watch list as plain lines, ticked or not, for Scout's wakes."""
    return "\n".join(f"[{'x' if i['done'] else ' '}] {i['text']}" for i in items or [])


def job_title(job: Job) -> str:
    """Scout's title whole, or for a job without one the brief's first line (clipped: a brief can
    be long)."""
    if job.title and job.title.strip():
        return job.title
    for line in job.task.splitlines():
        if line.strip():
            return line.strip()[:TITLE_FALLBACK_CHARS]
    return job.task.strip()[:TITLE_FALLBACK_CHARS]


def job_note(
    job: Job, facts: dict[str, str] | None = None, outputs: OutputStore | None = None
) -> str:
    """Facts about a finished job for Scout's wake turn. No wording for the user: Scout decides.
    Each extra fact (the activity summary) follows as its own block. A report over the preview
    cap arrives as a preview with an output id, like any long tool result. Only the part that just
    ended brings its report: a repeat of earlier reports would grow every wake and store copies."""
    lines = [
        f"Job {job.id} ended.",
        f"Title: {job_title(job)}",
        f"Task: {job.task}",
        f"Folder: {job.folder}",
        f"State: {home_state(job.state)}",
    ]
    if job.state == "cancelled":  # a stop by the person, Scout or a clean shutdown; not a crash
        lines.append(
            "This job was stopped. Do not start it again or start a replacement "
            "unless the person asks."
        )
    many = len(job.parts) > 1
    ended = [p for p in job.parts if p.ended_at]
    last = max(reversed(ended), key=lambda p: p.ended_at) if ended else None  # ties: later part
    if many:  # facts only: which part ended last, and where each stands
        if last:
            lines.append(f"Part: {last.id}")
        lines.append(
            "Parts: "
            + "; ".join(f"{p.id} {p.agent} {p.folder} {home_state(p.state)}" for p in job.parts)
        )
    for part in job.parts:
        tag = f" ({part.id}, {part.agent}, {part.folder})" if many else ""
        if part.reason:
            lines.append(f"Reason{tag}: {part.reason}")
        if part.report and (not many or part is last):  # the stored row keeps it whole
            report = preview(outputs, "job_report", part.report) if outputs else part.report
            lines.append(f"Result{tag}:\n{report}")
    for key, value in (facts or {}).items():
        lines.append(f"{key.capitalize()}:\n{value}")
    return "\n".join(lines)
