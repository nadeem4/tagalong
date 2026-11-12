"""Migration 0032: `open_items` gains the kind `held`.

The dispatcher keeps news it cannot tell now (budget spent, quiet hours, too old, its delivery
gave up, the brain stopping) as an open item, so it shows on return or on Home instead of being
dropped. SQLite cannot change a CHECK, so the table is rebuilt with every row kept. Uses only
`db.execute`: the runner holds the transaction.
"""


def migrate(db) -> None:
    db.execute("ALTER TABLE open_items RENAME TO open_items_old")
    db.execute("DROP INDEX open_items_open")
    db.execute(
        "CREATE TABLE open_items("
        " id TEXT PRIMARY KEY,"
        " kind TEXT NOT NULL CHECK (kind IN"
        " ('ask','choice','install','signin','expert_ask','offer','setup','held')),"
        " origin_body TEXT NOT NULL,"
        " state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','done','expired')),"
        " saved_call_json TEXT,"
        " live_only INTEGER NOT NULL DEFAULT 0,"
        " job_id TEXT,"
        " created_at TEXT NOT NULL,"
        " deadline_at TEXT NOT NULL,"
        " closed_at TEXT,"
        " closed_by TEXT,"
        " answer TEXT,"
        " reason TEXT)"
    )
    db.execute("INSERT INTO open_items SELECT * FROM open_items_old")
    db.execute("DROP TABLE open_items_old")
    db.execute("CREATE INDEX open_items_open ON open_items(state, deadline_at)")
