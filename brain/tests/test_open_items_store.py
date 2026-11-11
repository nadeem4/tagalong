"""The open_items table through store/open_items.py: rows, survive a reopen, state moves.

SQL only: the lifecycle rules (deadline, logging) are tested in test_open_items.py.
"""

from brain.store import open_items as store
from brain.store.db import open_db


def _put(db, id="i1", **kw):
    row = {
        "kind": "ask",
        "origin_body": "desktop",
        "saved_call": {"tool": "x"},
        "live_only": False,
        "job_id": None,
        "created_at": "2026-11-11T09:00:00+00:00",
        "deadline_at": "2026-11-12T09:00:00+00:00",
    }
    row.update(kw)
    store.insert(db, id, **row)


def test_insert_get_roundtrip_and_survives_reopen(tmp_path):
    db = open_db(tmp_path / "t.db")
    _put(db, job_id="j1")
    db.close()
    item = store.get(open_db(tmp_path / "t.db"), "i1")
    assert (item.kind, item.state, item.origin_body, item.job_id) == (
        "ask",
        "open",
        "desktop",
        "j1",
    )
    assert item.saved_call == {"tool": "x"} and item.live_only is False
    assert item.closed_at is None and item.closed_by is None


def test_close_only_moves_an_open_item(tmp_path):
    db = open_db(tmp_path / "t.db")
    _put(db)
    assert store.close(db, "i1", "answered", "2026-11-11T10:00:00+00:00", "desktop", "yes")
    assert not store.close(db, "i1", "expired", "2026-11-11T11:00:00+00:00", "brain", "late")
    item = store.get(db, "i1")
    assert (item.state, item.closed_by, item.reason) == ("answered", "desktop", "yes")


def test_queries_for_open_due_and_live_only(tmp_path):
    db = open_db(tmp_path / "t.db")
    _put(db, "a", origin_body="desktop", created_at="2026-11-11T09:00:01+00:00")
    _put(db, "b", origin_body="whatsapp", deadline_at="2026-11-11T09:30:00+00:00", live_only=True)
    assert [i.id for i in store.list_open(db)] == ["b", "a"]
    assert [i.id for i in store.list_open(db, "desktop")] == ["a"]
    assert [i.id for i in store.due(db, "2026-11-11T09:30:00+00:00")] == ["b"]
    assert [i.id for i in store.live_only_open(db)] == ["b"]
