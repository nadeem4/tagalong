"""Timers become `timer` rows and tracking memories become paused `watch` rows.

Both keep how often they repeat in `work_timer`. A timer tied to a job hangs under that goal.
A cadence that cannot be read is kept as text in the row's input, so nothing is lost. Then the
`timers` table and the `memories.cadence` column go. Uses only `db.execute`: the runner holds
the transaction, and `executescript` would commit it.
"""

import json

from brain.masking import Masker
from brain.store.work import TITLE_CAP, parse_cadence

_MASK = Masker(lambda: []).mask  # shape-only: key-like strings go, no exact values are known


def _next_seq(db, parent_id: str | None) -> int:
    return db.execute(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM work WHERE parent_id IS ?", (parent_id,)
    ).fetchone()[0]


def _insert(db, row: dict, repeat_s: int | None) -> None:
    db.execute(
        f"INSERT INTO work({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
        tuple(row.values()),
    )
    db.execute("INSERT INTO work_timer(work_id, repeat_s) VALUES (?, ?)", (row["id"], repeat_s))
    db.execute(
        "INSERT INTO work_events(work_id, at, kind, data) VALUES (?, ?, 'created', ?)",
        (row["id"], row["created_at"], json.dumps({"kind": row["kind"]})),
    )


def _text_fields(text: str, extra: dict) -> tuple[str, str | None]:
    """(title, input json): the title is capped, so a longer note is kept whole in the input."""
    text = _MASK(text)
    fields = dict(extra)
    if len(text) > TITLE_CAP:
        fields["note"] = text
    return text[:TITLE_CAP], json.dumps(fields) if fields else None


def migrate(db) -> None:
    db.execute("CREATE TABLE work_timer(work_id TEXT PRIMARY KEY, repeat_s INTEGER)")
    goals = {r[0]: r[1] for r in db.execute("SELECT id, root_id FROM work WHERE kind = 'goal'")}
    timers = db.execute(
        "SELECT id, note, next_at, repeat_s, created_at, fired, job_id FROM timers ORDER BY id"
    ).fetchall()
    for id, note, next_at, repeat_s, created, fired, job_id in timers:
        parent = job_id if job_id in goals else None
        title, input = _text_fields(note, {})
        _insert(
            db,
            {
                "id": f"t{id}",
                "parent_id": parent,
                "root_id": goals[parent] if parent else f"t{id}",
                "seq": _next_seq(db, parent),
                "kind": "timer",
                "state": "active" if fired else "planned",
                "title": title,
                "input": input,
                "due_at": next_at,
                "created_at": created,
                "updated_at": created,
            },
            repeat_s,
        )
    tracking = db.execute(
        "SELECT id, text, cadence, created_at FROM memories WHERE kind = 'tracking' ORDER BY id"
    ).fetchall()
    for id, text, cadence, created in tracking:
        repeat_s = parse_cadence(cadence) if cadence else None
        extra = {"cadence": cadence} if cadence and repeat_s is None else {}
        title, input = _text_fields(text, extra)
        _insert(
            db,
            {
                "id": f"w{id}",
                "parent_id": None,
                "root_id": f"w{id}",
                "seq": _next_seq(db, None),
                "kind": "watch",
                "state": "paused",
                "title": title,
                "input": input,
                "created_at": created,
                "updated_at": created,
            },
            repeat_s,
        )
    db.execute("DELETE FROM memories WHERE kind = 'tracking'")
    db.execute("ALTER TABLE memories DROP COLUMN cadence")
    db.execute("DROP TABLE timers")
