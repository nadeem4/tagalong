"""Memories gain provenance (tag, source, evidence) and a visibility, for "get to know me".

Old rows read as chat facts that are free to use. `memory_dismissed` remembers the facts the
person forgot, per source, so a later run does not bring them back.
Uses only `db.execute`: the runner holds the transaction.
"""


def migrate(db) -> None:
    for column in (
        "tag TEXT NOT NULL DEFAULT ''",
        "source TEXT NOT NULL DEFAULT 'chat'",
        "source_ref TEXT",
        "evidence TEXT",
        "visibility TEXT NOT NULL DEFAULT 'free'",
    ):
        db.execute(f"ALTER TABLE memories ADD COLUMN {column}")
    db.execute(
        "CREATE TABLE memory_dismissed("
        "source TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(source, evidence))"
    )
