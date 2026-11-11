"""Migration 0030: an app keeps the version it was installed at.

`version` is backfilled from the package argument the installer pinned in the stored command (an
app added by hand, or a remote one, has none and stays empty). Uses only `db.execute`: the
runner holds the transaction.
"""

import json

from brain.store.connections import pinned_version


def migrate(db) -> None:
    db.execute("ALTER TABLE apps ADD COLUMN version TEXT NOT NULL DEFAULT ''")
    for app_id, config in db.execute("SELECT id, config FROM apps").fetchall():
        version = pinned_version(json.loads(config).get("args", []))
        if version:
            db.execute("UPDATE apps SET version=? WHERE id=?", (version, app_id))
