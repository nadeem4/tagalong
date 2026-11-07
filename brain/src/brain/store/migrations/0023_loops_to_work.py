"""Loops become `loop` rows, their cursors move to `app_cursors`, the daily digest is a watch.

Each loop keeps its id. Held, surfaced and snoozed loops wait as `planned` (the snooze stays in
`work_loop`, the deadline in `due_at`); done, dropped and stale end as done, cancelled and
expired. History entries and surface marks become events. The `on:<app>` cursor becomes
`apps.reads_mail`. Then the three old tables go. Uses only `db.execute`: the runner holds the
transaction, and `executescript` would commit it.
"""

import json
from datetime import datetime, time, timedelta

from brain.store.db import utc_text
from brain.store.work import TITLE_CAP

_ENDED = {
    "done": ("done", "done"),
    "dropped": ("cancelled", "dropped"),
    "stale": ("expired", "went quiet"),
}
_STREAMS = {"sent": "sent", "backfill": "backfill"}


def _event(db, work_id: str, at: str, kind: str, data: dict) -> None:
    db.execute(
        "INSERT INTO work_events(work_id, at, kind, data) VALUES (?, ?, ?, ?)",
        (work_id, at, kind, json.dumps(data, ensure_ascii=False)),
    )


def _next_midnight() -> str:
    """The next local midnight, as UTC text."""
    tomorrow = datetime.now().astimezone().date() + timedelta(days=1)
    return utc_text(datetime.combine(tomorrow, time()).astimezone())


def migrate(db) -> None:
    db.execute(
        "CREATE TABLE work_loop(work_id TEXT PRIMARY KEY, source TEXT NOT NULL, ref TEXT NOT NULL,"
        " direction TEXT, people TEXT, anchors TEXT, quiet_after TEXT, snoozed_until TEXT,"
        " asks TEXT, UNIQUE(source, ref))"
    )
    db.execute(
        "CREATE TABLE app_cursors(app_id TEXT, stream TEXT, value TEXT, updated_at TEXT,"
        " PRIMARY KEY(app_id, stream))"
    )
    db.execute("ALTER TABLE apps ADD COLUMN reads_mail INTEGER NOT NULL DEFAULT 0")
    loops = db.execute(
        "SELECT id, source, ref, title, asks, direction, people, due, quiet_after, anchors,"
        " status, history, created, updated, snoozed_until FROM loops ORDER BY created, id"
    ).fetchall()
    for i, (id, source, ref, title, asks, direction, people, due, quiet, anchors, status,
            history, created, updated, snoozed) in enumerate(loops, start=1):  # fmt: skip
        state, reason = _ENDED.get(status, ("planned", None))
        db.execute(
            "INSERT INTO work(id, root_id, seq, kind, state, title, due_at, created_at,"
            " updated_at, ended_at, end_reason, reported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (id, id, i, "loop", state, title[:TITLE_CAP], due, created, updated,
             updated if reason else None, reason, updated if reason else None),
        )  # fmt: skip
        db.execute(
            "INSERT INTO work_loop(work_id, source, ref, direction, people, anchors, quiet_after,"
            " snoozed_until, asks) VALUES (?,?,?,?,?,?,?,?,?)",
            (id, source, ref, direction, people, anchors, quiet, snoozed, asks),
        )
        _event(db, id, created, "created", {"kind": "loop"})
        for entry in json.loads(history):
            data = {"note": entry.get("note", "")}
            if entry.get("mail_at"):
                data["mail_at"] = entry["mail_at"]
            _event(db, id, entry.get("at") or updated, "history", data)
    for loop_id, anchor, day in db.execute(
        "SELECT loop_id, anchor, day FROM loop_surfaced ORDER BY rowid"
    ).fetchall():
        at = db.execute("SELECT updated_at FROM work WHERE id = ?", (loop_id,)).fetchone()
        if at is not None:
            _event(db, loop_id, at[0], "surfaced", {"anchor": anchor, "day": day})
    for key, value in db.execute("SELECT app_id, value FROM loop_cursor").fetchall():
        prefix, _, app = key.partition(":")
        if app and prefix == "on":
            db.execute("UPDATE apps SET reads_mail = 1 WHERE id = ?", (app,))
        elif app and prefix in _STREAMS:
            _cursor(db, app, _STREAMS[prefix], value)
        elif key != "digest:day":
            _cursor(db, key, "mail", value)
    now = utc_text(datetime.now().astimezone())
    db.execute(
        "INSERT INTO work(id, root_id, seq, kind, state, title, input, due_at, created_at,"
        " updated_at) VALUES ('loop-digest','loop-digest',"
        " (SELECT COALESCE(MAX(seq), 0) + 1 FROM work WHERE parent_id IS NULL),"
        " 'watch','planned','Daily digest of held loops',?,?,?,?)",
        (json.dumps({"trigger": "return"}), _next_midnight(), now, now),
    )
    db.execute("INSERT INTO work_timer(work_id, repeat_s) VALUES ('loop-digest', 86400)")
    _event(db, "loop-digest", now, "created", {"kind": "watch"})
    db.execute("DROP TABLE loops")
    db.execute("DROP TABLE loop_surfaced")
    db.execute("DROP TABLE loop_cursor")


def _cursor(db, app_id: str, stream: str, value: str) -> None:
    db.execute(
        "INSERT INTO app_cursors(app_id, stream, value, updated_at) VALUES (?,?,?,?)"
        " ON CONFLICT(app_id, stream) DO UPDATE SET value = excluded.value",
        (app_id, stream, value, utc_text(datetime.now().astimezone())),
    )
