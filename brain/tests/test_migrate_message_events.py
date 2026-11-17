"""Migration 0036: saved messages gain `event_id` and `source`; `work.reported_at` is gone.

Runs on a file seeded at the version before it, so an old row must still load.
"""

import sqlite3

from brain.store.db import migrate

BEFORE = 35


def _old(tmp_path) -> sqlite3.Connection:
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    return db


def test_messages_gain_event_id_and_source(tmp_path):
    db = _old(tmp_path)
    db.execute(
        "INSERT INTO messages(at, role, content_json, text) VALUES ('t', 'user', '\"hi\"', 'hi')"
    )
    migrate(db)
    assert db.execute("SELECT event_id, source FROM messages").fetchall() == [(None, None)]


def test_work_has_no_reported_at(tmp_path):
    db = _old(tmp_path)
    migrate(db)
    columns = [r[1] for r in db.execute("PRAGMA table_info(work)")]
    assert "reported_at" not in columns
    indexes = [r[1] for r in db.execute("PRAGMA index_list(work)")]
    assert "work_unreported" not in indexes
