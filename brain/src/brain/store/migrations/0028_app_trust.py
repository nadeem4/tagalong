"""Migration 0028: an installed app keeps whether it was Official or Community.

Home's list shows the tag again after install, so the choice made from the registry is stored
instead of guessed later. No backfill: an older row holds only the registry title and a URL or
command, nothing that proves it Official without a registry lookup, so it reads Community until
the app is added again. Uses only `db.execute`: the runner holds the transaction.
"""


def migrate(db) -> None:
    db.execute(
        "ALTER TABLE apps ADD COLUMN trust TEXT NOT NULL DEFAULT 'community'"
        " CHECK(trust IN ('official','community'))"
    )
