"""Migration 0040: a job's detail row gains `approved_at` and `rechecked_at`.

Runs on a file seeded at the version before it, so an old job still loads.
"""

import sqlite3

from brain.store.db import migrate

BEFORE = 39


def test_0040_adds_approved_and_rechecked(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    db.execute("INSERT INTO work_job(work_id, folder) VALUES ('g1', 'C:/p')")
    migrate(db)
    columns = [r[1] for r in db.execute("PRAGMA table_info(work_job)")]
    assert "approved_at" in columns and "rechecked_at" in columns
    assert db.execute("SELECT approved_at, rechecked_at FROM work_job").fetchall() == [(None, None)]
