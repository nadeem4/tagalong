"""Timers: runs the due `timer` and `watch` work rows as `timer` events and keeps one wake armed.

Rows live in the work table so they survive a restart; this class only decides when to emit.
The runner decides when Scout actually hears it, and a cancelled timer's waiting wake is
finished, never told. It also hands a due `tool_call` or `expert_call` step (a retry that waited
out its backoff) to `rerun`.
"""

import asyncio
import logging
import sqlite3
from collections.abc import Awaitable, Callable
from datetime import datetime

from brain.events import Event
from brain.job_records import home_state
from brain.store.db import utc_text
from brain.store.work import TransitionRefused, WorkRow, WorkStore

log = logging.getLogger("brain")

MIN_REPEAT_S = 300
# Re-check at least hourly so a wall-clock change cannot strand the timer.
_MAX_SLEEP_S = 3600
KINDS = ("timer", "watch")
RERUN_KINDS = ("tool_call", "expert_call")


def note_of(row: WorkRow) -> str:
    """The whole note: a longer one than the title cap is kept in the input."""
    return (row.input or {}).get("note") or row.title


def is_return_wake(row: WorkRow) -> bool:
    return (row.input or {}).get("trigger") == "return"  # a loop's return wake runs elsewhere


class Timers:
    def __init__(
        self,
        work: WorkStore,
        emit: Callable[..., None],
        now: Callable[[], datetime],
        job_facts: Callable[[str], dict] = lambda job_id: {},
        rerun: Callable[[WorkRow], Awaitable[None]] | None = None,
        notify: Callable[[str, dict], None] | None = None,
        finish_news: Callable[[str, str], list[str]] = lambda kind, source: [],
    ) -> None:
        self._finish_news = finish_news  # ends a cancelled timer's waiting wake; returns ids
        self._notify = notify  # tells the bodies the list changed, so Home reads it again
        self._job_facts = job_facts  # a job timer's wake carries that job's watch list and summary
        self._work = work
        self._emit = emit
        self._now = now
        self._handle: asyncio.TimerHandle | None = None
        self._rerun = rerun
        self._runs: set[asyncio.Task] = set()

    def start(self) -> None:
        self.fire_due()

    def fire_due(self) -> None:
        at = utc_text(self._now())
        fired = False
        for row in self._work.due(KINDS):
            if is_return_wake(row):
                continue
            repeat_s = self._work.repeat_of(row.id)
            try:
                self._emit_one(row, repeat_s, lambda db, id=row.id: self._work.fire(id, at))
            except TransitionRefused:
                continue  # cancelled or paused as it came due: already handled, nothing saved
            except Exception:
                log.exception("firing timer %s failed", row.id)  # the others still fire
                continue
            fired = True
        self._rerun_due()
        self._arm()
        if fired:
            self._tell()  # a one-off is now pending, a repeating one moved: the page is stale

    def _rerun_due(self) -> None:
        if self._rerun is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # no loop yet: the rows stay planned until the next call
        for row in self._work.due(RERUN_KINDS):
            try:
                active = self._work.transition(row.id, "active", expect="planned")
            except TransitionRefused:
                continue  # cancelled or resolved as it came due: already handled
            task = loop.create_task(self._run_step(active))
            self._runs.add(task)
            task.add_done_callback(self._runs.discard)

    async def _run_step(self, row: WorkRow) -> None:
        assert self._rerun is not None
        try:
            await self._rerun(row)
        except Exception:
            log.exception("rerun of %s failed", row.id)
        finally:
            self._arm()  # a failed try may have set the next backoff

    def changed(self) -> None:
        self._arm()
        self._tell()

    def _tell(self) -> None:
        if self._notify is not None:
            self._notify("changed", {"what": "timers"})

    def cancel(self, tid: str, reason: str) -> bool:
        """End a timer or watch row; False when it is gone or already ended and told.

        A one-off that fired but whose news Scout has not heard yet can still be cancelled:
        its waiting event is finished, so the reminder is not told.
        """
        row = self._work.get(tid)
        if row is None:
            return False
        if row.state == "done":
            # Fired: only news still waiting in the log is left to end.
            if not self._finish_news("timer", f"timer:{tid}"):
                return False
        else:
            try:
                self._work.transition(tid, "cancelled", reason=reason)
            except TransitionRefused:
                return False
            self._finish_news("timer", f"timer:{tid}")
        self.changed()
        return True

    def _emit_one(
        self,
        row: WorkRow,
        repeat_s: int | None,
        then: Callable[[sqlite3.Connection], None],
    ) -> None:
        facts: dict = {"id": row.id, "note": note_of(row), "repeat_minutes": (repeat_s or 0) // 60}
        if row.kind == "watch":
            facts["kind"] = "watch"
        if row.parent_id:
            parent = self._work.get(row.parent_id)
            facts["job"] = row.parent_id
            if parent is not None:
                facts["state"] = home_state(parent.state)
            facts.update(self._job_facts(row.parent_id))
        event = Event(
            "timer", f"timer:{row.id}", facts, caused_by=(row.input or {}).get("caused_by")
        )
        self._emit(event, then=then)

    def _arm(self) -> None:
        if self._handle is not None:
            self._handle.cancel()
            self._handle = None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        # Not next_due(): a skipped row (a return wake) would stay overdue and spin this loop.
        times = [
            r.due_at
            for kind in (*KINDS, *(RERUN_KINDS if self._rerun else ()))
            for r in self._work.of_kind(kind, ["planned"])
            if r.due_at and not is_return_wake(r)
        ]
        if not times:
            return
        delay = (datetime.fromisoformat(min(times)) - self._now()).total_seconds()
        self._handle = loop.call_later(min(max(delay, 0), _MAX_SLEEP_S), self.fire_due)
