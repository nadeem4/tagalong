"""Connected apps (MCP): the `apps` table."""

import json
import sqlite3

from brain.apps import AppRow


def list_apps(db: sqlite3.Connection) -> list[AppRow]:
    rows = db.execute("SELECT id, name, transport, config, auth, enabled FROM apps ORDER BY rowid")
    return [AppRow(i, n, t, json.loads(c), a, bool(e)) for i, n, t, c, a, e in rows]


def add_app(db: sqlite3.Connection, row: AppRow) -> None:
    db.execute(
        "INSERT INTO apps(id, name, transport, config, auth, enabled) VALUES (?,?,?,?,?,?)",
        (row.id, row.name, row.transport, json.dumps(row.config), row.auth, int(row.enabled)),
    )


def set_app_enabled(db: sqlite3.Connection, app_id: str, on: bool) -> None:
    db.execute("UPDATE apps SET enabled=? WHERE id=?", (int(on), app_id))


def remove_app(db: sqlite3.Connection, app_id: str) -> None:
    db.execute("DELETE FROM apps WHERE id=?", (app_id,))
