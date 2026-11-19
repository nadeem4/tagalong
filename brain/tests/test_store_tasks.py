"""store/tasks.py: the tasks table and the two settle queries the Tasks service sweeps with.

Pins the ended-state guard, the CHECKs, and that an Ask follows its say event and a Later follows
its work rows and events.
"""

import sqlite3

import pytest

from brain.store import events, tasks
from brain.store.db import open_db
from brain.store.events import EventRow
from brain.store.tasks import TaskRow

T = "2026-01-01T10:00:00+00:00"
LATER = "2026-01-01T10:05:00+00:00"


@pytest.fixture
def db(tmp_path):
    return open_db(tmp_path / "t.db")


def task(id, *, kind="ask", state="open", at=T):
    return TaskRow(
        id=id, kind=kind, state=state, title=None, source="desktop", caused_by=None,
        result=None, created_at=at, updated_at=at, ended_at=None, end_reason=None,
    )  # fmt: skip


def event(id, task_id, state, kind="say"):
    return EventRow(id=id, kind=kind, at=T, source="desktop", state=state, task=task_id)


def test_insert_then_get_round_trips(db):
    tasks.insert(db, task("t1", kind="do"))
    assert tasks.get(db, "t1") == task("t1", kind="do")
    assert tasks.get(db, "nope") is None


def test_set_state_on_an_ended_task_returns_false(db):
    tasks.insert(db, task("t1"))
    assert tasks.set_state(db, "t1", "done", at=LATER, result="ok") is True
    assert tasks.set_state(db, "t1", "failed", at=LATER) is False
    got = tasks.get(db, "t1")
    assert (got.state, got.result, got.ended_at) == ("done", "ok", LATER)


def test_waiting_is_not_ended(db):
    tasks.insert(db, task("t1"))
    assert tasks.set_state(db, "t1", "waiting", at=LATER) is True
    assert tasks.get(db, "t1").ended_at is None
    assert tasks.set_state(db, "t1", "open", at=LATER) is True


def test_kind_and_state_checks_refuse_unknown_values(db):
    with pytest.raises(sqlite3.IntegrityError):
        tasks.insert(db, task("t1", kind="chat"))
    with pytest.raises(sqlite3.IntegrityError):
        tasks.insert(db, task("t2", state="paused"))


def test_list_open_is_newest_first_and_skips_ended_and_asks(db):
    tasks.insert(db, task("a", kind="do", at=T))
    tasks.insert(db, task("b", kind="later", state="waiting", at=LATER))
    tasks.insert(db, task("c", kind="do", state="done"))
    tasks.insert(db, task("d", kind="ask"))
    assert [r.id for r in tasks.list_open(db)] == ["b", "a"]


def test_asks_to_settle_follows_the_say_event_state(db):
    for id, state in (("1", "handled"), ("2", "gave_up"), ("3", "taken")):
        tasks.insert(db, task(f"t{id}"))
        events.insert(db, event(f"e{id}", f"t{id}", state))
    assert tasks.asks_to_settle(db) == [("t1", "done"), ("t2", "failed")]


def test_laters_to_settle_skips_a_later_with_a_planned_timer_or_new_event(db):
    for id in ("quiet", "timer", "news"):
        tasks.insert(db, task(id, kind="later"))
    db.execute(
        "INSERT INTO work(id, root_id, seq, kind, state, title, created_at, updated_at, task_id)"
        " VALUES ('w1','w1',1,'timer','planned','t',?,?,'timer')",
        (T, T),
    )
    events.insert(db, event("e1", "news", "new", kind="timer"))
    assert tasks.laters_to_settle(db) == ["quiet"]


def test_last_event_at(db):
    tasks.insert(db, task("t1"))
    assert tasks.last_event_at(db, "t1") is None
    events.insert(db, event("e1", "t1", "handled"))
    assert tasks.last_event_at(db, "t1") == T


def test_sweep_removes_old_ended_tasks_only(db):
    tasks.insert(db, task("old_done"))
    tasks.set_state(db, "old_done", "done", at=T)
    tasks.insert(db, task("old_open"))
    tasks.insert(db, task("new_done"))
    tasks.set_state(db, "new_done", "done", at=LATER)
    assert tasks.sweep(db, "2026-01-01T10:03:00+00:00") == 1
    assert tasks.get(db, "old_done") is None
    assert tasks.get(db, "old_open") is not None
    assert tasks.get(db, "new_done") is not None
