"""Tests for Timers: firing due work rows as events, re-arming, surviving restart.

The clock is injected; the arming tests use real time because due_at is stored to the whole
second.
"""

import asyncio
from datetime import UTC, datetime, timedelta

from job_rows import add_timer

from brain.memory import Memory
from brain.store.work import TransitionRefused, WorkStore
from brain.timers import Timers

T0 = datetime(2026, 10, 28, 12, 0, tzinfo=UTC)


class Clock:
    def __init__(self, at=T0):
        self.at = at

    def __call__(self):
        return self.at


def make(memory=None, clock=None, job_facts=None):
    memory = memory or Memory(":memory:")
    clock = clock or Clock()
    events = []
    starts = []

    def emit(event, *, on_start=None):
        events.append(event)
        starts.append(on_start)

    kw = {"job_facts": job_facts} if job_facts else {}
    work = WorkStore(memory.db, clock)
    return Timers(work, emit, clock, **kw), work, clock, events, starts


def test_fire_due_emits_a_timer_event_with_the_note_and_ends_a_one_off_when_its_wake_starts():
    timers, work, _clock, events, starts = make()
    t = add_timer(work, "stretch", T0 - timedelta(seconds=1))
    timers.fire_due()
    assert len(events) == 1
    e = events[0]
    assert e.kind == "timer"
    assert e.facts == {"id": t.id, "note": "stretch", "repeat_minutes": 0}
    assert e.key == f"timer:{t.id}"
    assert work.get(t.id).state == "active"  # fired, wake not started
    starts[0]()
    done = work.get(t.id)
    assert (done.state, done.end_reason) == ("done", "fired")
    assert done.reported_at is not None  # Scout is hearing it now


def test_one_off_is_not_fired_twice():
    timers, work, _c, events, starts = make()
    add_timer(work, "x", T0)
    timers.fire_due()
    timers.fire_due()  # an active row is not due again
    assert len(events) == 1
    starts[0]()


def test_active_timer_reemitted_on_start():
    mem = Memory(":memory:")
    timers, work, _c, _events, _starts = make(mem)
    t = add_timer(work, "x", T0)
    timers.fire_due()
    # The wake never started: a new Timers on the same database re-emits it.
    again, _w, _c2, events2, starts2 = make(mem)
    again.start()
    assert [e.facts["id"] for e in events2] == [t.id]
    starts2[0]()
    assert work.get(t.id).state == "done"


def test_not_yet_due_does_not_fire():
    timers, work, _c, events, _s = make()
    add_timer(work, "later", T0 + timedelta(minutes=1))
    timers.fire_due()
    assert events == []


def test_repeating_timer_fires_and_reschedules_from_now():
    timers, work, _c, events, starts = make()
    t = add_timer(work, "water", T0, repeat_s=600)
    timers.fire_due()
    assert events[0].facts["repeat_minutes"] == 10
    assert starts[0] is None
    got = work.get(t.id)
    assert got.due_at == "2026-10-28T12:10:00+00:00"
    assert got.state == "planned"


def test_overdue_repeat_fires_once_and_advances_from_now():
    timers, work, _c, events, _s = make()
    t = add_timer(work, "water", T0 - timedelta(days=3), repeat_s=3600)
    timers.start()
    assert len(events) == 1
    assert work.get(t.id).due_at == (T0 + timedelta(hours=1)).isoformat(timespec="seconds")


def test_missed_one_off_fires_once_at_start():
    timers, work, _c, events, _s = make()
    add_timer(work, "late", T0 - timedelta(hours=5))
    timers.start()
    assert len(events) == 1


def test_restart_keeps_timers(tmp_path):
    path = tmp_path / "m.db"
    mem = Memory(path)
    add_timer(WorkStore(mem.db, Clock()), "persist", T0 - timedelta(minutes=1))
    mem.close()
    timers, _w, _c, events, _s = make(Memory(path))
    timers.start()
    assert [e.facts["note"] for e in events] == ["persist"]


def test_two_due_timers_emit_in_due_order():
    timers, work, _c, events, _s = make()
    add_timer(work, "second", T0 - timedelta(minutes=1))
    add_timer(work, "first", T0 - timedelta(minutes=5))
    timers.fire_due()
    assert [e.facts["note"] for e in events] == ["first", "second"]


def test_cancel_during_fire_is_quiet():
    timers, work, _c, events, _s = make()
    t = add_timer(work, "stretch", T0 - timedelta(seconds=1))
    rows = work.due(["timer", "watch"])
    work.transition(t.id, "cancelled", reason="cancelled by Scout")
    work.due = lambda kinds: rows  # the runner read its list before the cancel
    timers.fire_due()
    assert events == []
    assert work.get(t.id).state == "cancelled"


def test_cancel_before_wake_start_is_quiet():
    timers, work, _c, events, starts = make()
    t = add_timer(work, "stretch", T0 - timedelta(seconds=1))
    timers.fire_due()
    work.transition(t.id, "cancelled", reason="cancelled by Scout")
    starts[0]()  # the wake begins after the cancel: nothing to end, nothing raised
    assert work.get(t.id).state == "cancelled"
    assert len(events) == 1


def test_paused_watch_not_fired():
    timers, work, _c, events, _s = make()
    w = add_timer(work, "check CI", T0 - timedelta(hours=1), repeat_s=3600, kind="watch")
    work.transition(w.id, "paused")
    timers.start()
    assert events == []


def test_planned_watch_fires_like_a_repeating_timer():
    timers, work, _c, events, _s = make()
    w = add_timer(work, "check CI", T0, repeat_s=1800, kind="watch")
    timers.fire_due()
    assert events[0].facts == {
        "id": w.id,
        "note": "check CI",
        "repeat_minutes": 30,
        "kind": "watch",
    }
    assert work.get(w.id).state == "planned"


def test_return_trigger_rows_are_skipped():
    timers, work, _c, events, _s = make()
    t = work.create("timer", "when back", due_at=T0, input={"trigger": "return"})
    timers.fire_due()
    assert events == []
    assert work.get(t.id).state == "planned"


async def test_arming_schedules_the_soonest_timer():
    mem = Memory(":memory:")
    events = []
    work = WorkStore(mem.db, lambda: datetime.now(UTC))
    timers = Timers(work, lambda e, **kw: events.append(e), lambda: datetime.now(UTC))
    add_timer(work, "soon", datetime.now(UTC) + timedelta(seconds=1.2))
    timers.start()
    assert events == []
    await asyncio.sleep(1.7)
    assert len(events) == 1


async def test_changed_rearms_for_a_new_sooner_timer():
    mem = Memory(":memory:")
    events = []
    work = WorkStore(mem.db, lambda: datetime.now(UTC))
    timers = Timers(work, lambda e, **kw: events.append(e), lambda: datetime.now(UTC))
    add_timer(work, "far", datetime.now(UTC) + timedelta(hours=1))
    timers.start()
    add_timer(work, "soon", datetime.now(UTC) + timedelta(seconds=1.2))
    timers.changed()
    await asyncio.sleep(1.7)
    assert [e.facts["note"] for e in events] == ["soon"]


def test_a_job_timer_wake_has_job_state_and_wake_facts():
    seen = []

    def job_facts(job_id):
        seen.append(job_id)
        return {"activity": "2 steps", "watching": "- tests pass"}

    timers, work, _c, events, _s = make(job_facts=job_facts)
    goal = work.create("goal", "a", id="j1", state="active")
    t = add_timer(work, "check back", T0 - timedelta(seconds=1), parent_id=goal.id)
    timers.fire_due()
    assert events[0].facts == {
        "id": t.id,
        "note": "check back",
        "repeat_minutes": 0,
        "job": "j1",
        "state": "running",
        "activity": "2 steps",
        "watching": "- tests pass",
    }
    assert seen == ["j1"]


def test_a_plain_timer_wake_facts_are_unchanged():
    timers, work, _c, events, _s = make(job_facts=lambda j: {"activity": "x"})
    t = add_timer(work, "plain", T0 - timedelta(seconds=1))
    timers.fire_due()
    assert events[0].facts == {"id": t.id, "note": "plain", "repeat_minutes": 0}


def test_a_long_note_is_read_from_the_input():
    timers, work, _c, events, _s = make()
    t = work.create("timer", "n" * 400, due_at=T0, input={"note": "n" * 400})
    timers.fire_due()
    assert events[0].facts["note"] == "n" * 400
    assert work.get(t.id).state == "active"


def test_goal_close_cancels_its_timer():
    timers, work, clock, events, _s = make()
    goal = work.create("goal", "a", id="j1", state="active")
    t = add_timer(work, "again", T0 + timedelta(minutes=5), repeat_s=300, parent_id=goal.id)
    work.close_goal("j1", "done", "ok")
    assert work.get(t.id).state == "cancelled"
    clock.at = T0 + timedelta(minutes=6)
    timers.fire_due()
    assert events == []


def test_transition_refused_is_the_race_signal():
    # The runner depends on this contract of the store.
    _t, work, _c, _e, _s = make()
    t = add_timer(work, "x", T0)
    work.transition(t.id, "cancelled", reason="x")
    try:
        work.transition(t.id, "active", expect="planned")
    except TransitionRefused:
        return
    raise AssertionError("expected TransitionRefused")


def test_changed_notifies_the_bodies():
    work = WorkStore(Memory(":memory:").db, Clock())
    notes = []
    timers = Timers(work, lambda *a, **k: None, Clock(), notify=lambda k, d: notes.append((k, d)))
    timers.changed()
    assert notes == [("changed", {"what": "timers"})]


def test_cancel_ends_the_row_and_marks_reported():
    timers, work, _c, events, _s = make()
    t = add_timer(work, "x", T0 + timedelta(hours=1))
    assert timers.cancel(t.id, "cancelled by the person") is True
    row = work.get(t.id)
    assert (row.state, row.end_reason) == ("cancelled", "cancelled by the person")
    assert row.reported_at is not None and events == []
    assert timers.cancel(t.id, "again") is False
