"""Open items: everything waiting on the person, with one lifecycle and one deadline.

An item is open until it is answered, finished or expired; the person's answer always counts
while it is open. A saved-call item survives a restart; a live-only item (tied to a running
process) is expired when that process ends. Every move writes one `open_item.*` log line.
Nothing here runs SQL: `store/open_items.py` does.
"""

import logging
import sqlite3
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from brain.store import open_items as store
from brain.store.db import utc_text

DEADLINE_S = 86400  # the one deadline: a day to answer, unless an item asks for another

_log = logging.getLogger("brain.open_items")


@dataclass(frozen=True)
class OpenItem:
    id: str
    kind: str
    origin_body: str
    state: str
    saved_call: dict | None
    live_only: bool
    job_id: str | None
    created_at: datetime
    deadline_at: datetime
    closed_at: datetime | None
    closed_by: str | None
    reason: str | None


class OpenItemRefused(Exception):
    """An answer that cannot count; `reason` says why: `not_found`, `expired` or `closed`."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _event(event: str, item: OpenItem, by: str, why: str) -> None:
    why = "_".join(why.split())
    _log.info(
        "open_item.%s t=%d id=%s kind=%s by=%s why=%s",
        event,
        time.time(),
        item.id,
        item.kind,
        by,
        why,
    )


def _item(s: store.StoredItem) -> OpenItem:
    closed = None if s.closed_at is None else datetime.fromisoformat(s.closed_at)
    return OpenItem(
        s.id,
        s.kind,
        s.origin_body,
        s.state,
        s.saved_call,
        s.live_only,
        s.job_id,
        datetime.fromisoformat(s.created_at),
        datetime.fromisoformat(s.deadline_at),
        closed,
        s.closed_by,
        s.reason,
    )


class OpenItems:
    def __init__(self, db: sqlite3.Connection, now: Callable[[], datetime]) -> None:
        self.db = db
        self._now = now

    def open(
        self,
        kind: str,
        origin_body: str,
        saved_call: dict | None = None,
        live_only: bool = False,
        job_id: str | None = None,
        ttl_s: float = DEADLINE_S,
    ) -> OpenItem:
        now = self._now()
        id = uuid.uuid4().hex
        store.insert(
            self.db,
            id,
            kind=kind,
            origin_body=origin_body,
            saved_call=saved_call,
            live_only=live_only,
            job_id=job_id,
            created_at=utc_text(now),
            deadline_at=utc_text(now + timedelta(seconds=ttl_s)),
        )
        item = self.get(id)
        _event("opened", item, origin_body, kind)
        return item

    def get(self, id: str) -> OpenItem | None:
        s = store.get(self.db, id)
        return None if s is None else _item(s)

    def answer(self, id: str, answer: str, by: str) -> OpenItem:
        """Record the person's answer. Counts while the item is open, even if the turn that
        raised it is gone; refused with a reason once it is expired or closed."""
        item = self.get(id)
        if item is None:
            raise OpenItemRefused("not_found")
        if item.state == "open" and item.deadline_at <= self._now():
            self._close(item, "expired", "brain", "deadline")
        item = self.get(id)
        if item.state != "open":
            raise OpenItemRefused(item.state if item.state == "expired" else "closed")
        return self._close(item, "answered", by, answer)

    def finish(self, id: str, reason: str) -> OpenItem:
        """The work for an open or answered item is done (an expired or done one is left as is)."""
        item = self.get(id)
        if item is None:
            raise OpenItemRefused("not_found")
        if item.state in ("open", "answered"):
            return self._close(item, "done", "brain", reason, only=item.state)
        return item

    def expire_due(self, now: datetime) -> list[OpenItem]:
        return [
            self._close(_item(s), "expired", "brain", "deadline")
            for s in store.due(self.db, utc_text(now))
        ]

    def expire_live_only(self) -> list[OpenItem]:
        """Run at start and when a process ends: its items can no longer run."""
        return [
            self._close(_item(s), "expired", "brain", "process_ended")
            for s in store.live_only_open(self.db)
        ]

    def list_open(self, origin_body: str | None = None) -> list[OpenItem]:
        return [_item(s) for s in store.list_open(self.db, origin_body)]

    def _close(self, item: OpenItem, state: str, by: str, reason: str, only: str = "open"):
        if not store.close(self.db, item.id, state, utc_text(self._now()), by, reason, only=only):
            return self.get(item.id)
        closed = self.get(item.id)
        _event(state, closed, by, reason)
        return closed
