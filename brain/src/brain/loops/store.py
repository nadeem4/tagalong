"""SQLite store for loops, over the connection Memory already opened.

Tables are created by Memory's migrations (one database file, one schema history). Text is
masked before it is written, so a secret in a mail never lands on disk.
"""

import json
import sqlite3
import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime

from brain.loops.loop import Loop

_COLS = (
    "id, source, ref, title, asks, direction, people, due, quiet_after, anchors, status,"
    " history, created, updated"
)


def _iso(at: datetime | None) -> str | None:
    return at.astimezone(UTC).isoformat() if at else None


def _parse(text: str | None) -> datetime | None:
    return datetime.fromisoformat(text) if text else None


class LoopStore:
    def __init__(
        self,
        db: sqlite3.Connection,
        now: Callable[[], datetime],
        mask: Callable[[str], str] = lambda text: text,
    ) -> None:
        self._db = db
        self._now = now
        self._mask = mask

    def save(self, loop: Loop) -> Loop:
        """Insert, or update the loop with the same (source, ref); its id and history stay."""
        at = _iso(self._now())
        m = self._mask
        fields = (
            m(loop.title),
            m(loop.asks),
            loop.direction,
            json.dumps([m(p) for p in loop.people]),
            _iso(loop.due),
            _iso(loop.quiet_after),
            json.dumps([m(a) for a in loop.anchors]),
        )
        row = self._db.execute(
            "SELECT id FROM loops WHERE source = ? AND ref = ?", (loop.source, loop.ref)
        ).fetchone()
        if row:
            self._db.execute(
                "UPDATE loops SET title=?, asks=?, direction=?, people=?, due=?, quiet_after=?,"
                " anchors=?, updated=? WHERE id=?",
                (*fields, at, row[0]),
            )
            return self.get(row[0])  # type: ignore[return-value]
        loop_id = uuid.uuid4().hex[:8]
        self._db.execute(
            f"INSERT INTO loops({_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                loop_id,
                loop.source,
                loop.ref,
                fields[0],
                fields[1],
                fields[2],
                fields[3],
                fields[4],
                fields[5],
                fields[6],
                loop.status,
                "[]",
                at,
                at,
            ),  # fmt: skip
        )
        return self.get(loop_id)  # type: ignore[return-value]

    def get(self, loop_id: str) -> Loop | None:
        row = self._db.execute(f"SELECT {_COLS} FROM loops WHERE id = ?", (loop_id,)).fetchone()
        return self._loop(row) if row else None

    def list(self, status: str | None = None) -> list[Loop]:
        sql = f"SELECT {_COLS} FROM loops"
        args: tuple = ()
        if status:
            sql += " WHERE status = ?"
            args = (status,)
        return [self._loop(r) for r in self._db.execute(sql + " ORDER BY created, id", args)]

    def set_status(self, loop_id: str, status: str) -> None:
        self._db.execute(
            "UPDATE loops SET status = ?, updated = ? WHERE id = ?",
            (status, _iso(self._now()), loop_id),
        )

    def add_history(self, loop_id: str, note: str, mail_at: datetime | None = None) -> None:
        loop = self.get(loop_id)
        if loop is None:
            return
        entry = {"at": _iso(self._now()), "note": self._mask(note)}
        if mail_at:  # when the mail itself arrived, so a later reply can be compared with it
            entry["mail_at"] = _iso(mail_at)
        self._db.execute(
            "UPDATE loops SET history = ? WHERE id = ?",
            (json.dumps([*loop.history, entry]), loop_id),
        )

    def mark_surfaced(self, loop_id: str, anchor: str, day: str) -> None:
        self._db.execute(
            "INSERT INTO loop_surfaced(loop_id, anchor, day) VALUES (?,?,?)"
            " ON CONFLICT(loop_id, anchor) DO UPDATE SET day = excluded.day",
            (loop_id, anchor, day),
        )

    def surfaced(self, loop_id: str) -> dict[str, str]:
        rows = self._db.execute(
            "SELECT anchor, day FROM loop_surfaced WHERE loop_id = ?", (loop_id,)
        )
        return dict(rows.fetchall())

    def cursor(self, app_id: str) -> str | None:
        row = self._db.execute("SELECT value FROM loop_cursor WHERE app_id = ?", (app_id,))
        found = row.fetchone()
        return found[0] if found else None

    def set_cursor(self, app_id: str, value: str) -> None:
        self._db.execute(
            "INSERT INTO loop_cursor(app_id, value) VALUES (?,?)"
            " ON CONFLICT(app_id) DO UPDATE SET value = excluded.value",
            (app_id, value),
        )

    # Two more places per app share the cursor table under a prefixed key: where the sent scan
    # got to, and whether the unanswered-only backfill finished.
    def sent_cursor(self, app_id: str) -> str | None:
        return self.cursor(f"sent:{app_id}")

    def set_sent_cursor(self, app_id: str, value: str) -> None:
        self.set_cursor(f"sent:{app_id}", value)

    def backfilled(self, app_id: str) -> bool:
        return self.cursor(f"backfill:{app_id}") is not None

    def set_backfilled(self, app_id: str) -> None:
        self.set_cursor(f"backfill:{app_id}", "done")

    def forget(self, loop_id: str) -> None:
        self._db.execute("DELETE FROM loop_surfaced WHERE loop_id = ?", (loop_id,))
        self._db.execute("DELETE FROM loops WHERE id = ?", (loop_id,))

    def wipe(self) -> None:
        for table in ("loop_surfaced", "loop_cursor", "loops"):
            self._db.execute(f"DELETE FROM {table}")

    def _loop(self, row: tuple) -> Loop:
        loop = Loop(
            id=row[0], source=row[1], ref=row[2], title=row[3], asks=row[4], direction=row[5],
            people=json.loads(row[6]), due=_parse(row[7]), quiet_after=_parse(row[8]),
            anchors=json.loads(row[9]), status=row[10], history=json.loads(row[11]),
            created=_parse(row[12]), updated=_parse(row[13]),
        )  # fmt: skip
        return replace(loop, surfaced=self.surfaced(loop.id))
