"""store/events.py: the events table every input is saved to first (the in queue).

Pins what the runner relies on: a duplicate id is ignored, `not_before` holds an event back,
the taken guard moves only `new` rows, and `handled_at` is stamped only when an event ends.
"""

import sqlite3

import pytest

from brain.store import events
from brain.store.db import open_db
from brain.store.events import EventRow

T = "2026-01-01T10:00:00+00:00"
LATER = "2026-01-01T10:01:00+00:00"


@pytest.fixture
def db(tmp_path):
    return open_db(tmp_path / "t.db")


def row(id, *, kind="timer", source="timer", caused_by=None, payload=None, not_before=None):
    return EventRow(
        id=id, kind=kind, at=T, source=source, caused_by=caused_by,
        payload=payload or {}, not_before=not_before,
    )  # fmt: skip


def test_insert_then_get_round_trips_payload(db):
    events.insert(db, row("e1", payload={"text": "tea"}))
    got = events.get(db, "e1")
    assert got.payload == {"text": "tea"}
    assert got.state == "new"


def test_insert_same_id_twice_is_ignored(db):
    assert events.insert(db, row("e1")) is True
    assert events.insert(db, row("e1")) is False
    assert db.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1


def test_list_new_skips_taken_and_future_not_before(db):
    events.insert(db, row("e1"))
    events.insert(db, row("e2"))
    events.insert(db, row("e3", not_before=LATER))
    events.set_taken(db, ["e2"], "t1")
    assert [r.id for r in events.list_new(db, T)] == ["e1"]


def test_set_taken_moves_only_new_rows(db):
    events.insert(db, row("e1"))
    events.insert(db, row("e2"))
    events.set_state(db, ["e2"], "handled", end_reason=None, at=T)
    assert events.set_taken(db, ["e1", "e2"], "t1") == ["e1"]
    assert events.get(db, "e1").turn_id == "t1"


def test_chain_walks_caused_by(db):
    events.insert(db, row("e1"))
    events.insert(db, row("e2", caused_by="e1"))
    events.insert(db, row("e3", caused_by="e2"))
    assert [r.id for r in events.chain(db, "e3")] == ["e3", "e2", "e1"]


def test_state_check_refuses_unknown_state(db):
    events.insert(db, row("e1"))
    with pytest.raises(sqlite3.IntegrityError):
        events.set_state(db, ["e1"], "lost", end_reason=None, at=T)


def test_set_state_stamps_handled_at_only_when_ended(db):
    def handled_at(id):
        return db.execute("SELECT handled_at FROM events WHERE id=?", (id,)).fetchone()[0]

    for id in ("e1", "e2", "e3", "e4"):
        events.insert(db, row(id))
    events.set_state(db, ["e1"], "handled", end_reason=None, at=T)
    events.set_state(db, ["e2"], "gave_up", end_reason="x", at=T)
    events.set_state(db, ["e3"], "taken", end_reason=None, at=T)
    events.set_state(db, ["e4"], "new", end_reason=None, at=T)
    assert [handled_at(i) for i in ("e1", "e2", "e3", "e4")] == [T, T, None, None]


def test_insert_then_get_round_trips_task(db):
    events.insert(db, EventRow(id="e1", kind="say", at=T, source="desktop", task="t1"))
    assert events.get(db, "e1").task == "t1"
    events.insert(db, row("e2"))
    assert events.get(db, "e2").task is None
