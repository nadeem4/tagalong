"""Test helpers for jobs kept as work rows: build a JobRecords on a Memory, end a job by hand."""

from datetime import UTC, datetime

from brain.job_records import JobRecords
from brain.memory import Memory
from brain.store.work import WorkStore

_WORK = {"done": "done", "error": "failed", "stopped": "cancelled"}


def fresh_work(now=lambda: datetime.now(UTC)) -> WorkStore:
    """A WorkStore on its own in-memory database."""
    return WorkStore(Memory(":memory:").db, now)


def records_for(memory: Memory, now=lambda: datetime.now(UTC)) -> JobRecords:
    return JobRecords(WorkStore(memory.db, now), memory.db, now)


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
