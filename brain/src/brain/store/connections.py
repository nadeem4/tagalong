"""Connected apps (MCP): the `apps` table, each app's mail switch and its read cursors.

A cursor is where a reader got to in one stream of an app (`mail`, `sent`, `backfill`).
"""

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


def reads_mail_apps(db: sqlite3.Connection) -> list[str]:
    return [r[0] for r in db.execute("SELECT id FROM apps WHERE reads_mail = 1 ORDER BY rowid")]


def set_reads_mail(db: sqlite3.Connection, app_id: str, on: bool) -> None:
    db.execute("UPDATE apps SET reads_mail=? WHERE id=?", (int(on), app_id))


def cursor(db: sqlite3.Connection, app_id: str, stream: str) -> str | None:
    row = db.execute(
        "SELECT value FROM app_cursors WHERE app_id=? AND stream=?", (app_id, stream)
    ).fetchone()
    return None if row is None else row[0]


def set_cursor(db: sqlite3.Connection, app_id: str, stream: str, value: str, at: str) -> None:
    db.execute(
        "INSERT INTO app_cursors(app_id, stream, value, updated_at) VALUES (?,?,?,?)"
        " ON CONFLICT(app_id, stream) DO UPDATE SET value=excluded.value,"
        " updated_at=excluded.updated_at",
        (app_id, stream, value, at),
    )


def clear_mail(db: sqlite3.Connection) -> None:
    """Every cursor gone and every mail switch off."""
    db.execute("DELETE FROM app_cursors")
    db.execute("UPDATE apps SET reads_mail = 0")
