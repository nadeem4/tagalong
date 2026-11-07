"""Memories gain a layer, a time span and links back to what they were made from.

Every old row is core (what Scout knows about the person) except compaction summaries, which
are episodic entries for the day they were written. `kind` stays, so Home's list is unchanged.
Uses only `db.execute`: the runner holds the transaction.
"""


def migrate(db) -> None:
    for column in (
        "layer TEXT NOT NULL DEFAULT 'core'",
        "period TEXT",
        "span_start TEXT",
        "span_end TEXT",
        "source_msg_from INTEGER",
        "source_msg_to INTEGER",
        "source_work_id TEXT",
    ):
        db.execute(f"ALTER TABLE memories ADD COLUMN {column}")
    db.execute(
        "UPDATE memories SET layer = 'episodic', period = 'day', span_start = created_at,"
        " span_end = created_at WHERE kind = 'summary'"
    )
