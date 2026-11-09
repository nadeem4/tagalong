"""Migration 0027: saved messages gain a `cut` flag; old rows are not cut.

Runs on a file seeded at the version before it, so an old request must still load.
"""

import sqlite3

from brain.store.db import migrate

BEFORE = 26


def test_old_messages_are_not_cut(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    db.execute(
        "INSERT INTO messages(at, role, content_json, text) VALUES ('t', 'user', '\"hi\"', 'hi')"
    )
    migrate(db)
    assert db.execute("SELECT cut FROM messages").fetchall() == [(0,)]
