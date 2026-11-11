"""The `open_items` table: things waiting on the person, saved so a restart keeps them.

SQL only. The lifecycle, the deadline and the log are in `brain/open_items.py`. Times are the
stored text from `store.db.utc_text`, so they compare as text.
"""

import json
import sqlite3
from dataclasses import dataclass

_COLUMNS = (
    "id, kind, origin_body, state, saved_call_json, live_only, job_id, created_at, deadline_at,"
    " closed_at, closed_by, reason"
)


@dataclass(frozen=True)
class StoredItem:
    id: str
    kind: str
    origin_body: str
    state: str
    saved_call: dict | None
    live_only: bool
    job_id: str | None
    created_at: str
    deadline_at: str
    closed_at: str | None
    closed_by: str | None
    reason: str | None


def _item(r: tuple) -> StoredItem:
    return StoredItem(
        r[0], r[1], r[2], r[3], json.loads(r[4]) if r[4] else None, bool(r[5]), *r[6:]
    )


def insert(
    db: sqlite3.Connection,
    id: str,
    *,
    kind: str,
    origin_body: str,
    saved_call: dict | None,
    live_only: bool,
    job_id: str | None,
    created_at: str,
    deadline_at: str,
) -> None:
    db.execute(
        "INSERT INTO open_items(id, kind, origin_body, saved_call_json, live_only, job_id,"
        " created_at, deadline_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            id,
            kind,
            origin_body,
            None if saved_call is None else json.dumps(saved_call),
            int(live_only),
            job_id,
            created_at,
            deadline_at,
        ),
    )


def get(db: sqlite3.Connection, id: str) -> StoredItem | None:
    r = db.execute(f"SELECT {_COLUMNS} FROM open_items WHERE id=?", (id,)).fetchone()
    return None if r is None else _item(r)


def close(
    db: sqlite3.Connection,
    id: str,
    state: str,
    at: str,
    by: str,
    reason: str,
    *,
    only: str = "open",
) -> bool:
    """Move an item from state `only` to `state`; False when it was not in that state."""
    cur = db.execute(
        "UPDATE open_items SET state=?, closed_at=?, closed_by=?, reason=? WHERE id=? AND state=?",
        (state, at, by, reason, id, only),
    )
    return cur.rowcount == 1


def _select(db: sqlite3.Connection, where: str, args: tuple = ()) -> list[StoredItem]:
    sql = f"SELECT {_COLUMNS} FROM open_items WHERE {where} ORDER BY created_at, rowid"
    return [_item(r) for r in db.execute(sql, args)]


def list_open(db: sqlite3.Connection, origin_body: str | None = None) -> list[StoredItem]:
    if origin_body is None:
        return _select(db, "state='open'")
    return _select(db, "state='open' AND origin_body=?", (origin_body,))


def due(db: sqlite3.Connection, now: str) -> list[StoredItem]:
    return _select(db, "state='open' AND deadline_at<=?", (now,))


def live_only_open(db: sqlite3.Connection) -> list[StoredItem]:
    return _select(db, "state='open' AND live_only=1")
