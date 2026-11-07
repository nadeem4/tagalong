"""Test helpers for jobs kept as work rows: build a JobRecords on a Memory, end a job by hand."""

from datetime import UTC, datetime

from brain.job_records import JobRecords
from brain.memory import Memory
from brain.store.work import WorkStore

_WORK = {"done": "done", "error": "failed", "stopped": "cancelled"}


def records_for(memory: Memory, now=lambda: datetime.now(UTC)) -> JobRecords:
    return JobRecords(WorkStore(memory.db, now), memory.db, now)


def end_job(records: JobRecords, job_id: str, state: str = "done") -> None:
    """End every running part of a job the way a finished run would (done, error or stopped)."""
    for part in records.parts_of(job_id):
        if part.state == "active":
            records.update_part(job_id, part.id, state=_WORK[state], reason=state)
