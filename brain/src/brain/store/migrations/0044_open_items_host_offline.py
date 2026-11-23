"""Migration 0044: `open_items` accepts the kind `host_offline`, a job waiting for its machine.

SQLite cannot change a CHECK, so the table is made again and its rows carried over. Uses only
`db.execute`: the runner holds the transaction.
"""


def migrate(db) -> None:
    db.execute("DROP INDEX open_items_open")
    db.execute("DROP INDEX open_items_check")
    db.execute("ALTER TABLE open_items RENAME TO open_items_old")
    db.execute(
        "CREATE TABLE open_items("
        " id TEXT PRIMARY KEY,"
        " kind TEXT NOT NULL CHECK (kind IN"
        " ('ask','choice','install','signin','expert_ask','offer','host_offline')),"
        " state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','done','expired')),"
        " task_id TEXT NULL,"
        " caused_by TEXT NULL,"
        " saved_call_json TEXT,"
        " live_only INTEGER NOT NULL DEFAULT 0,"
        " job_id TEXT,"
        " created_at TEXT NOT NULL,"
        " deadline_at TEXT NOT NULL,"
        " window_s REAL NOT NULL,"
        " check_back_at TEXT NULL,"
        " check_back_by TEXT NULL CHECK (check_back_by IN ('scout','person')),"
        " urgent INTEGER NOT NULL DEFAULT 0,"
        " closed_at TEXT,"
        " closed_by TEXT,"
        " answer TEXT,"
        " reason TEXT)"
    )
    db.execute("INSERT INTO open_items SELECT * FROM open_items_old")
    db.execute("DROP TABLE open_items_old")
    db.execute("CREATE INDEX open_items_open ON open_items(state, deadline_at)")
    db.execute("CREATE INDEX open_items_check ON open_items(state, check_back_at)")
