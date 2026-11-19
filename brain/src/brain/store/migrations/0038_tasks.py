"""The `tasks` table; events and work rows name their task; `work.source_message_id` goes.

A task is the person-level thing that events and work hang off. `source_message_id` was never
written, so it is dropped rather than replaced. Uses only `db.execute`: the runner holds the
transaction.
"""


def migrate(db) -> None:
    db.execute(
        """CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('ask','do','later','watch','own')),
            state TEXT NOT NULL DEFAULT 'open'
                CHECK (state IN ('open','waiting','done','failed','stopped','declined')),
            title TEXT NULL,
            source TEXT NOT NULL,
            caused_by TEXT NULL,
            result TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            ended_at TEXT NULL,
            end_reason TEXT NULL
        )"""
    )
    db.execute("CREATE INDEX tasks_open ON tasks(state, created_at)")
    db.execute("ALTER TABLE events ADD COLUMN task TEXT NULL")
    db.execute("ALTER TABLE work ADD COLUMN task_id TEXT NULL")
    db.execute("ALTER TABLE work DROP COLUMN source_message_id")
