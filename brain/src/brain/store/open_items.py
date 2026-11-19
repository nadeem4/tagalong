"""The `open_items` table: things waiting on the person, saved so a restart keeps them.

SQL only. The lifecycle, the deadline and the log are in `brain/open_items.py`. Times are the
stored text from `store.db.utc_text`, so they compare as text.
"""

import json
import sqlite3
from dataclasses import dataclass

_COLUMNS = (
    "id, kind, state, task_id, caused_by, saved_call_json, live_only, job_id, created_at,"
    " deadline_at, check_back_at, check_back_by, urgent, closed_at, closed_by, answer, reason,"
    " window_s"
)


@dataclass(frozen=True)
class StoredItem:
    id: str
    kind: str
    state: str
    task_id: str | None
    caused_by: str | None
    saved_call: dict | None
    live_only: bool
    job_id: str | None
    created_at: str
    deadline_at: str
    check_back_at: str | None
    check_back_by: str | None
    urgent: bool
    closed_at: str | None
    closed_by: str | None
    answer: str | None
    reason: str | None
    window_s: float


def _item(r: tuple) -> StoredItem:
    return StoredItem(
        *r[:5], json.loads(r[5]) if r[5] else None, bool(r[6]), *r[7:12], bool(r[12]), *r[13:]
    )


def insert(
    db: sqlite3.Connection,
    id: str,
    *,
    kind: str,
    task_id: str | None = None,
    caused_by: str | None = None,
    saved_call: dict | None,
    live_only: bool,
    job_id: str | None,
    created_at: str,
    deadline_at: str,
    window_s: float,
    check_back_at: str | None = None,
    check_back_by: str | None = None,
    urgent: bool = False,
) -> None:
    db.execute(
        "INSERT INTO open_items(id, kind, task_id, caused_by, saved_call_json, live_only, job_id,"
        " created_at, deadline_at, window_s, check_back_at, check_back_by, urgent)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            id,
            kind,
            task_id,
            caused_by,
            None if saved_call is None else json.dumps(saved_call),
            int(live_only),
            job_id,
            created_at,
            deadline_at,
            window_s,
            check_back_at,
            check_back_by,
            int(urgent),
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
    answer: str | None = None,
    only: str = "open",
) -> bool:
    """Move an item from state `only` to `state`; False when it was not in that state."""
    cur = db.execute(
        "UPDATE open_items SET state=?, closed_at=?, closed_by=?, answer=COALESCE(?, answer),"
        " reason=? WHERE id=? AND state=?",
        (state, at, by, answer, reason, id, only),
    )
    return cur.rowcount == 1


def set_check_back(
    db: sqlite3.Connection,
    id: str,
    at: str | None,
    by: str | None,
    deadline_at: str | None = None,
) -> None:
    """Set when to look at an open item again and who set it; the deadline moves only when given."""
    db.execute(
        "UPDATE open_items SET check_back_at=?, check_back_by=?,"
        " deadline_at=COALESCE(?, deadline_at) WHERE id=? AND state='open'",
        (at, by, deadline_at, id),
    )


def _select(db: sqlite3.Connection, where: str, args: tuple = ()) -> list[StoredItem]:
    sql = f"SELECT {_COLUMNS} FROM open_items WHERE {where} ORDER BY created_at, rowid"
    return [_item(r) for r in db.execute(sql, args)]


def list_open(db: sqlite3.Connection, kind: str | None = None) -> list[StoredItem]:
    if kind is None:
        return _select(db, "state='open'")
    return _select(db, "state='open' AND kind=?", (kind,))


def for_task(db: sqlite3.Connection, task_id: str) -> list[StoredItem]:
    return _select(db, "state='open' AND task_id=?", (task_id,))


def due_checks(db: sqlite3.Connection, now: str) -> list[StoredItem]:
    return _select(db, "state='open' AND check_back_at IS NOT NULL AND check_back_at<=?", (now,))


def due(db: sqlite3.Connection, now: str, kind: str | None = None) -> list[StoredItem]:
    if kind is None:
        return _select(db, "state='open' AND deadline_at<=?", (now,))
    return _select(db, "state='open' AND deadline_at<=? AND kind=?", (now, kind))


def answered(db: sqlite3.Connection, kind: str) -> list[StoredItem]:
    """Answered but not done: the answer came and the work may not have finished."""
    return _select(db, "state='answered' AND kind=?", (kind,))


def find_open(db: sqlite3.Connection, kind: str, match: dict) -> StoredItem | None:
    """The first open item of this kind whose saved call holds every key and value of `match`."""
    for item in _select(db, "state='open' AND kind=?", (kind,)):
        if item.saved_call is not None and match.items() <= item.saved_call.items():
            return item
    return None


def live_only_open(db: sqlite3.Connection, job_id: str | None = None) -> list[StoredItem]:
    if job_id is None:
        return _select(db, "state='open' AND live_only=1")
    return _select(db, "state='open' AND live_only=1 AND job_id=?", (job_id,))


def ids_for_job(db: sqlite3.Connection, job_id: str) -> list[str]:
    return [i.id for i in _select(db, "job_id=?", (job_id,))]


def expired_since(db: sqlite3.Connection, since: str) -> list[StoredItem]:
    return _select(db, "state='expired' AND closed_at>=?", (since,))
