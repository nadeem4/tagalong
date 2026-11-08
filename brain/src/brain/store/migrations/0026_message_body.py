"""Each saved message records the kind of body its turn was shown on.

Old rows were all written for the desktop, so the default fills them. Uses only `db.execute`:
the runner holds the transaction.
"""


def migrate(db) -> None:
    db.execute("ALTER TABLE messages ADD COLUMN body TEXT NOT NULL DEFAULT 'desktop'")
