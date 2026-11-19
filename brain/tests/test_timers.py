"""Tests for Timers: firing due work rows as events, re-arming, surviving restart.

The clock is injected; the arming tests use real time because due_at is stored to the whole
second.
"""

import asyncio
from datetime import UTC, datetime, timedelta

from job_rows import add_timer, tasks_for

from brain.events import EventLog
from brain.masking import Masker
from brain.memory import Memory
from brain.store import events as event_store
from brain.store.db import transaction
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

    def emit(event, *, then=None):
        if then is not None:  # the real door runs it in the event's transaction
            with transaction(memory.db):
                then(memory.db)
        events.append(event)

    kw = {"job_facts": job_facts} if job_facts else {}
    work = WorkStore(memory.db, clock)
    timers = Timers(work, emit, clock, **kw)
    return timers, work, clock, events


def test_fire_due_emits_a_timer_event_and_a_one_off_is_done_at_the_fire():
    timers, work, _clock, events = make()
    t = add_timer(work, "stretch", T0 - timedelta(seconds=1))
    timers.fire_due()
    assert len(events) == 1
    e = events[0]
    assert e.kind == "timer"
    assert e.payload == {"id": t.id, "note": "stretch", "repeat_minutes": 0}
    assert e.source == f"timer:{t.id}"
    done = work.get(t.id)
    assert (done.state, done.end_reason) == ("done", "fired")


def test_one_off_is_not_fired_twice():
    timers, work, _c, events = make()
    add_timer(work, "x", T0)
    timers.fire_due()
    timers.fire_due()  # a done row is not due again
    assert len(events) == 1


def test_a_fired_one_off_is_done_and_its_event_saved_together():
    memory = Memory(":memory:")
    log = EventLog(memory.db, Masker(lambda: []), Clock())
    work = WorkStore(memory.db, Clock())
    timers = Timers(work, lambda event, **kw: log.post(event, then=kw["then"]), Clock())
    t = add_timer(work, "stretch", T0 - timedelta(seconds=1), kind="timer")
    timers.fire_due()
    assert work.get(t.id).state == "done"
    ready = log.ready()
    assert [(r.kind, r.state, r.source) for r in ready] == [("timer", "new", f"timer:{t.id}")]


def test_one_failing_fire_does_not_stop_the_next_row(monkeypatch):
    timers, work, _c, events = make()
    first = add_timer(work, "first", T0 - timedelta(minutes=2))
    second = add_timer(work, "second", T0 - timedelta(minutes=1))
    real = work.fire

    def flaky(id, at):
        if id == first.id:
            raise RuntimeError("disk full")
        real(id, at)

    monkeypatch.setattr(work, "fire", flaky)
    timers.fire_due()
    assert [e.payload["note"] for e in events] == ["second"]
    assert work.get(first.id).state == "planned"
    assert work.get(second.id).state == "done"


def _with_task(repeat_s=None):
    """A timer row under a new Later, and everything needed to fire it for real."""
    memory = Memory(":memory:")
    log = EventLog(memory.db, Masker(lambda: []), Clock())
    work = WorkStore(memory.db, Clock())
    timers = Timers(work, lambda event, **kw: log.post(event, **kw), Clock())
    tasks = tasks_for(memory)
    tid = tasks.open("later", "desktop-1", title="stretch")
    tasks.wait(tid)
    row = work.create("timer", "stretch", state="planned", due_at=T0, task_id=tid)
    work.set_repeat(row.id, repeat_s)
    return timers, log, tasks, tid


def test_a_repeating_timer_is_a_repeating_later_task():
    timers, log, tasks, tid = _with_task(repeat_s=600)
    timers.fire_due()
    assert [e.task for e in log.ready()] == [tid]
    log.finish([e.id for e in log.ready()], "handled")
    tasks.settle()
    assert tasks.get(tid).state == "waiting"  # a repeating timer is still planned


def test_a_one_off_later_ends_done_once_its_fire_is_told():
    timers, log, tasks, tid = _with_task()
    timers.fire_due()
    assert tasks.settle() == []  # the fire is not told yet
    log.finish([e.id for e in log.ready()], "handled")
    assert tasks.settle() == [tid]
    assert tasks.get(tid).state == "done"


def test_cancelling_a_fired_but_untold_timer_ends_its_news():
    memory = Memory(":memory:")
    log = EventLog(memory.db, Masker(lambda: []), Clock())
    work = WorkStore(memory.db, Clock())
    timers = Timers(
        work,
        lambda event, **kw: log.post(event, then=kw["then"]),
        Clock(),
        finish_news=log.finish_matching,
    )
    t = add_timer(work, "stretch", T0 - timedelta(seconds=1))
    timers.fire_due()
    assert len(log.ready()) == 1
    assert timers.cancel(t.id, "cancelled by the person") is True
    assert log.ready() == []  # finished, not told
    assert timers.cancel(t.id, "again") is False  # already ended and handled


def test_a_one_off_already_told_cannot_be_cancelled():
    memory = Memory(":memory:")
    log = EventLog(memory.db, Masker(lambda: []), Clock())
    work = WorkStore(memory.db, Clock())
    timers = Timers(
        work,
        lambda event, **kw: log.post(event, then=kw["then"]),
        Clock(),
        finish_news=log.finish_matching,
    )
    t = add_timer(work, "x", T0 - timedelta(seconds=1))
    timers.fire_due()
    [row] = log.ready()
    log.take([row.id], "turn")
    log.finish([row.id], "handled")  # Scout heard it
    assert timers.cancel(t.id, "late") is False
    assert timers.cancel("nope", "x") is False


def test_a_fire_whose_event_insert_fails_leaves_the_timer_planned(monkeypatch):
    memory = Memory(":memory:")
    log = EventLog(memory.db, Masker(lambda: []), Clock())
    work = WorkStore(memory.db, Clock())
    timers = Timers(work, lambda event, **kw: log.post(event, then=kw["then"]), Clock())
    t = add_timer(work, "stretch", T0 - timedelta(seconds=1))

    def boom(db, row):
        raise RuntimeError("disk full")

    monkeypatch.setattr(event_store, "insert", boom)
    timers.fire_due()  # logged, not raised: the other rows still get their turn
    row = work.get(t.id)
    assert (row.state, row.due_at) == ("planned", "2026-10-28T11:59:59+00:00")
    assert log.ready() == []


def test_the_fired_event_is_caused_by_the_event_that_set_the_timer():
    timers, work, _c, events = make()
    work.create("timer", "x", due_at=T0, input={"caused_by": "ev1"})
    timers.fire_due()
    assert events[0].caused_by == "ev1"


def test_not_yet_due_does_not_fire():
    timers, work, _c, events = make()
    add_timer(work, "later", T0 + timedelta(minutes=1))
    timers.fire_due()
    assert events == []


def test_repeating_timer_fires_and_reschedules_from_now():
    timers, work, _c, events = make()
    t = add_timer(work, "water", T0, repeat_s=600)
    timers.fire_due()
    assert events[0].payload["repeat_minutes"] == 10
    got = work.get(t.id)
    assert got.due_at == "2026-10-28T12:10:00+00:00"
    assert got.state == "planned"


def test_overdue_repeat_fires_once_and_advances_from_now():
    timers, work, _c, events = make()
    t = add_timer(work, "water", T0 - timedelta(days=3), repeat_s=3600)
    timers.start()
    assert len(events) == 1
    assert work.get(t.id).due_at == (T0 + timedelta(hours=1)).isoformat(timespec="seconds")


def test_missed_one_off_fires_once_at_start():
    timers, work, _c, events = make()
    add_timer(work, "late", T0 - timedelta(hours=5))
    timers.start()
    assert len(events) == 1


def test_restart_keeps_timers(tmp_path):
    path = tmp_path / "m.db"
    mem = Memory(path)
    add_timer(WorkStore(mem.db, Clock()), "persist", T0 - timedelta(minutes=1))
    mem.close()
    timers, _w, _c, events = make(Memory(path))
    timers.start()
    assert [e.payload["note"] for e in events] == ["persist"]


def test_two_due_timers_emit_in_due_order():
    timers, work, _c, events = make()
    add_timer(work, "second", T0 - timedelta(minutes=1))
    add_timer(work, "first", T0 - timedelta(minutes=5))
    timers.fire_due()
    assert [e.payload["note"] for e in events] == ["first", "second"]


def test_cancel_during_fire_is_quiet():
    timers, work, _c, events = make()
    t = add_timer(work, "stretch", T0 - timedelta(seconds=1))
    rows = work.due(["timer", "watch"])
    work.transition(t.id, "cancelled", reason="cancelled by Scout")
    work.due = lambda kinds: rows  # the runner read its list before the cancel
    timers.fire_due()
    assert events == []
    assert work.get(t.id).state == "cancelled"


def test_paused_watch_not_fired():
    timers, work, _c, events = make()
    w = add_timer(work, "check CI", T0 - timedelta(hours=1), repeat_s=3600, kind="watch")
    work.transition(w.id, "paused")
    timers.start()
    assert events == []


def test_planned_watch_fires_like_a_repeating_timer():
    timers, work, _c, events = make()
    w = add_timer(work, "check CI", T0, repeat_s=1800, kind="watch")
    timers.fire_due()
    assert events[0].payload == {
        "id": w.id,
        "note": "check CI",
        "repeat_minutes": 30,
        "kind": "watch",
    }
    assert work.get(w.id).state == "planned"


def test_return_trigger_rows_are_skipped():
    timers, work, _c, events = make()
    t = work.create("timer", "when back", due_at=T0, input={"trigger": "return"})
    timers.fire_due()
    assert events == []
    assert work.get(t.id).state == "planned"


def _saving(memory, events):
    """An emit that saves like the real door: the fire commits with the event."""

    def emit(event, *, then=None, **kw):
        with transaction(memory.db):
            then(memory.db)
        events.append(event)

    return emit


async def test_arming_schedules_the_soonest_timer():
    mem = Memory(":memory:")
    events = []
    work = WorkStore(mem.db, lambda: datetime.now(UTC))
    timers = Timers(work, _saving(mem, events), lambda: datetime.now(UTC))
    add_timer(work, "soon", datetime.now(UTC) + timedelta(seconds=1.2))
    timers.start()
    assert events == []
    await asyncio.sleep(1.7)
    assert len(events) == 1


async def test_changed_rearms_for_a_new_sooner_timer():
    mem = Memory(":memory:")
    events = []
    work = WorkStore(mem.db, lambda: datetime.now(UTC))
    timers = Timers(work, _saving(mem, events), lambda: datetime.now(UTC))
    add_timer(work, "far", datetime.now(UTC) + timedelta(hours=1))
    timers.start()
    add_timer(work, "soon", datetime.now(UTC) + timedelta(seconds=1.2))
    timers.changed()
    await asyncio.sleep(1.7)
    assert [e.payload["note"] for e in events] == ["soon"]


def test_a_job_timer_wake_has_job_state_and_wake_facts():
    seen = []

    def job_facts(job_id):
        seen.append(job_id)
        return {"activity": "2 steps", "watching": "- tests pass"}

    timers, work, _c, events = make(job_facts=job_facts)
    goal = work.create("goal", "a", id="j1", state="active")
    t = add_timer(work, "check back", T0 - timedelta(seconds=1), parent_id=goal.id)
    timers.fire_due()
    assert events[0].payload == {
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
    timers, work, _c, events = make(job_facts=lambda j: {"activity": "x"})
    t = add_timer(work, "plain", T0 - timedelta(seconds=1))
    timers.fire_due()
    assert events[0].payload == {"id": t.id, "note": "plain", "repeat_minutes": 0}


def test_a_long_note_is_read_from_the_input():
    timers, work, _c, events = make()
    t = work.create("timer", "n" * 400, due_at=T0, input={"note": "n" * 400})
    timers.fire_due()
    assert events[0].payload["note"] == "n" * 400
    assert work.get(t.id).state == "done"


def test_goal_close_cancels_its_timer():
    timers, work, clock, events = make()
    goal = work.create("goal", "a", id="j1", state="active")
    t = add_timer(work, "again", T0 + timedelta(minutes=5), repeat_s=300, parent_id=goal.id)
    work.close_goal("j1", "done", "ok")
    assert work.get(t.id).state == "cancelled"
    clock.at = T0 + timedelta(minutes=6)
    timers.fire_due()
    assert events == []


def test_transition_refused_is_the_race_signal():
    # The runner depends on this contract of the store.
    _t, work, _c, _e = make()
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


def test_cancel_ends_the_row():
    timers, work, _c, events = make()
    t = add_timer(work, "x", T0 + timedelta(hours=1))
    assert timers.cancel(t.id, "cancelled by the person") is True
    row = work.get(t.id)
    assert (row.state, row.end_reason) == ("cancelled", "cancelled by the person")
    assert events == []
    assert timers.cancel(t.id, "again") is False


def _noting():
    notes = []
    clock = Clock()
    memory = Memory(":memory:")
    work = WorkStore(memory.db, clock)

    def emit(event, *, then=None, **kw):
        with transaction(memory.db):
            then(memory.db)

    timers = Timers(work, emit, clock, notify=lambda k, d: notes.append((k, d)))
    return timers, work, notes


def test_firing_a_one_off_tells_home_once():
    timers, work, notes = _noting()
    add_timer(work, "x", T0 - timedelta(seconds=1))
    timers.fire_due()
    assert notes == [("changed", {"what": "timers"})]


def test_a_repeating_timer_advancing_tells_home():
    timers, work, notes = _noting()
    add_timer(work, "x", T0 - timedelta(seconds=1), repeat_s=600)
    timers.fire_due()
    assert notes == [("changed", {"what": "timers"})]


def test_nothing_due_tells_nobody():
    timers, work, notes = _noting()
    add_timer(work, "x", T0 + timedelta(hours=1))
    timers.fire_due()
    assert notes == []


def test_a_cancelled_timers_new_event_is_finished_not_told():
    memory = Memory(":memory:")
    log = EventLog(memory.db, Masker(lambda: []), Clock())
    work = WorkStore(memory.db, Clock())
    timers = Timers(
        work,
        lambda event, **kw: log.post(event, then=kw.get("then")),
        Clock(),
        finish_news=log.finish_matching,
    )
    t = add_timer(work, "stretch", T0 - timedelta(seconds=1), repeat_s=600)
    other = add_timer(work, "walk", T0 - timedelta(seconds=1), repeat_s=600)
    timers.fire_due()
    assert len(log.ready()) == 2
    timers.cancel(t.id, "cancelled by Scout")
    assert [r.source for r in log.ready()] == [f"timer:{other.id}"]  # only that timer's news ended
