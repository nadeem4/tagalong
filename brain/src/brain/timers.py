"""Timers: fires Scout's stored timers as `timer` events and keeps one wake armed.

Rows live in Memory so they survive a restart; this class only decides when to
emit. The scheduler decides when Scout actually hears it.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime, timedelta

from brain.events import Event
from brain.memory import Memory, Timer

log = logging.getLogger("brain")

MIN_REPEAT_S = 300
# Re-check at least hourly so a wall-clock change cannot strand the timer.
_MAX_SLEEP_S = 3600


class Timers:
    def __init__(
        self,
        memory: Memory,
        emit: Callable[..., None],
        now: Callable[[], datetime],
    ) -> None:
        self._memory = memory
        self._emit = emit
        self._now = now
        self._handle: asyncio.TimerHandle | None = None

    def start(self) -> None:
        # A one-off that fired but whose wake never began is re-delivered.
        for t in self._memory.fired_timers():
            self._emit_one(t)
        self.fire_due()

    def fire_due(self) -> None:
        now = self._now()
        for t in self._memory.due_timers(now):
            if t.repeat_s:
                # From now, not from the old time: a long gap fires once.
                self._memory.set_timer_next(t.id, now + timedelta(seconds=t.repeat_s))
            else:
                self._memory.mark_timer_fired(t.id)
            self._emit_one(t)
        self._arm()

    def changed(self) -> None:
        self._arm()

    def _emit_one(self, t: Timer) -> None:
        facts = {"id": t.id, "note": t.note, "repeat_minutes": (t.repeat_s or 0) // 60}
        event = Event("timer", facts, key=f"timer:{t.id}")
        if t.repeat_s:
            self._emit(event)
        else:
            # Deleted only once Scout's turn starts, so a lost wake is not lost.
            self._emit(event, on_start=lambda: self._memory.delete_timer(t.id))

    def _arm(self) -> None:
        if self._handle is not None:
            self._handle.cancel()
            self._handle = None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        pending = [t for t in self._memory.list_timers() if not t.fired]
        if not pending:
            return
        delay = (pending[0].next_at - self._now()).total_seconds()
        self._handle = loop.call_later(min(max(delay, 0), _MAX_SLEEP_S), self.fire_due)
