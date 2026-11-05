"""Tests for LoopService: the due timer emits one `loop` event per due loop, once."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from brain.loops.loop import Loop
from brain.loops.service import LoopService
from brain.loops.store import LoopStore
from brain.memory import Memory

T0 = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


class Clock:
    def __init__(self, at=T0):
        self.at = at

    def __call__(self):
        return self.at


@pytest.fixture
def parts(tmp_path):
    mem = Memory(tmp_path / "t.db")
    clock = Clock()
    store = LoopStore(mem.db, clock)
    yield store, clock, [], mem
    mem.close()


def svc(store, clock, events):
    return LoopService(store, events.append, clock)


def held(store, ref="a", due=None, status="held"):
    lp = store.save(Loop(source="app1", ref=ref, title=f"t-{ref}", asks="do it", due=due))
    if status != "held":
        store.set_status(lp.id, status)
    return lp


def test_past_due_held_loop_emits_one_loop_event(parts):
    store, clock, events, _ = parts
    lp = held(store, due=T0 - timedelta(hours=1))
    svc(store, clock, events).start()
    assert len(events) == 1
    e = events[0]
    assert e.kind == "loop" and e.key == f"loop:{lp.id}"
    assert e.facts["reason"] == "due" and e.facts["id"] == lp.id
    assert e.facts["title"] == "t-a" and e.facts["asks"] == "do it"


def test_due_fires_once_even_after_restart(parts):
    store, clock, events, _ = parts
    held(store, due=T0 - timedelta(hours=1))
    svc(store, clock, events).start()
    svc(store, clock, events).start()
    svc(store, clock, events).fire_due()
    assert len(events) == 1


def test_a_changed_due_fires_again(parts):
    store, clock, events, _ = parts
    held(store, due=T0 - timedelta(hours=2))
    s = svc(store, clock, events)
    s.start()
    held(store, due=T0 - timedelta(hours=1))  # same loop, new due
    s.fire_due()
    assert len(events) == 2


def test_snoozed_fires_but_done_dropped_surfaced_stale_do_not(parts):
    store, clock, events, _ = parts
    past = T0 - timedelta(hours=1)
    held(store, "s", past, "snoozed")
    for ref, st in [("d", "done"), ("x", "dropped"), ("u", "surfaced")]:
        held(store, ref, past, st)
    svc(store, clock, events).start()
    assert [e.facts["title"] for e in events] == ["t-s"]


def test_no_due_never_fires(parts):
    store, clock, events, _ = parts
    held(store, due=None)
    svc(store, clock, events).start()
    assert events == []


def test_future_due_arms_a_timer_and_fires_when_it_comes(tmp_path):
    async def run():
        mem = Memory(tmp_path / "t.db")
        now = lambda: datetime.now(UTC)  # noqa: E731
        store = LoopStore(mem.db, now)
        events = []
        held(store, due=now() + timedelta(milliseconds=150))
        s = LoopService(store, events.append, now)
        s.start()
        assert events == [] and s._handle is not None
        await asyncio.sleep(0.4)
        assert len(events) == 1
        mem.close()

    asyncio.run(run())


def test_changed_rearms_for_a_loop_added_later(tmp_path):
    async def run():
        mem = Memory(tmp_path / "t.db")
        now = lambda: datetime.now(UTC)  # noqa: E731
        store = LoopStore(mem.db, now)
        events = []
        s = LoopService(store, events.append, now)
        s.start()
        assert s._handle is None
        held(store, due=now() + timedelta(milliseconds=150))
        s.changed()
        assert s._handle is not None
        await asyncio.sleep(0.4)
        assert len(events) == 1
        mem.close()

    asyncio.run(run())


def test_surfaced_day_is_the_local_day(parts):
    store, clock, events, _ = parts
    clock.at = datetime(2026, 11, 4, 23, 30, tzinfo=UTC)
    lp = held(store, due=clock.at - timedelta(minutes=5))
    svc(store, clock, events).start()
    assert list(store.get(lp.id).surfaced.values()) == [clock.at.astimezone().date().isoformat()]


def test_a_new_service_over_an_earlier_saved_future_loop_arms_and_fires(tmp_path):
    async def run():
        now = lambda: datetime.now(UTC)  # noqa: E731
        mem = Memory(tmp_path / "t.db")
        held(LoopStore(mem.db, now), due=now() + timedelta(milliseconds=150))
        mem.close()
        mem = Memory(tmp_path / "t.db")  # the brain restarted
        events = []
        s = LoopService(LoopStore(mem.db, now), events.append, now)
        s.start()
        assert events == [] and s._handle is not None
        await asyncio.sleep(0.4)
        assert len(events) == 1
        mem.close()

    asyncio.run(run())


def test_stale_loop_with_a_future_due_still_fires(parts):
    store, clock, events, _ = parts
    held(store, due=T0 - timedelta(hours=1), status="stale")
    svc(store, clock, events).start()
    assert len(events) == 1


def test_throttled_ripe_quiet_loops_arm_after_the_throttle_not_now(tmp_path):
    async def run():
        mem = Memory(tmp_path / "t.db")
        store = LoopStore(mem.db, Clock())
        events = []
        for ref in "abc":
            store.save(
                Loop(
                    source="app1",
                    ref=ref,
                    title=ref,
                    asks="x",
                    direction="they_owe",
                    quiet_after=T0 - timedelta(hours=1),
                )
            )
        s = svc(store, Clock(), events)
        s.start()
        assert len(events) == 2 and s._handle is not None
        assert s._handle.when() - asyncio.get_running_loop().time() > 60
        mem.close()

    asyncio.run(run())
