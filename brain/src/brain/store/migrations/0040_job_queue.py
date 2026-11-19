"""A job waiting for a slot keeps when it was approved and when Scout last asked about it.

`approved_at` orders the queue (oldest first) and `rechecked_at` restarts the one-hour clock after
the person says to carry on. Both stay null on every job that ran at once. Uses only
`db.execute`: the migrator holds the transaction.
"""


def migrate(db) -> None:
    db.execute("ALTER TABLE work_job ADD COLUMN approved_at TEXT NULL")
    db.execute("ALTER TABLE work_job ADD COLUMN rechecked_at TEXT NULL")
