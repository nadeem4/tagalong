"""Tests for LoopService: the due timer emits one `loop` event per due loop, once."""

import asyncio
import time
from datetime import UTC, datetime, timedelta

import pytest
from loop_rows import loop_store

from brain.loops.loop import Loop
from brain.loops.service import LoopService
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
    store = loop_store(mem, clock)
    yield store, clock, [], mem
    mem.close()


def second_clock():
    """Real time that starts on a whole second: stored times keep whole seconds only."""
    base, t0 = datetime.now(UTC).replace(microsecond=0), time.monotonic()
    return lambda: base + timedelta(seconds=time.monotonic() - t0)


def svc(store, clock, events):
    return LoopService(store, events.append, clock)


def held(store, ref="a", due=None, status="held"):
    lp = store.save(Loop(source="app1", ref=ref, title=f"t-{ref}", asks="do it", due=due))
    if status == "snoozed":
        store.snooze(lp.id, T0 + timedelta(days=1))
    elif status != "held":
        store.set_status(lp.id, status)
    return lp


def test_past_due_held_loop_emits_one_loop_event(parts):
    store, clock, events, _ = parts
    lp = held(store, due=T0 - timedelta(hours=1))
    svc(store, clock, events).start()
    assert len(events) == 1
    e = events[0]
    assert e.kind == "loop" and e.source == f"loop:{lp.source}"
    assert e.payload["reason"] == "due" and e.payload["id"] == lp.id
    assert e.payload["title"] == "t-a" and e.payload["asks"] == "do it"


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


def test_snoozed_fires_but_done_and_dropped_do_not(parts):
    store, clock, events, _ = parts
    past = T0 - timedelta(hours=1)
    held(store, "s", past, "snoozed")
    for ref, st in [("d", "done"), ("x", "dropped")]:
        held(store, ref, past, st)
    svc(store, clock, events).start()
    assert [e.payload["title"] for e in events] == ["t-s"]


def test_no_due_never_fires(parts):
    store, clock, events, _ = parts
    held(store, due=None)
    svc(store, clock, events).start()
    assert events == []


def test_future_due_arms_a_timer_and_fires_when_it_comes(tmp_path):
    async def run():
        mem = Memory(tmp_path / "t.db")
        now = second_clock()
        store = loop_store(mem, now)
        events = []
        held(store, due=now() + timedelta(seconds=1))
        s = LoopService(store, events.append, now)
        s.start()
        assert events == [] and s._handle is not None
        await asyncio.sleep(1.5)
        assert len(events) == 1
        mem.close()

    asyncio.run(run())


def test_changed_rearms_for_a_loop_added_later(tmp_path):
    async def run():
        mem = Memory(tmp_path / "t.db")
        now = second_clock()
        store = loop_store(mem, now)
        events = []
        s = LoopService(store, events.append, now)
        s.start()
        assert s._handle is None
        held(store, due=now() + timedelta(seconds=1))
        s.changed()
        assert s._handle is not None
        await asyncio.sleep(1.5)
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
        now = second_clock()
        mem = Memory(tmp_path / "t.db")
        held(loop_store(mem, now), due=now() + timedelta(seconds=1))
        mem.close()
        mem = Memory(tmp_path / "t.db")  # the brain restarted
        events = []
        s = LoopService(loop_store(mem, now), events.append, now)
        s.start()
        assert events == [] and s._handle is not None
        await asyncio.sleep(1.5)
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
        store = loop_store(mem, Clock())
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


def test_a_loop_is_not_marked_surfaced_when_its_emit_fails(parts):
    store, clock, _, _ = parts
    lp = held(store, due=T0 - timedelta(hours=1))

    def broken(event):
        raise RuntimeError("the door is shut")

    with pytest.raises(RuntimeError):
        LoopService(store, broken, clock).start()
    assert not store.get(lp.id).surfaced  # the next start tries again


# --- watch tasks: one per mail app (T3c) ---


class IdleSource:
    """A mail source with nothing to read: these tests are about the task, not the poll."""

    async def new_items(self, since, unanswered_only=False):
        return []

    async def sent_items(self, since):
        return []


def watched(parts):
    from brain.tasks import Tasks

    store, clock, events, mem = parts
    s = svc(store, clock, events)
    s.tasks = Tasks(mem.db, lambda t: t, clock)
    return s


def open_watches(s):
    return [t for t in s.tasks.open_block().splitlines() if " watch " in t]


async def test_a_mail_loop_posts_under_one_watch_task(parts):
    store, clock, events, _ = parts
    s = watched(parts)
    s.enable("app1", IdleSource())
    held(store, due=T0 - timedelta(hours=1))
    s.fire_due()
    watch = s.tasks.open_watch("loop:app1")
    assert watch and events[-1].task == watch
    assert s.tasks.get(watch).title == "Watching app1 mail"


async def test_enable_twice_keeps_one_watch_task(parts):
    s = watched(parts)
    s.enable("app1", IdleSource())
    first = s.tasks.open_watch("loop:app1")
    s.enable("app1", IdleSource())
    assert s.tasks.open_watch("loop:app1") == first
    assert len(open_watches(s)) == 1
    s.disable("app1")


async def test_disable_ends_the_watch_task(parts):
    s = watched(parts)
    s.enable("app1", IdleSource())
    watch = s.tasks.open_watch("loop:app1")
    s.disable("app1")
    row = s.tasks.get(watch)
    assert (row.state, row.end_reason) == ("stopped", "switched off")
    assert s.tasks.open_watch("loop:app1") is None


async def test_start_gives_an_app_reading_mail_a_watch_task(parts):
    store, clock, events, mem = parts
    store.set_on("app1", True)
    s = watched(parts)
    s._apps = type("A", (), {"call": None, "tools": lambda self, a: []})()
    s.start()
    assert s.tasks.open_watch("loop:app1")
    s.disable("app1")


async def stop_through_tasks(s, task):
    """Tasks.stop with every hook a no-op but the watch one, as the session wires it."""
    from job_rows import no_hooks

    s.tasks.hooks = no_hooks(stop_watch=s.task_stopped)
    return await s.tasks.stop(task, "desktop")


async def test_stopping_a_mail_watch_switches_the_app_off_for_good(parts):
    store, clock, events, mem = parts
    s = watched(parts)
    s.enable("app1", IdleSource())
    task = s.tasks.open_watch("loop:app1")
    assert await stop_through_tasks(s, task) == [task]
    assert not s.is_on("app1") and "app1" not in store.on_apps()
    again = watched(parts)  # a restart: reading stays off, and no Watch task comes back
    again.start()
    assert not again.is_on("app1") and again.tasks.open_watch("loop:app1") is None


async def test_stop_leaves_held_loops_alone(parts):
    store, _, _, _ = parts
    s = watched(parts)
    s.enable("app1", IdleSource())
    lp = held(store)
    await stop_through_tasks(s, s.tasks.open_watch("loop:app1"))
    assert store.get(lp.id).status == "held"
