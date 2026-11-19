"""The `events` table: the SQL of the durable in queue every input is saved to first.

No function opens its own transaction; callers wrap with `db.transaction` when they need one.
The payload arrives already masked: this module only stores it.
"""

import json
import sqlite3
from dataclasses import dataclass, field

_COLS = (
    "id, kind, at, source, caused_by, payload_json, state, attempts, not_before, "
    "turn_id, end_reason, resume, task"
)


@dataclass(frozen=True)
class EventRow:
    id: str
    kind: str
    at: str
    source: str
    caused_by: str | None = None
    payload: dict = field(default_factory=dict)
    state: str = "new"
    attempts: int = 0
    not_before: str | None = None
    turn_id: str | None = None
    end_reason: str | None = None
    resume: bool = False
    task: str | None = None


def _row(r: tuple) -> EventRow:
    return EventRow(
        id=r[0], kind=r[1], at=r[2], source=r[3], caused_by=r[4], payload=json.loads(r[5]),
        state=r[6], attempts=r[7], not_before=r[8], turn_id=r[9], end_reason=r[10],
        resume=bool(r[11]), task=r[12],
    )  # fmt: skip


def insert(db: sqlite3.Connection, row: EventRow) -> bool:
    """False when the id exists: a retried say is one event, never two."""
    cur = db.execute(
        f"INSERT OR IGNORE INTO events({_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            row.id, row.kind, row.at, row.source, row.caused_by, json.dumps(row.payload),
            row.state, row.attempts, row.not_before, row.turn_id, row.end_reason,
            int(row.resume), row.task,
        ),
    )  # fmt: skip
    return cur.rowcount == 1


def get(db: sqlite3.Connection, id: str) -> EventRow | None:
    r = db.execute(f"SELECT {_COLS} FROM events WHERE id=?", (id,)).fetchone()
    return None if r is None else _row(r)


def list_new(db: sqlite3.Connection, now: str) -> list[EventRow]:
    rows = db.execute(
        f"SELECT {_COLS} FROM events WHERE state='new' AND (not_before IS NULL OR not_before<=?) "
        "ORDER BY at, rowid",
        (now,),
    ).fetchall()
    return [_row(r) for r in rows]


def new_ids(db: sqlite3.Connection, kind: str, source: str) -> list[str]:
    return [
        r[0]
        for r in db.execute(
            "SELECT id FROM events WHERE state='new' AND kind=? AND source=?", (kind, source)
        )
    ]


def set_taken(db: sqlite3.Connection, ids: list[str], turn_id: str) -> list[str]:
    """Move only rows still `new`, so two takers never share an event; returns what moved."""
    moved = []
    for id in ids:
        cur = db.execute(
            "UPDATE events SET state='taken', turn_id=? WHERE id=? AND state='new'", (turn_id, id)
        )
        if cur.rowcount:
            moved.append(id)
    return moved


def set_payload(db: sqlite3.Connection, id: str, payload: dict) -> None:
    db.execute("UPDATE events SET payload_json=? WHERE id=?", (json.dumps(payload), id))


def set_state(
    db: sqlite3.Connection, ids: list[str], state: str, *, end_reason: str | None, at: str
) -> None:
    done = at if state in ("handled", "gave_up") else None
    for id in ids:
        # Back to `new` frees it from its turn, so the next taker's turn id is the only one.
        db.execute(
            "UPDATE events SET state=?, end_reason=?, handled_at=?,"
            " turn_id=CASE WHEN ?='new' THEN NULL ELSE turn_id END WHERE id=?",
            (state, end_reason, done, state, id),
        )


def set_backoff(
    db: sqlite3.Connection, ids: list[str], not_before: str, reason: str, *, resume: bool = True
) -> None:
    """A failed attempt: back to `new`, one more attempt, waiting until `not_before`. Only a
    row still `taken` moves, so one that ended meanwhile (cancelled by id) stays ended.
    `resume=False` keeps the flag as it was: a turn that never started sent nothing."""
    for id in ids:
        db.execute(
            "UPDATE events SET state='new', attempts=attempts+1, not_before=?, end_reason=?,"
            " resume=CASE WHEN ? THEN 1 ELSE resume END, turn_id=NULL"
            " WHERE id=? AND state='taken'",
            (not_before, reason, int(resume), id),
        )


def set_gave_up(db: sqlite3.Connection, ids: list[str], reason: str, at: str) -> list[str]:
    """The last failure: the row stays for Home and is told once later. Returns what moved."""
    moved = []
    for id in ids:
        cur = db.execute(
            "UPDATE events SET state='gave_up', end_reason=?, handled_at=?"
            " WHERE id=? AND state='taken'",
            (reason, at, id),
        )
        if cur.rowcount:
            moved.append(id)
    return moved


def list_state(db: sqlite3.Connection, state: str) -> list[EventRow]:
    rows = db.execute(
        f"SELECT {_COLS} FROM events WHERE state=? ORDER BY at, rowid", (state,)
    ).fetchall()
    return [_row(r) for r in rows]


def list_waiting(db: sqlite3.Connection, news_kinds: list[str]) -> list[EventRow]:
    """What Home shows as waiting: news still `new`, and anything given up, a say included, so
    the person sees words Scout could not answer."""
    marks = ",".join("?" * len(news_kinds))
    rows = db.execute(
        f"SELECT {_COLS} FROM events WHERE (state='new' AND kind IN ({marks}))"
        " OR state='gave_up' ORDER BY at, rowid",
        news_kinds,
    ).fetchall()
    return [_row(r) for r in rows]


def next_not_before(db: sqlite3.Connection, now: str) -> str | None:
    """When the soonest backing-off event may be taken again; None when none waits."""
    return db.execute(
        "SELECT MIN(not_before) FROM events WHERE state='new' AND not_before>?", (now,)
    ).fetchone()[0]


def recover_taken(db: sqlite3.Connection, at: str) -> list[str]:
    """At start, what a dead brain left held: an orphan card answer (saved, never finished)
    ends handled, since code answers it and it never starts a turn; an event an interjection
    held goes back to `new`, since an interjection is not an attempt. Returns the ids still
    `taken`, which a crashed turn held."""
    db.execute(
        "UPDATE events SET state='handled', end_reason='restart', handled_at=?, turn_id=NULL"
        " WHERE kind='card_answer' AND state IN ('new','taken')",
        (at,),
    )
    db.execute(
        "UPDATE events SET state='new', turn_id=NULL"
        " WHERE state='taken' AND turn_id LIKE 'interjection:%'"
    )
    return [r[0] for r in db.execute("SELECT id FROM events WHERE state='taken' ORDER BY rowid")]


def set_resume(db: sqlite3.Connection, ids: list[str]) -> None:
    """Mark waiting rows as sent before, those with a saved chat row only (the rest never
    reached the history, so they are told in full again). A stop left no reason: `stop`."""
    for id in ids:
        db.execute(
            "UPDATE events SET resume=1, end_reason=COALESCE(end_reason, 'stop')"
            " WHERE id=? AND state='new'"
            " AND EXISTS (SELECT 1 FROM messages WHERE event_id=events.id AND cut=0)",
            (id,),
        )


def saved(db: sqlite3.Connection, ids: list[str]) -> set[str]:
    """Which of these events have a row in the saved chat: their words reached the history."""
    marks = ",".join("?" * len(ids))
    return {
        r[0]
        for r in db.execute(
            f"SELECT DISTINCT event_id FROM messages WHERE event_id IN ({marks}) AND cut=0", ids
        )
    }


def sweep(db: sqlite3.Connection, before: str) -> int:
    """Delete `handled` rows ended before `before`; waiting, running and given-up rows stay."""
    return db.execute(
        "DELETE FROM events WHERE state='handled' AND handled_at<?", (before,)
    ).rowcount


def new_ids_of_task(db: sqlite3.Connection, task_id: str) -> list[str]:
    """The news still waiting for a task. Events a turn holds (`taken`) are left to its end."""
    return [
        r[0] for r in db.execute("SELECT id FROM events WHERE task=? AND state='new'", (task_id,))
    ]
