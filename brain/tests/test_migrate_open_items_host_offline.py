"""Migration 0044: `open_items` takes the kind `host_offline` and keeps the rows it had."""

import sqlite3

from brain.store.db import migrate


def test_an_open_item_written_at_43_survives_with_its_fields(tmp_path):
    db = sqlite3.connect(tmp_path / "t.db", isolation_level=None)
    migrate(db, upto=43)
    db.execute(
        "INSERT INTO open_items(id, kind, task_id, saved_call_json, urgent, created_at,"
        " deadline_at, window_s) VALUES ('a', 'ask', 't1', '{\"name\": \"x\"}', 1, 'c', 'd', 60)"
    )
    before = db.execute("SELECT * FROM open_items").fetchall()
    migrate(db, upto=44)
    assert db.execute("SELECT * FROM open_items").fetchall() == before
    db.execute(
        "INSERT INTO open_items(id, kind, created_at, deadline_at, window_s)"
        " VALUES ('b', 'host_offline', 'c', 'd', 60)"
    )
