"""Test helpers for the ask log: seed decided asks and read Home's log, all through the work rows.

The log is no table of its own, so tests seed it the way production does: an `ask` row with
its facts, then the decision.
"""

import uuid
from datetime import UTC, datetime

from brain.approvals import Approvals
from brain.memory import Memory
from brain.store.work import AskLogRow, WorkStore


def work_on(mem: Memory, now=lambda: datetime.now(UTC)) -> WorkStore:
    return WorkStore(mem.db, now)


def approvals_on(mem: Memory, notify, now, guards=None) -> Approvals:
    """An Approvals over its own WorkStore on the memory's database."""
    return Approvals(mem, WorkStore(mem.db, now), notify, now, guards=guards)


def add_approval(
    mem: Memory,
    *,
    source: str,
    tool: str,
    summary: str,
    input: dict,
    group_key: str,
    outcome: str,
    decided_by: str,
    at: str,
    job_id: str | None = None,
    preference_id: int | None = None,
    preference_sentence: str | None = None,
) -> int:
    """One decided ask, ended at `at` (UTC text). Returns its log id."""
    work = WorkStore(mem.db, lambda: datetime.fromisoformat(at))
    row = work.create(
        "ask", summary, id=uuid.uuid4().hex, state="active", parent_id=work.open_goal(job_id)
    )
    log_id = work.add_ask(
        row.id, source=source, tool=tool, summary=summary, input=input, group_key=group_key
    )
    work.decide_ask(row.id, outcome, decided_by, preference_id, preference_sentence)
    return log_id


def list_approvals(mem: Memory, filter="all", limit=10, before=None) -> list[AskLogRow]:
    return work_on(mem).list_asks(filter, limit, before)


def approval_counts(mem: Memory) -> dict[str, int]:
    return work_on(mem).ask_counts()
