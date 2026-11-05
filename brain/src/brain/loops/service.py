"""LoopService: wakes Scout when a held loop comes due. Reads no mail yet.

Code decides when; Scout decides whether and what to say. A due loop fires once per due
time (recorded in the store, so a restart never repeats it), through the same event path
timers use. The arming mirrors Timers: one call_later, re-checked at least hourly.
"""

import asyncio
from collections.abc import Callable
from datetime import datetime

from brain.events import Event
from brain.loops.loop import Loop
from brain.loops.reader import Reader
from brain.loops.store import LoopStore

# Re-check at least hourly so a wall-clock change cannot strand the timer.
_MAX_SLEEP_S = 3600
_DUE_STATUSES = ("held", "snoozed")


def _due_anchor(loop: Loop) -> str:
    # Keyed by the due time, so moving a deadline lets it fire again.
    return f"due:{loop.due.isoformat()}" if loop.due else ""


class LoopService:
    def __init__(
        self,
        store: LoopStore,
        emit: Callable[..., None],
        now: Callable[[], datetime],
        reader: Reader | None = None,  # the mail source (next slice) feeds it items
    ) -> None:
        self._store = store
        self._emit = emit
        self._now = now
        self._reader = reader
        self._handle: asyncio.TimerHandle | None = None

    def start(self) -> None:
        self.fire_due()

    def changed(self) -> None:
        """Call after loops are added or edited, so the timer covers the earliest due."""
        self.fire_due()

    def fire_due(self) -> None:
        now = self._now()
        for loop in self._unfired():
            assert loop.due is not None
            if loop.due <= now:
                # Marked before emitting: a crash after this loses one wake, never repeats it.
                self._store.mark_surfaced(loop.id, _due_anchor(loop), now.date().isoformat())
                self._emit(Event("loop", self._facts(loop, "due"), key=f"loop:{loop.id}"))
        self._arm()

    def _unfired(self) -> list[Loop]:
        loops = [lp for s in _DUE_STATUSES for lp in self._store.list(s) if lp.due]
        return sorted(
            (lp for lp in loops if _due_anchor(lp) not in lp.surfaced), key=lambda lp: lp.due
        )  # type: ignore[arg-type, return-value]

    @staticmethod
    def _facts(loop: Loop, reason: str) -> dict[str, str | int]:
        facts: dict[str, str | int] = {
            "reason": reason,
            "id": loop.id,
            "title": loop.title,
            "asks": loop.asks,
            "direction": loop.direction,
        }
        if loop.people:
            facts["people"] = ", ".join(loop.people)
        if loop.due:
            facts["due"] = loop.due.isoformat()
        return facts

    def _arm(self) -> None:
        if self._handle is not None:
            self._handle.cancel()
            self._handle = None
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            return
        pending = self._unfired()
        if not pending:
            return
        delay = (pending[0].due - self._now()).total_seconds()  # type: ignore[operator]
        self._handle = running.call_later(min(max(delay, 0), _MAX_SLEEP_S), self.fire_due)
