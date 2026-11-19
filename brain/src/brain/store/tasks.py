"""The `tasks` table: the SQL of what the person asked for, one row per task.

No function opens its own transaction; callers wrap with `db.transaction` when they need one.
Text arrives already masked: this module only stores it.
"""

import sqlite3
from dataclasses import dataclass

_COLS = (
    "id, kind, state, title, source, caused_by, result, created_at, updated_at, ended_at,"
    " end_reason"
)
ENDED = ("done", "failed", "stopped", "declined")


@dataclass(frozen=True)
class TaskRow:
    id: str
    kind: str
    state: str
    title: str | None
    source: str
    caused_by: str | None
    result: str | None
    created_at: str
    updated_at: str
    ended_at: str | None
    end_reason: str | None


def insert(db: sqlite3.Connection, row: TaskRow) -> None:
    db.execute(
        f"INSERT INTO tasks({_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            row.id, row.kind, row.state, row.title, row.source, row.caused_by, row.result,
            row.created_at, row.updated_at, row.ended_at, row.end_reason,
        ),
    )  # fmt: skip


def get(db: sqlite3.Connection, id: str) -> TaskRow | None:
    r = db.execute(f"SELECT {_COLS} FROM tasks WHERE id=?", (id,)).fetchone()
    return None if r is None else TaskRow(*r)


def set_state(
    db: sqlite3.Connection,
    id: str,
    state: str,
    *,
    at: str,
    result: str | None = None,
    end_reason: str | None = None,
) -> bool:
    """False when the task is missing or already ended: the first end stands."""
    ended = at if state in ENDED else None
    cur = db.execute(
        "UPDATE tasks SET state=?, updated_at=?, ended_at=?, result=COALESCE(?, result),"
        " end_reason=COALESCE(?, end_reason) WHERE id=? AND state NOT IN ('done','failed',"
        "'stopped','declined')",
        (state, at, ended, result, end_reason, id),
    )
    return cur.rowcount == 1


def list_open(db: sqlite3.Connection, exclude_kind: str = "ask") -> list[TaskRow]:
    rows = db.execute(
        f"SELECT {_COLS} FROM tasks WHERE state IN ('open','waiting') AND kind<>?"
        " ORDER BY created_at DESC, rowid DESC",
        (exclude_kind,),
    ).fetchall()
    return [TaskRow(*r) for r in rows]


def list_all(db: sqlite3.Connection, include_ended: bool) -> list[TaskRow]:
    """Every non-Ask task, newest first; ended ones only when asked."""
    where = "" if include_ended else " AND state IN ('open','waiting')"
    rows = db.execute(
        f"SELECT {_COLS} FROM tasks WHERE kind<>'ask'{where} ORDER BY created_at DESC, rowid DESC"
    ).fetchall()
    return [TaskRow(*r) for r in rows]


def of_events(db: sqlite3.Connection, event_ids: list[str]) -> list[TaskRow]:
    """The non-Ask tasks these events belong to, oldest first, each once."""
    marks = ",".join("?" * len(event_ids))
    rows = db.execute(
        f"SELECT {_COLS} FROM tasks WHERE kind<>'ask' AND id IN"
        f" (SELECT task FROM events WHERE id IN ({marks})) ORDER BY created_at, rowid",
        event_ids,
    ).fetchall()
    return [TaskRow(*r) for r in rows]


def open_of_source(db: sqlite3.Connection, kind: str, source: str) -> str | None:
    """The id of the open or waiting task of this kind from this source, if there is one."""
    r = db.execute(
        "SELECT id FROM tasks WHERE kind=? AND source=? AND state IN ('open','waiting')"
        " ORDER BY created_at, rowid LIMIT 1",
        (kind, source),
    ).fetchone()
    return None if r is None else r[0]


def asks_to_settle(db: sqlite3.Connection) -> list[tuple[str, str]]:
    """Open Asks whose say is over: `done` when it was handled, `failed` when given up."""
    rows = db.execute(
        "SELECT t.id, CASE e.state WHEN 'handled' THEN 'done' ELSE 'failed' END FROM tasks t"
        " JOIN events e ON e.task=t.id AND e.kind='say'"
        " WHERE t.kind='ask' AND t.state='open' AND e.state IN ('handled','gave_up')"
        " ORDER BY t.created_at, t.rowid"
    ).fetchall()
    return [(r[0], r[1]) for r in rows]


def laters_to_settle(db: sqlite3.Connection) -> list[str]:
    """Open or waiting Laters with nothing left running or coming: no live work row, no event
    still `new` or `taken`."""
    rows = db.execute(
        "SELECT t.id FROM tasks t WHERE t.kind='later' AND t.state IN ('open','waiting')"
        " AND NOT EXISTS (SELECT 1 FROM work w WHERE w.task_id=t.id"
        "   AND w.state IN ('planned','active','blocked','paused'))"
        " AND NOT EXISTS (SELECT 1 FROM events e WHERE e.task=t.id AND e.state IN ('new','taken'))"
        " ORDER BY t.created_at, t.rowid"
    ).fetchall()
    return [r[0] for r in rows]


def owns_to_settle(db: sqlite3.Connection) -> list[str]:
    """Open or waiting Owns that had an item and have none open now and no event: an offer whose
    card lapsed. An offer's Own ends on its answer; an Own Scout started itself (`task_start`)
    never had an item and is left alone."""
    rows = db.execute(
        "SELECT t.id FROM tasks t WHERE t.kind='own' AND t.state IN ('open','waiting')"
        " AND NOT EXISTS (SELECT 1 FROM events e WHERE e.task=t.id)"
        " AND EXISTS (SELECT 1 FROM open_items i WHERE i.task_id=t.id)"
        " AND NOT EXISTS (SELECT 1 FROM open_items i WHERE i.task_id=t.id AND i.state='open')"
        " ORDER BY t.created_at, t.rowid"
    ).fetchall()
    return [r[0] for r in rows]


def last_event_at(db: sqlite3.Connection, task_id: str) -> str | None:
    return db.execute("SELECT MAX(at) FROM events WHERE task=?", (task_id,)).fetchone()[0]


def sweep(db: sqlite3.Connection, before: str) -> int:
    """Delete ended tasks that ended before `before`; open and waiting ones stay."""
    return db.execute(
        "DELETE FROM tasks WHERE state IN ('done','failed','stopped','declined') AND ended_at<?",
        (before,),
    ).rowcount


def event_source(db: sqlite3.Connection, event_id: str) -> str | None:
    r = db.execute("SELECT source FROM events WHERE id=?", (event_id,)).fetchone()
    return None if r is None else r[0]


def event_kind(db: sqlite3.Connection, event_id: str) -> str | None:
    r = db.execute("SELECT kind FROM events WHERE id=?", (event_id,)).fetchone()
    return None if r is None else r[0]


def timers_of(db: sqlite3.Connection, task_id: str) -> list[str]:
    """The timer rows of a task that have not run out: planned or paused."""
    rows = db.execute(
        "SELECT id FROM work WHERE task_id=? AND kind='timer'"
        " AND state IN ('planned','paused') ORDER BY created_at, rowid",
        (task_id,),
    ).fetchall()
    return [r[0] for r in rows]


def caused_by_tasks(db: sqlite3.Connection, task_id: str) -> list[str]:
    """The open or waiting tasks whose cause is an event of this task (its turn started them)."""
    rows = db.execute(
        "SELECT t.id FROM tasks t JOIN events e ON e.id=t.caused_by"
        " WHERE e.task=? AND t.id<>? AND t.state IN ('open','waiting')"
        " ORDER BY t.created_at, t.rowid",
        (task_id, task_id),
    ).fetchall()
    return [r[0] for r in rows]
