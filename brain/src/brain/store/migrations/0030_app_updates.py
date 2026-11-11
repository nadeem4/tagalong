"""Migration 0030: an app keeps the version it was installed at and its auto-update choice.

`version` is backfilled from the package argument the installer pinned in the stored command (an
app added by hand, or a remote one, has none and stays empty). `auto_update` is NULL until the
person chooses: NULL means "by trust" (on for Official, off for Community). Uses only
`db.execute`: the runner holds the transaction.
"""

import json

from brain.store.connections import pinned_version


def migrate(db) -> None:
    db.execute("ALTER TABLE apps ADD COLUMN version TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE apps ADD COLUMN auto_update INTEGER")
    for app_id, config in db.execute("SELECT id, config FROM apps").fetchall():
        version = pinned_version(json.loads(config).get("args", []))
        if version:
            db.execute("UPDATE apps SET version=? WHERE id=?", (version, app_id))
