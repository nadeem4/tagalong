"""Test helpers for jobs kept as work rows: build a JobRecords on a Memory, end a job by hand."""

from datetime import UTC, datetime

from brain.job_records import JobRecords
from brain.memory import Memory
from brain.store import events as event_rows
from brain.store.work import WorkStore
from brain.tasks import TaskStopHooks

_WORK = {"done": "done", "error": "failed", "stopped": "cancelled"}


def fresh_work(now=lambda: datetime.now(UTC)) -> WorkStore:
    """A WorkStore on its own in-memory database."""
    return WorkStore(Memory(":memory:").db, now)


def records_for(memory: Memory, now=lambda: datetime.now(UTC)) -> JobRecords:
    return JobRecords(WorkStore(memory.db, now), memory.db, now)


def job_told(memory: Memory, job_id: str) -> bool:
    """Whether Scout was told the job ended: its `job_ended` event was handled."""
    return any(
        r.kind == "job_ended" and r.source == f"job:{job_id}"
        for r in event_rows.list_state(memory.db, "handled")
    )


def tasks_for(memory: Memory):
    """A Tasks over the memory's database."""
    from brain.tasks import Tasks

    return Tasks(memory.db, lambda text: text, lambda: datetime.now(UTC))


def no_hooks(**over) -> TaskStopHooks:
    """Stop hooks that do nothing, but for the ones a test names."""

    async def no_jobs(task_id: str) -> None:
        return None

    base = dict(
        stop_jobs=no_jobs,
        cancel_rows=lambda t: None,
        close_cards=lambda ids: None,
        finish_events=lambda t: None,
        cancel_turn_if_only=lambda ids: None,
        stop_watch=lambda t: None,
    )
    return TaskStopHooks(**{**base, **over})


def end_job(records: JobRecords, job_id: str, state: str = "done") -> None:
    """End every running part of a job the way a finished run would (done, error or stopped)."""
    for part in records.parts_of(job_id):
        if part.state == "active":
            records.update_part(job_id, part.id, state=_WORK[state], reason=state)


def add_timer(
    work: WorkStore,
    note: str,
    at: datetime,
    repeat_s: int | None = None,
    parent_id: str | None = None,
    kind: str = "timer",
    state: str = "planned",
):
    """A timer (or watch) row due at `at`, repeating every `repeat_s` seconds when given."""
    row = work.create(kind, note, parent_id=parent_id, state=state, due_at=at)
    work.set_repeat(row.id, repeat_s)
    return row
