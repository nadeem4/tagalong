"""Permissions, preferences and offers become rows of one `rules` table.

Preferences go in first with their old ids, so the approval log's `preference_id` still lines
up. An offer's old outcome word stays in `effect` (the keep-asking window reads it) and maps to
a state. Uses only `db.execute`: the runner holds the transaction.
"""

_OFFER_STATE = (
    "CASE outcome WHEN 'yes' THEN 'active' WHEN 'no_answer' THEN 'offered' ELSE 'declined' END"
)


def migrate(db) -> None:
    db.execute(
        "CREATE TABLE rules(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, tool TEXT, source TEXT,"
        " group_key TEXT, effect TEXT, sentence TEXT, state TEXT NOT NULL, decided_at TEXT,"
        " expires_at TEXT, builtin INTEGER NOT NULL DEFAULT 0,"
        " use_count INTEGER NOT NULL DEFAULT 0, last_used TEXT, created_at TEXT NOT NULL,"
        " CHECK(kind <> 'mode' OR effect IN ('off','ask','auto')))"
    )
    db.execute("CREATE INDEX rules_kind_tool ON rules(kind, tool)")
    db.execute("CREATE INDEX rules_kind_group ON rules(kind, group_key)")
    db.execute(
        "INSERT INTO rules(id, kind, tool, source, group_key, sentence, state, builtin,"
        " use_count, last_used, created_at)"
        " SELECT id, 'sentence', tool, source, group_key, sentence, 'active', builtin,"
        " use_count, last_used, created_at FROM preferences ORDER BY id"
    )
    db.execute(
        "INSERT INTO rules(kind, tool, effect, state, created_at)"
        " SELECT 'mode', tool, mode, 'active', strftime('%Y-%m-%dT%H:%M:%S+00:00','now')"
        " FROM permissions ORDER BY rowid"
    )
    db.execute(
        "INSERT INTO rules(kind, group_key, effect, state, decided_at, created_at)"
        f" SELECT 'offer', group_key, outcome, {_OFFER_STATE}, at, at FROM offers ORDER BY id"
    )
    for old in ("permissions", "preferences", "offers"):
        db.execute(f"DROP TABLE {old}")
