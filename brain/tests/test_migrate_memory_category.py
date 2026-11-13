"""Migration 0034: memories gain a nullable category; old rows stay undated and core.

Runs on a real temp database.
"""

import sqlite3

from brain.store.db import migrate


def test_adds_nullable_category_and_old_rows_stay_undated(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=33)
    at = "2026-01-02T03:04:05+00:00"
    db.execute(
        "INSERT INTO memories(kind, text, created_at, updated_at) VALUES ('about_you','x',?,?)",
        (at, at),
    )
    migrate(db)
    row = db.execute("SELECT category, span_start, layer FROM memories").fetchone()
    assert row == (None, None, "core")
    db.close()
