"""Jobs as the rest of the brain reads them, kept in `work` rows (a goal and its expert calls).

`JobRecords` has no SQL of its own: it turns `Job` and `JobPart` calls into `WorkStore` moves and
back. A job is a goal row; each part is an expert_call row named `<job>.<part>`. A report or
result over 2,000 characters keeps its start in the row and the whole text in `tool_outputs`.
"""

import sqlite3
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Literal

from brain.store import outputs
from brain.store.db import utc_text
from brain.store.work import TERMINAL, WorkRow, WorkStore

SUMMARY_CAP = 2_000  # characters a row keeps itself; the rest goes to tool_outputs
JOB_RESULT_CAP = 1_000_000  # characters kept of a report or Scout result; a storage safety only
JOB_PROGRESS_CAP = 2_000
JOB_TITLE_CAP = 200

_HOME = {"active": "running", "done": "done", "failed": "error"}
_PART_FIELDS = {"state", "reason", "progress", "session_id", "report", "reported"}


def home_state(state: str) -> str:
    """The word Home and Scout's tools have always used for a job or part state."""
    return _HOME.get(state, "stopped")


@dataclass(frozen=True)
class JobPart:
    """One expert hand-off inside a job (not `Part`: protocol.py exports that for say parts)."""

    job_id: str
    id: str
    agent: str
    task: str
    state: str
    reason: str | None
    progress: str | None
    session_id: str | None
    report: str | None
    reported: bool
    started_at: str
    ended_at: str | None
    folder: str  # parts of one job may work in different folders


@dataclass(frozen=True)
class Job:
    id: str
    task: str  # the first brief; the title's fallback
    folder: str
    mode: str
    state: str
    started_at: str
    ended_at: str | None
    parent_job: str | None = None
    watch: list[dict] | None = None
    title: str | None = None
    scout_result: str | None = None
    closed_at: str | None = None
    parts: list[JobPart] = field(default_factory=list)


class JobRecords:
    def __init__(self, work: WorkStore, db: sqlite3.Connection, now: Callable[[], datetime]):
        self.work = work
        self._db = db
        self._now = now

    # ---- reading ----

    def _text(self, row: WorkRow) -> str | None:
        if row.detail_id is not None:
            whole = outputs.get_output(self._db, row.detail_id)
            if whole is not None:
                return whole
        return row.summary

    def _reason(self, call: WorkRow) -> str | None:
        """Why a part ended; a blocked part has not ended, so its reason is its last move's."""
        if call.state == "blocked":
            moves = [e for e in self.work.events(call.id) if e.kind == "state"]
            held = [e for e in moves if (e.data or {}).get("to") == "blocked"]
            return (held[-1].data or {}).get("reason") if held else None
        return None if call.end_reason == home_state(call.state) else call.end_reason

    def _part(self, call: WorkRow, detail: dict) -> JobPart:
        return JobPart(
            job_id=call.parent_id or "",
            id=call.id.split(".", 1)[1],
            agent=detail.get("agent") or "",
            task=(call.input or {}).get("task", call.title),
            state=call.state,
            reason=self._reason(call),
            progress=call.progress,
            session_id=(call.checkpoint or {}).get("session_id"),
            report=None,  # filled by the caller: it may need the output store
            reported=bool(call.reported_at),
            started_at=call.created_at,
            ended_at=call.ended_at,
            folder=detail.get("folder") or "",
        )

    def _job(self, goal: WorkRow) -> Job:
        calls = [c for c in self.work.children(goal.id) if c.kind == "expert_call"]
        details = self.work.job_details([goal.id, *(c.id for c in calls)])
        parts = []
        for call in calls:
            part = self._part(call, details.get(call.id, {}))
            parts.append(JobPart(**{**part.__dict__, "report": self._text(call)}))
        mine = details.get(goal.id, {})
        parent = self.work.event_of(goal.id, "continued")
        ended = [c for c in calls if c.ended_at]
        running = any(c.state == "active" for c in calls)
        last = max(ended, key=lambda c: (c.ended_at, c.seq)) if ended else None
        if running:
            state = "active"
        elif goal.state == "failed":
            state = "failed"
        else:
            state = last.state if last else goal.state
        return Job(
            id=goal.id,
            task=mine.get("task") or "",
            folder=mine.get("folder") or "",
            mode=mine.get("mode") or "",
            state=state,
            started_at=goal.created_at,
            ended_at=None if running else (last.ended_at if last else goal.ended_at),
            parent_job=(parent.data or {}).get("from") if parent else None,
            watch=(goal.input or {}).get("watch") or None,
            title=goal.title or None,
            scout_result=self._text(goal) or None,
            closed_at=goal.ended_at if goal.state in TERMINAL else None,
            parts=parts,
        )

    def get_job(self, id: str) -> Job | None:
        goal = self.work.get(id)
        return self._job(goal) if goal is not None and goal.kind == "goal" else None

    def parts_of(self, job_id: str) -> list[JobPart]:
        job = self.get_job(job_id)
        return job.parts if job else []

    def list_jobs(self, limit: int = 20) -> list[Job]:
        """Newest first."""
        return [self._job(g) for g in self.work.newest("goal", limit)]

    def _parents_of(self, calls: list[WorkRow]) -> list[str]:
        """The goals of these calls, newest call's goal first, each once."""
        return list(dict.fromkeys(c.parent_id for c in reversed(calls) if c.parent_id))

    def running_jobs(self) -> list[Job]:
        """Jobs with a part running; a goal Scout has not closed yet is not running by itself."""
        active = self.work.of_kind("expert_call", ["active"])
        return [j for i in self._parents_of(active) if (j := self.get_job(i)) is not None]

    def next_part_id(self, job_id: str) -> str:
        """The id the job's next part will get (p1, p2, ...), known before the part exists."""
        taken = [
            int(c.id.rsplit(".p", 1)[1])
            for c in self.work.children(job_id)
            if c.kind == "expert_call"
        ]
        return f"p{max(taken, default=0) + 1}"

    def last_part_for(self, agent: str, folder: str) -> tuple[Job, JobPart] | None:
        """The expert's newest finished part in this folder that saved a session. Folders compare
        as paths (Windows ignores case, a trailing slash is nothing), not as strings."""
        for call in self.work.expert_calls_with_session(agent):
            job = self.get_job(call.parent_id or "")
            part = (
                next((p for p in job.parts if p.id == call.id.split(".", 1)[1]), None)
                if job
                else None
            )
            if (
                job is not None
                and part is not None
                and Path(part.folder or job.folder) == Path(folder)
            ):
                return job, part
        return None

    def unreported_jobs(self) -> list[Job]:
        """Jobs with no part running whose ended or held-up parts Scout has not heard about."""
        news = self.work.unreported(["expert_call"])
        found = (self.get_job(i) for i in dict.fromkeys(c.parent_id for c in news if c.parent_id))
        return [j for j in found if j is not None and j.state != "active"]

    # ---- writing ----

    def add_job(
        self, id: str, agent: str, task: str, folder: str, mode: str, parent_job: str | None = None
    ) -> Job:
        """A new running job with its first part, p1."""
        self.work.create("goal", "", id=id, state="active")
        self.work.set_job_detail(id, folder=folder, mode=mode, task=task)
        if parent_job:
            self.work.add_event(id, "continued", {"from": parent_job})
        self.add_part(id, agent, task, folder)
        job = self.get_job(id)
        assert job is not None
        return job

    def add_part(
        self, job_id: str, agent: str, task: str, folder: str, part_id: str | None = None
    ) -> str:
        """Add a running part to a job; returns its id (p1, p2, ...). part_id is one the caller
        reserved earlier. A job held up by a failed part runs again."""
        part_id = part_id or self.next_part_id(job_id)
        goal = self.work.get(job_id)
        if goal is not None and goal.state == "blocked":
            self.work.transition(job_id, "active")
        work_id = f"{job_id}.{part_id}"
        self.work.create(
            "expert_call", task, parent_id=job_id, id=work_id, state="active", input={"task": task}
        )
        self.work.set_job_detail(work_id, agent=agent, folder=folder)
        return part_id

    def _store_text(self, work_id: str, text: str) -> None:
        text = text[:JOB_RESULT_CAP]
        if len(text) <= SUMMARY_CAP:
            self.work.set_text(work_id, text, None)
            return
        output_id = uuid.uuid4().hex[:12]
        outputs.put_output(self._db, output_id, "job_report", text, utc_text(self._now()))
        self.work.set_text(work_id, text[:SUMMARY_CAP], output_id)

    def update_part(self, job_id: str, part_id: str, **fields) -> None:
        """Change a part. A `state` is a checked move (it needs a `reason` when it ends the part);
        `session_id` is the checkpoint; `reported=True` tells Scout it has been heard."""
        unknown = set(fields) - _PART_FIELDS
        if unknown:
            raise ValueError(f"Unknown part fields: {', '.join(sorted(unknown))}")
        work_id = f"{job_id}.{part_id}"
        moving = fields.get("state") is not None
        if moving:  # first: a refused late writer must not overwrite what the part already says
            self.work.transition(work_id, fields["state"], reason=fields.get("reason"))
        if isinstance(fields.get("progress"), str) and not moving:  # a move may end the row
            self.work.update(work_id, progress=fields["progress"][-JOB_PROGRESS_CAP:])
        if "session_id" in fields:  # None forgets the session
            session = fields["session_id"]
            self.work.update(work_id, checkpoint={"session_id": session} if session else {})
        if isinstance(fields.get("report"), str):
            self._store_text(work_id, fields["report"])
        if fields.get("reported"):
            self.work.mark_reported(work_id)

    def set_title(self, job_id: str, title: str) -> None:
        """Scout's own title for a job; only a safety cap on storage, never a rewrite."""
        self.work.update(job_id, title=title[:JOB_TITLE_CAP])

    def set_result(self, job_id: str, text: str) -> None:
        """Scout's own words for the whole job; replaces the earlier one."""
        self._store_text(job_id, text)

    def set_watch(self, job_id: str, items: list[dict] | None) -> None:
        """Replace Scout's watch list for a job; none or empty clears it."""
        self.work.update(job_id, input={"watch": items} if items else {})

    def close_job(self, job_id: str, outcome: Literal["done", "failed"] = "done") -> None:
        """Scout judged the work finished. Its result stays as it was; ending the goal also
        ends anything still open under it."""
        goal = self.work.get(job_id)
        assert goal is not None
        self.work.close_goal(job_id, outcome, goal.summary or "")

    def mark_reported(self, job_id: str) -> None:
        """Scout has heard about this job: every part, and the job itself."""
        for call in self.work.children(job_id):
            if call.kind == "expert_call":
                self.work.mark_reported(call.id)
        self.work.mark_reported(job_id)
