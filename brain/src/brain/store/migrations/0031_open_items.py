"""Migration 0031: `open_items`, one record for everything waiting on the person.

A card, choice, install, sign-in, expert question, offer or setup step is one row with one
lifecycle (open to answered, done or expired). Uses only `db.execute`: the runner holds the
transaction.
"""


def migrate(db) -> None:
    db.execute(
        "CREATE TABLE open_items("
        " id TEXT PRIMARY KEY,"
        " kind TEXT NOT NULL CHECK (kind IN"
        " ('ask','choice','install','signin','expert_ask','offer','setup')),"
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
