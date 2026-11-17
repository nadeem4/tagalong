"""Saved messages name the event a user row came from and its source; `work.reported_at` goes.

Each taken event is saved as its own user row, so a result can be walked back to its say. Old
rows keep nulls. `reported_at` lost its readers when news moved to the events table; its index
goes first because SQLite will not drop an indexed column. Uses only `db.execute`: the runner
holds the transaction.
"""


def migrate(db) -> None:
    db.execute("ALTER TABLE messages ADD COLUMN event_id TEXT NULL")
    db.execute("ALTER TABLE messages ADD COLUMN source TEXT NULL")
    db.execute("DROP INDEX work_unreported")
    db.execute("ALTER TABLE work DROP COLUMN reported_at")
