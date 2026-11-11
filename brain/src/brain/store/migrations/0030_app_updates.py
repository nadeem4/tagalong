"""Migration 0030: an app keeps the version it was installed at.

`version` is backfilled from the package argument the installer pinned in the stored command (an
app added by hand, or a remote one, has none and stays empty). Uses only `db.execute`: the
runner holds the transaction. The version rule is
copied in here, so this migration never changes when live code does.
"""

import json


def pinned_version(args: list[str]) -> str:
    """The version pinned in a package command's last argument (`pkg@1.2.0`, `@scope/pkg@1.2.0`,
    `pkg==1.2.0`), or empty when the package is bare."""
    spec = args[-1] if args else ""
    name, sep, version = spec.partition("==")
    if not sep:
        name, sep, version = spec.rpartition("@")
    return version if sep and name and version else ""


def migrate(db) -> None:
    db.execute("ALTER TABLE apps ADD COLUMN version TEXT NOT NULL DEFAULT ''")
    for app_id, config in db.execute("SELECT id, config FROM apps").fetchall():
        version = pinned_version(json.loads(config).get("args", []))
        if version:
            db.execute("UPDATE apps SET version=? WHERE id=?", (version, app_id))
