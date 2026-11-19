"""Migration 0038: the tasks table, `events.task` and `work.task_id`; `work.source_message_id` goes.

Runs on a file seeded at the version before it, so old rows must still load.
"""

import sqlite3

from brain.store.db import migrate

BEFORE = 37


def test_0038_adds_tasks_and_task_columns_and_drops_source_message_id(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    migrate(db)
    work = [r[1] for r in db.execute("PRAGMA table_info(work)")]
    assert "task_id" in work and "source_message_id" not in work
    assert "task" in [r[1] for r in db.execute("PRAGMA table_info(events)")]
    assert db.execute("SELECT count(*) FROM tasks").fetchone() == (0,)
    assert "tasks_open" in [r[1] for r in db.execute("PRAGMA index_list(tasks)")]
