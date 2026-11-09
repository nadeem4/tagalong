"""A saved message can be marked cut: a request cancelled before any word of a reply.

Such a request is kept in the chat but skipped when history is rebuilt, so a restart does not
send it to the model again beside the next request. Uses only `db.execute`: the runner holds
the transaction.
"""


def migrate(db) -> None:
    db.execute("ALTER TABLE messages ADD COLUMN cut INTEGER NOT NULL DEFAULT 0")
