"""Tasks: what the person asked for, one row each, that events and work hang off.

A say opens an Ask, which no one sees and which ends with its turn; later slices open Do, Later,
Watch and Own tasks. `settle` ends Asks and Laters by looking at the rows, not by hooks, so a
crash cannot leave one open. `open_block` is the facts line Scout reads about what is open.
"""

import secrets
import sqlite3
from collections.abc import Callable
from datetime import datetime

from brain.masking import Masker
from brain.store import tasks as store
from brain.store.db import transaction, utc_text
from brain.store.work import TITLE_CAP
from brain.tools import _fence_safe

RESULT_CAP = 2_000  # like a work summary: a line or two, not a report


def age_text(seconds: int) -> str:
    """How long, in one unit: Scout weighs the age, code never drops what is old."""
    for size, unit in ((86400, "d"), (3600, "h"), (60, "m")):
        if seconds >= size:
            return f"{seconds // size}{unit}"
    return f"{max(seconds, 0)}s"


class Tasks:
    def __init__(
        self, db: sqlite3.Connection, masker: Masker, now: Callable[[], datetime]
    ) -> None:
        self._db = db
        self._masker = masker
        self._now = now

    def new_id(self) -> str:
        while True:
            id = secrets.token_hex(3)
            if store.get(self._db, id) is None:
                return id

    def open(
        self,
        kind: str,
        source: str,
        *,
        caused_by: str | None = None,
        title: str | None = None,
        id: str | None = None,
    ) -> str:
        id = id or self.new_id()
        at = utc_text(self._now())
        row = store.TaskRow(
            id=id, kind=kind, state="open",
            title=None if title is None else self._masker.mask(title)[:TITLE_CAP],
            source=source, caused_by=caused_by, result=None,
            created_at=at, updated_at=at, ended_at=None, end_reason=None,
        )  # fmt: skip
        with transaction(self._db):
            store.insert(self._db, row)
        return id

    def get(self, id: str) -> store.TaskRow | None:
        return store.get(self._db, id)

    def source_of(self, id: str | None) -> str | None:
        row = None if id is None else store.get(self._db, id)
        return None if row is None else row.source

    def wait(self, id: str) -> None:
        self._move(id, "waiting")

    def resume(self, id: str) -> None:
        self._move(id, "open")

    def _move(self, id: str, state: str) -> None:
        with transaction(self._db):
            store.set_state(self._db, id, state, at=utc_text(self._now()))

    def end(
        self, id: str, state: str, *, result: str | None = None, reason: str | None = None
    ) -> bool:
        """False when the task already ended: the first end stands."""
        result = None if result is None else self._masker.mask(result)[:RESULT_CAP]
        with transaction(self._db):
            return store.set_state(
                self._db, id, state, at=utc_text(self._now()), result=result, end_reason=reason
            )

    def settle(self) -> list[str]:
        """End every Ask whose say is over and every Later with nothing left to run."""
        ended = []
        with transaction(self._db):
            at = utc_text(self._now())
            for id, state in store.asks_to_settle(self._db):
                if store.set_state(self._db, id, state, at=at):
                    ended.append(id)
            for id in store.laters_to_settle(self._db):
                if store.set_state(self._db, id, "done", at=at):
                    ended.append(id)
        return ended

    def open_block(self, limit: int = 15) -> str:
        """One header and a line per open task, newest first; empty when none. Facts only."""
        rows = store.list_open(self._db)
        if not rows:
            return ""
        now = self._now()
        lines = ["Open tasks (newest first):"]
        for r in rows[:limit]:
            last = store.last_event_at(self._db, r.id) or r.created_at
            age = age_text(int((now - datetime.fromisoformat(last)).total_seconds()))
            title = _fence_safe(r.title or "")
            lines.append(f"{r.id} {r.kind} {r.state} {title!r} from {r.source}, last news {age} ago")
        if len(rows) > limit:
            lines.append(f"and {len(rows) - limit} more")
        return "\n".join(lines)
