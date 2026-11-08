"""Migration 0026: every saved message gains the body kind it was shown on.

Runs on a file seeded at the version before it, so old rows must read back as desktop.
"""

import sqlite3

from brain.store.db import migrate

BEFORE = 25


def test_old_messages_become_desktop_and_new_ones_default_to_it(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    db.execute(
        "INSERT INTO messages(at, role, content_json, text) VALUES ('t', 'user', '\"hi\"', 'hi')"
    )
    migrate(db)
    db.execute(
        "INSERT INTO messages(at, role, content_json, text) VALUES ('t', 'user', '\"yo\"', 'yo')"
    )
    assert db.execute("SELECT body FROM messages ORDER BY id").fetchall() == [
        ("desktop",),
        ("desktop",),
    ]
