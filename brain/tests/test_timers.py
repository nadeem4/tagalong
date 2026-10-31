"""Tests for Timers: firing due timers as events, re-arming, surviving restart.

The clock is injected; the arming tests use real time because Memory stores
next_at to the whole second.
"""

import asyncio
from datetime import UTC, datetime, timedelta

from brain.memory import Memory
from brain.timers import Timers

T0 = datetime(2026, 10, 28, 12, 0, tzinfo=UTC)


class Clock:
    def __init__(self, at=T0):
        self.at = at

    def __call__(self):
        return self.at


def make(memory=None, clock=None):
    memory = memory or Memory(":memory:")
    clock = clock or Clock()
    events = []
    starts = []

    def emit(event, *, on_start=None):
        events.append(event)
        starts.append(on_start)

    return Timers(memory, emit, clock), memory, clock, events, starts


def _timer(mem, id):
    # The timer with this id, read through the public list; None once it is gone.
    return next((t for t in mem.list_timers() if t.id == id), None)


def test_fire_due_emits_a_timer_event_with_the_note_and_deletes_a_one_off():
    timers, mem, _clock, events, starts = make()
    t = mem.add_timer("stretch", T0 - timedelta(seconds=1))
    timers.fire_due()
    assert len(events) == 1
    e = events[0]
    assert e.kind == "timer"
    assert e.facts == {"id": t.id, "note": "stretch", "repeat_minutes": 0}
    assert e.key == f"timer:{t.id}"
    # Marked fired, still stored until the wake turn starts.
    assert _timer(mem, t.id).fired
    starts[0]()
    assert _timer(mem, t.id) is None


def test_one_off_is_deleted_only_when_its_wake_starts():
    timers, mem, _c, events, starts = make()
    t = mem.add_timer("x", T0)
    timers.fire_due()
    assert _timer(mem, t.id) is not None
    timers.fire_due()  # fired rows are not due again
    assert len(events) == 1
    starts[0]()
    assert _timer(mem, t.id) is None


def test_fired_one_off_is_re_emitted_after_restart():
    timers, mem, _c, events, starts = make()
    t = mem.add_timer("x", T0)
    timers.fire_due()
    # The wake never started: a new Timers on the same memory re-emits it.
    timers2, _m, _c2, events2, _s2 = make(mem)
    timers2.start()
    assert [e.facts["id"] for e in events2] == [t.id]


def test_not_yet_due_does_not_fire():
    timers, mem, _c, events, _s = make()
    mem.add_timer("later", T0 + timedelta(minutes=1))
    timers.fire_due()
    assert events == []


def test_repeating_timer_fires_and_reschedules_from_now():
    timers, mem, _c, events, starts = make()
    t = mem.add_timer("water", T0, repeat_s=600)
    timers.fire_due()
    assert events[0].facts["repeat_minutes"] == 10
    assert starts[0] is None
    got = _timer(mem, t.id)
    assert got.next_at == T0 + timedelta(seconds=600)
    assert not got.fired


def test_missed_repeats_fire_once_at_start():
    timers, mem, _c, events, _s = make()
    t = mem.add_timer("water", T0 - timedelta(hours=5), repeat_s=600)
    timers.start()
    assert len(events) == 1
    assert _timer(mem, t.id).next_at == T0 + timedelta(minutes=10)


def test_missed_one_off_fires_once_at_start():
    timers, mem, _c, events, _s = make()
    mem.add_timer("late", T0 - timedelta(hours=5))
    timers.start()
    assert len(events) == 1


def test_restart_keeps_timers(tmp_path):
    path = tmp_path / "m.db"
    mem = Memory(path)
    mem.add_timer("persist", T0 - timedelta(minutes=1))
    mem.close()
    timers, mem2, _c, events, _s = make(Memory(path))
    timers.start()
    assert [e.facts["note"] for e in events] == ["persist"]


def test_two_due_timers_emit_in_due_order():
    timers, mem, _c, events, _s = make()
    mem.add_timer("second", T0 - timedelta(minutes=1))
    mem.add_timer("first", T0 - timedelta(minutes=5))
    timers.fire_due()
    assert [e.facts["note"] for e in events] == ["first", "second"]


async def test_arming_schedules_the_soonest_timer():
    mem = Memory(":memory:")
    events = []
    timers = Timers(mem, lambda e, **kw: events.append(e), lambda: datetime.now(UTC))
    mem.add_timer("soon", datetime.now(UTC) + timedelta(seconds=1.2))
    timers.start()
    assert events == []
    await asyncio.sleep(1.7)
    assert len(events) == 1


async def test_changed_rearms_for_a_new_sooner_timer():
    mem = Memory(":memory:")
    events = []
    timers = Timers(mem, lambda e, **kw: events.append(e), lambda: datetime.now(UTC))
    mem.add_timer("far", datetime.now(UTC) + timedelta(hours=1))
    timers.start()
    mem.add_timer("soon", datetime.now(UTC) + timedelta(seconds=1.2))
    timers.changed()
    await asyncio.sleep(1.7)
    assert [e.facts["note"] for e in events] == ["soon"]
