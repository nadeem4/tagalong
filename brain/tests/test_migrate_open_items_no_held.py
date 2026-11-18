"""Migration 0037: `open_items` loses the kinds `held` and `setup`; no rows are carried."""

import sqlite3

import pytest

from brain.store.db import migrate

BEFORE = 36


def _insert(db, kind):
    db.execute(
        "INSERT INTO open_items(id, kind, origin_body, created_at, deadline_at)"
        f" VALUES ('a', '{kind}', 'desktop', 't', 't')"
    )


def test_a_held_row_is_refused_after_0037(tmp_path):
    db = sqlite3.connect(tmp_path / "t.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    _insert(db, "held")  # still allowed before
    migrate(db)
    for kind in ("held", "setup"):
        with pytest.raises(sqlite3.IntegrityError):
            _insert(db, kind)
    _insert(db, "ask")
    assert db.execute("SELECT kind FROM open_items").fetchall() == [("ask",)]
    assert db.execute("SELECT name FROM sqlite_master WHERE name='open_items_open'").fetchone()
