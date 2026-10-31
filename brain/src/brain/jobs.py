"""Jobs: Scout's hand-offs to Claude Code, from the folder check to the finished row.
Owns the running ExpertRuns, asks the user to pick a mode (the hand-off ask), relays Claude
Code's own permission and question prompts as turn-less asks, and keeps the jobs table current.
It tells bodies through the injected notify (`changed: jobs`); the tools that call it come later.
"""

import inspect
import logging
import time
import uuid
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path

from brain.approvals import Approvals
from brain.asks import Answer, Asks
from brain.builtin_guards import anyone_online, person_ask, side_check_guard
from brain.experts import ExpertRun, PermissionRequest, Question
from brain.guards import AskCtx, Guards, Hook
from brain.masking import mask_json
from brain.memory import Job, Memory
from brain.offers import Offers
from brain.protocol import ErrorCode, RpcError
from brain.questions import ScoutQuestions
from brain.side_check import SideCheck

log = logging.getLogger("brain")

AGENT = "claude_code"
CANCEL = "cancel"
HANDOFF_TIMEOUT_S = 300.0  # the hand-off ask has no job yet to bound it
PROGRESS_NOTIFY_S = 2.0  # progress chunks are cheap; bodies refetch at most this often
LIST_LIMIT = 20
RESULT_NOTE_CHARS = 4000  # what one report carries; the full result stays in the row


class JobError(Exception):
    """A plain message for the model or the user; never a crash."""


class Jobs:
    def __init__(
        self,
        memory: Memory,
        asks: Asks,
        notify: Callable[[str, dict], None],
        make_run: Callable[..., ExpertRun],
        max_running: int = 2,
        on_finished: Callable[[Job], object] = lambda job: None,
        clock: Callable[[], float] = time.monotonic,
        scout_questions: ScoutQuestions | None = None,
        approvals: Approvals | None = None,
        side_check: SideCheck | None = None,
        offers: Offers | None = None,
        guards: Guards | None = None,
        on_away: Callable[[str, str], None] = lambda job_id, what: None,
    ) -> None:
        self._memory = memory
        self._asks = asks
        self._notify = notify
        self._make_run = make_run  # called with the four callbacks as keywords
        self._max_running = max_running
        self._on_finished = on_finished
        self._on_away = on_away  # an ask found nobody online: (job id, what it asked)
        self._clock = clock
        self._scout = scout_questions
        self._approvals = approvals  # None records nothing
        self._offers = offers  # None: no offers to auto-approve
        if guards is None:
            # Standalone jobs: build the same ask chain the Session registers.
            guards = Guards()
            guards.add(anyone_online(asks))
            if side_check is not None and approvals is not None:
                guards.add(side_check_guard(side_check, approvals))
            guards.add(person_ask())
        self._guards = guards
        self._runs: dict[str, ExpertRun] = {}
        self._starting = 0  # hand-offs waiting on their ask also hold a slot
        self._ask_ids: dict[str, set[str]] = {}
        self._progress_sent: dict[str, float] = {}

    def startup(self) -> None:
        self._memory.stop_running_on_start()

    async def start(self, task: str, folder: str) -> str:
        """Hand the task to Claude Code once the user picks a mode. Returns the job id."""
        path = Path(folder)
        if not (path.is_absolute() and path.is_dir()):
            raise JobError(f"no folder at {folder}")
        running = self._memory.running_jobs()
        if len(running) + self._starting >= self._max_running:
            names = ", ".join(f"{j.id} ({j.task[:40]})" for j in running)
            raise JobError(f"{self._max_running} jobs are already running: {names}")
        job_id = uuid.uuid4().hex[:8]
        run = self._make_run(
            on_permission=lambda request: self._permission(job_id, request),
            on_question=lambda question: self._question(job_id, question),
            on_progress=lambda text: self._progress(job_id, text),
            on_end=lambda state, reason, result: self._end(job_id, state, reason, result),
        )
        self._starting += 1
        slot_held = True  # released once the row exists, so a job never counts twice
        handed_off = False
        try:
            try:
                modes = await run.start(path)
            except Exception as exc:  # ExpertError, or the adapter refusing (e.g. auth required)
                raise JobError(str(exc) or type(exc).__name__) from exc
            by_name = {m.name: m.id for m in modes}
            answer = await self._ask_or_none(
                text=task,
                tool="hand_off",
                input={"folder": str(path)},
                options=[*by_name, CANCEL],
                timeout=HANDOFF_TIMEOUT_S,
            )
            mode_id = by_name.get(answer.option) if answer else None
            if mode_id is None:  # cancel, a timeout, or nobody online
                raise JobError("not started")
            self._memory.add_job(job_id, AGENT, task, str(path), mode_id)
            self._runs[job_id] = run
            handed_off = True
            self._starting -= 1
            slot_held = False
            self._changed()
            try:
                await run.begin(mode_id, task)
            except BaseException as exc:
                # The row exists but nothing runs: end it, free the slot, kill the adapter.
                message = str(exc) or type(exc).__name__
                self._memory.update_job(job_id, state="error", reason=message, ended_at=_now())
                self._runs.pop(job_id, None)
                self._changed()
                await run.close()
                if isinstance(exc, Exception):
                    raise JobError(message) from exc
                raise
            self._memory.update_job(job_id, session_id=run.session_id)
            return job_id
        finally:
            if slot_held:
                self._starting -= 1
            if not handed_off:
                await run.close()

    def tell(self, job_id: str, note: str) -> None:
        run = self._running(job_id)
        if not run.note(note):
            raise JobError(f"job {job_id} is not running")

    async def stop(self, job_id: str) -> None:
        await self._running(job_id).stop()

    async def shutdown(self) -> None:
        """Stop every running job before the brain exits; one stuck run must not block the rest."""
        # The exiting brain would drop any turn a report starts, so leave the report for the
        # next start (unreported jobs are re-queued then).
        self._on_finished = lambda job: None
        for run in list(self._runs.values()):
            with suppress(Exception):
                await run.stop()

    def list(self) -> list[Job]:
        return self._memory.list_jobs(LIST_LIMIT)

    def _running(self, job_id: str) -> ExpertRun:
        run = self._runs.get(job_id)
        if run is not None:
            return run
        if self._memory.get_job(job_id) is None:
            raise JobError(f"no job {job_id}")
        raise JobError(f"job {job_id} is not running")

    def _changed(self) -> None:
        self._notify("changed", {"what": "jobs"})

    async def _open_ask(self, *, job_id: str | None = None, **kw) -> Answer:
        """Open an ask and raise its RpcError, so callers can tell a timeout from a cancel."""
        ask_id = uuid.uuid4().hex
        if job_id is not None:
            self._ask_ids.setdefault(job_id, set()).add(ask_id)
        try:
            return await self._asks.open(ask_id=ask_id, **kw)
        finally:
            if job_id is not None:
                self._ask_ids.get(job_id, set()).discard(ask_id)

    async def _ask_or_none(self, **kw) -> Answer | None:
        """Open an ask; None when nobody can answer (offline, timed out, cancelled)."""
        try:
            answer = await self._open_ask(**kw)
        except RpcError:
            return None
        return answer if answer.option is not None else None

    async def _permission(self, job_id: str, request: PermissionRequest) -> str | None:
        by_name = {o.name: o for o in request.options}
        once = next((o for o in request.options if o.kind == "allow_once"), None)
        job = self._memory.get_job(job_id)
        folder = job.folder if job is not None else ""
        tool = f"{AGENT}:{request.title}"
        approvals = self._approvals
        picked = None  # the option the person chose, kept for the return value

        async def ask_person() -> str:
            nonlocal picked
            # No `confirm`: that flag only allows the fixed allow/deny sets.
            answer = await self._open_ask(
                job_id=job_id, text="", tool=tool, input=request.input, options=list(by_name)
            )
            picked = by_name.get(answer.option)
            if picked is None:  # no usable pick: not a decision, so no row
                raise RpcError(ErrorCode.cancelled, "the ask was cancelled")
            return "allow" if picked.kind.startswith("allow") else "deny"

        ctx = AskCtx(
            AGENT,
            tool,
            approvals.summarise(request.title, tool, request.input) if approvals else "",
            request.input,
            f"{AGENT}:{folder}",
            False,
            None,
            ask_person,
            job_id=job_id,
            can_approve=once is not None and job is not None,  # never allow_always
        )
        verdict = await self._guards.run(Hook.ask, ctx)
        outcome = None  # stays None when cancelled or failed: not a final outcome, so no row
        result: str | None = None
        if verdict.kind == "allow" and verdict.guard == "side_check" and once is not None:
            result = once.id  # the guard already logged Scout's row
        elif verdict.kind == "allow" and verdict.guard == "person_ask" and picked is not None:
            outcome, result = "approved", picked.id
        elif verdict.kind in ("block", "stop"):
            # Matches person_ask/denied by guard and code, as Toolbox._ask does.
            if verdict.guard == "anyone_online":
                outcome = "no_one"
                self._on_away(job_id, f"asked permission: {request.title}")
            elif verdict.guard == "person_ask" and verdict.code == "timeout":
                outcome = "timed_out"
            elif verdict.guard == "person_ask" and verdict.code == "denied" and picked is not None:
                outcome, result = "refused", picked.id
        # Anything else (a failed guard, an allow nobody vouched for) refuses: no option picked.
        if outcome is not None:
            self._record(job_id, request, outcome)
        if outcome == "approved":
            self._offer(job_id, request)
        self._changed()
        return result

    def _offer(self, job_id: str, request: PermissionRequest) -> None:
        """A person allowed this: Scout may offer to approve the whole folder's kind of ask."""
        job = self._memory.get_job(job_id)
        if self._offers is not None and job is not None:
            self._offers.consider(f"{AGENT}:{job.folder}", AGENT, f"{AGENT}:{request.title}")

    def _record(self, job_id: str, request: PermissionRequest, outcome: str) -> None:
        job = self._memory.get_job(job_id)
        if self._approvals is None or job is None:
            return
        tool = f"claude_code:{request.title}"
        answered = outcome in ("approved", "refused")
        self._approvals.record(
            source=AGENT,
            tool=tool,
            summary=self._approvals.summarise(request.title, tool, request.input),
            input=request.input,
            group_key=f"{AGENT}:{job.folder}",
            outcome=outcome,
            job_id=job_id,
            decided_by="person" if answered else "none",
        )

    async def _question(self, job_id: str, question: Question) -> dict | None:
        if self._scout is not None and self._asks.anyone_online():
            # Scout answers when he can; None (passed, dropped, wake over) means ask the user.
            scout_content = await self._scout.ask(job_id, question)
            if job_id not in self._runs:  # the job ended while Scout thought: nobody to answer
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
                job_id=job_id, text=text, options=field.options, free_text=True
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

    async def _progress(self, job_id: str, text: str) -> None:
        self._memory.update_job(job_id, progress=mask_json(self._guards, "job_progress", text))
        now = self._clock()
        if now - self._progress_sent.get(job_id, -PROGRESS_NOTIFY_S) >= PROGRESS_NOTIFY_S:
            self._progress_sent[job_id] = now
            self._changed()

    async def _end(self, job_id: str, state: str, reason: str, result: str | None) -> None:
        result = mask_json(self._guards, "job_result", result)
        self._memory.update_job(job_id, state=state, reason=reason, result=result, ended_at=_now())
        self._runs.pop(job_id, None)
        self._progress_sent.pop(job_id, None)
        self._asks.cancel_all(self._ask_ids.pop(job_id, set()))
        if self._scout is not None:
            self._scout.cancel_job(job_id)
        self._changed()
        outcome = self._on_finished(self._memory.get_job(job_id))
        if inspect.isawaitable(outcome):
            await outcome


def _now() -> str:
    return datetime.now(UTC).isoformat()


def job_note(job: Job) -> str:
    """Facts about a finished job for Scout's wake turn. No wording for the user: Scout decides."""
    lines = [
        f"Job {job.id} ended.",
        f"Task: {job.task}",
        f"Folder: {job.folder}",
        f"State: {job.state}",
    ]
    if job.reason:
        lines.append(f"Reason: {job.reason}")
    if job.result:
        result = job.result[:RESULT_NOTE_CHARS]
        if len(job.result) > RESULT_NOTE_CHARS:
            result += "\n[trimmed]"
        lines.append(f"Result:\n{result}")
    return "\n".join(lines)
