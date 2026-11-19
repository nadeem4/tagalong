"""Migration 0039: `open_items` drops `origin_body` and gains the task and check-back columns."""

import sqlite3

from brain.store.db import migrate

BEFORE = 38


def test_0039_has_task_and_check_back_and_no_origin_body(tmp_path):
    db = sqlite3.connect(tmp_path / "t.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    migrate(db)
    cols = [r[1] for r in db.execute("PRAGMA table_info(open_items)")]
    assert "origin_body" not in cols
    for wanted in ("task_id", "caused_by", "check_back_at", "check_back_by", "urgent", "window_s"):
        assert wanted in cols
    names = [r[1] for r in db.execute("PRAGMA index_list(open_items)")]
    assert "open_items_open" in names and "open_items_check" in names
