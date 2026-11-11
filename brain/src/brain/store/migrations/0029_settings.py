"""Migration 0029: a small key/value table for choices the person makes in Settings.

The first use is Scout's model. Uses only `db.execute`: the runner holds the transaction.
"""


def migrate(db) -> None:
    db.execute("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
