"""Migration 0028: an installed app keeps whether it was Official or Community.

Home's list shows the tag again after install, so the choice made from the registry is stored
instead of guessed later. Existing apps are backfilled by the same rule the registry list uses,
applied to the saved name. Uses only `db.execute`: the runner holds the transaction.
"""

from brain.setup.trust import is_official_app


def migrate(db) -> None:
    db.execute(
        "ALTER TABLE apps ADD COLUMN trust TEXT NOT NULL DEFAULT 'community'"
        " CHECK(trust IN ('official','community'))"
    )
    for app_id, name in db.execute("SELECT id, name FROM apps").fetchall():
        if is_official_app(name):
            db.execute("UPDATE apps SET trust='official' WHERE id=?", (app_id,))
