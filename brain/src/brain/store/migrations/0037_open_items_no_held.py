"""Migration 0037: `open_items` loses the kinds `held` and `setup`.

News that waits is an `events` row now (state `new` or `gave_up`), so neither kind is written
any more. SQLite cannot change a CHECK, so the table is dropped and made again; no rows are
carried, as nothing needs the old ones. Uses only `db.execute`: the runner holds the transaction.
"""


def migrate(db) -> None:
    db.execute("DROP INDEX open_items_open")
    db.execute("DROP TABLE open_items")
    db.execute(
        "CREATE TABLE open_items("
        " id TEXT PRIMARY KEY,"
        " kind TEXT NOT NULL CHECK (kind IN"
        " ('ask','choice','install','signin','expert_ask','offer')),"
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
    db.execute("CREATE INDEX open_items_open ON open_items(state, deadline_at)")
