"""Memories gain a category: the open grouping the model picks for a fact.

Nullable, no backfill: old facts stay uncategorised and undated until their source runs again.
Dates use the span columns from 0025. Uses only `db.execute`: the runner holds the transaction.
"""


def migrate(db) -> None:
    db.execute("ALTER TABLE memories ADD COLUMN category TEXT")
