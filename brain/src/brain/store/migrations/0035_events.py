"""The events table: every input is saved here first, the one durable in queue.

New table, no old rows to move. `events_pick` serves the runner's "what is ready" read.
Uses only `db.execute`: the runner holds the transaction.
"""


def migrate(db) -> None:
    db.execute(
        "CREATE TABLE events ("
        "id TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL, source TEXT NOT NULL, "
        "caused_by TEXT NULL, payload_json TEXT NOT NULL, "
        "state TEXT NOT NULL DEFAULT 'new' "
        "CHECK (state IN ('new','taken','handled','gave_up')), "
        "attempts INTEGER NOT NULL DEFAULT 0, not_before TEXT NULL, turn_id TEXT NULL, "
        "end_reason TEXT NULL, resume INTEGER NOT NULL DEFAULT 0, handled_at TEXT NULL)"
    )
    db.execute("CREATE INDEX events_pick ON events(state, not_before, at)")
