"""Migration 0039: `open_items` drops `origin_body` and gains a task and a check-back.

A card belongs to a task, not to a body, so the body column goes; `check_back_at` and
`check_back_by` say when to look at it again and who set that. SQLite cannot drop a CHECKed
column cleanly, so the table is made again; no rows are carried. Uses only `db.execute`: the
runner holds the transaction.
"""


def migrate(db) -> None:
    db.execute("DROP INDEX open_items_open")
    db.execute("DROP TABLE open_items")
    db.execute(
        "CREATE TABLE open_items("
        " id TEXT PRIMARY KEY,"
        " kind TEXT NOT NULL CHECK (kind IN"
        " ('ask','choice','install','signin','expert_ask','offer')),"
        " state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','done','expired')),"
        " task_id TEXT NULL,"
        " caused_by TEXT NULL,"
        " saved_call_json TEXT,"
        " live_only INTEGER NOT NULL DEFAULT 0,"
        " job_id TEXT,"
        " created_at TEXT NOT NULL,"
        " deadline_at TEXT NOT NULL,"
        " check_back_at TEXT NULL,"
        " check_back_by TEXT NULL CHECK (check_back_by IN ('scout','person')),"
        " urgent INTEGER NOT NULL DEFAULT 0,"
        " closed_at TEXT,"
        " closed_by TEXT,"
        " answer TEXT,"
        " reason TEXT)"
    )
    db.execute("CREATE INDEX open_items_open ON open_items(state, deadline_at)")
    db.execute("CREATE INDEX open_items_check ON open_items(state, check_back_at)")
