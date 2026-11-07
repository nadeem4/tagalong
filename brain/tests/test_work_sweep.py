"""Sweeping finished work by age, and keeping stored outputs that work still points at.

Real temp database, hand-moved clock; no provider is involved.
"""

from datetime import UTC, datetime, timedelta

import pytest

from brain.bodies import Bodies
from brain.memory import Memory
from brain.sessions import Session
from brain.store.db import open_db
from brain.store.outputs import get_output, prune_outputs, put_output
from brain.store.work import ActivityEntry, WorkStore

START = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.at = START

    def __call__(self) -> datetime:
        return self.at

    def days(self, n: int) -> None:
        self.at += timedelta(days=n)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def db(tmp_path):
    return open_db(tmp_path / "t.db")


@pytest.fixture
def store(db, clock):
    return WorkStore(db, clock)


def _count(db, table):
    # Migrations seed one open watch (the mail digest); it is never swept and never counted.
    where = {"work": "id", "work_events": "work_id"}.get(table)
    clause = f" WHERE {where} != 'loop-digest'" if where else ""
    return db.execute(f"SELECT count(*) FROM {table}{clause}").fetchone()[0]


def _finished_job(store, db, output_id="out1"):
    """A done goal with a step, a call under it, its detail rows, steps and a stored output."""
    goal = store.create("goal", "fix it", id="g1")
    store.set_job_detail("g1", agent="claude", folder="C:/x", mode="work", task="fix")
    call = store.create("expert_call", "call", parent_id="g1", id="c1")
    store.save_activity("g1", ActivityEntry(1, 1, "2026-01-01T00:00:00+00:00", "step", "did it"))
    put_output(db, output_id, "report", "long text", "2026-01-01T00:00:00+00:00")
    store.set_text("c1", "short", output_id)
    store.transition(call.id, "active")
    store.transition(call.id, "done", reason="ok")
    store.close_goal(goal.id, "done", "all good")


def test_sweep_removes_whole_tree_and_outputs(store, db, clock):
    _finished_job(store, db)
    store.create("ask", "ok?", id="a1")
    store.add_ask("a1", tool="run")
    store.transition("a1", "cancelled", reason="refused")
    clock.days(31)
    assert store.sweep(30) == 2
    for table in ("work", "work_events", "job_steps", "work_job", "work_ask", "tool_outputs"):
        assert _count(db, table) == 0, table
    assert store.search("fix") == []


def test_sweep_spares_open_watch_and_repeating_timer(store, db, clock):
    store.create("watch", "watch it", id="w1", state="active")
    store.create("timer", "tick", id="t1", due_at=START + timedelta(days=60))
    store.set_repeat("t1", 3600)
    clock.days(90)
    assert store.sweep(30) == 0
    assert _count(db, "work") == 2


def test_sweep_spares_tree_with_open_child(store, db, clock):
    store.create("goal", "big", id="g1")
    store.create("expert_call", "still going", parent_id="g1", id="c1", state="active")
    # Force the root into an ended state while a child is open, the case the rule guards.
    db.execute("UPDATE work SET state='done', ended_at=? WHERE id='g1'", ("2026-01-01",))
    clock.days(90)
    assert store.sweep(30) == 0
    assert _count(db, "work") == 2


def test_sweep_respects_keep_days(store, db, clock):
    _finished_job(store, db)
    clock.days(29)
    assert store.sweep(30) == 0
    assert _count(db, "work") == 2
    clock.days(2)
    assert store.sweep(30) == 1
    assert _count(db, "work") == 0


def test_outputs_prune_spares_linked(store, db):
    # The newest-N count is over outputs no work row names; linked ones are never counted.
    for name in ("old", "kept", "n0", "n1", "newest"):
        put_output(db, name, "t", "x", "a")
    store.create("goal", "g1", id="g1")
    store.create("goal", "g2", id="g2")
    store.set_text("g1", "s", "old")
    store.set_text("g2", "s", "newest")
    prune_outputs(db, 2)
    assert get_output(db, "old") == "x"
    assert get_output(db, "newest") == "x"
    assert get_output(db, "kept") is None
    assert get_output(db, "n0") == "x" and get_output(db, "n1") == "x"


class _Open:
    def allows(self):
        return True

    def spend(self, usage, model):
        pass


async def test_session_sweeps_and_prunes_at_start(tmp_path, clock):
    mem = Memory(tmp_path / "s.db", now=clock)
    _finished_job(WorkStore(mem.db, clock), mem.db)
    clock.days(10)
    bodies = Bodies()
    bodies.notify = lambda m, p: None
    Session(object(), _Open(), bodies, 10, mem, now=clock, work_keep_days=5, outputs_keep=1)
    assert _count(mem.db, "work") == 0
    assert _count(mem.db, "tool_outputs") == 0
    mem.close()
