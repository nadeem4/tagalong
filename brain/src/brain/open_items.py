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
from datetime import UTC, datetime, timedelta

from brain.store import open_items as store
from brain.store.db import utc_text

DEADLINE_S = 86400  # the one deadline: a day to answer, unless an item asks for another
NOT_NOW_DEFAULT_S = 1800  # Not now with no time on the card: look again in half an hour

_log = logging.getLogger("brain.open_items")


@dataclass(frozen=True)
class OpenItem:
    id: str
    kind: str
    state: str
    task_id: str | None
    caused_by: str | None
    saved_call: dict | None
    live_only: bool
    job_id: str | None
    created_at: datetime
    deadline_at: datetime
    check_back_at: datetime | None
    check_back_by: str | None
    urgent: bool
    closed_at: datetime | None
    closed_by: str | None
    answer: str | None
    reason: str | None
    window_s: float


class OpenItemRefused(Exception):
    """An answer that cannot count; `reason` says why: `not_found`, `expired`, `closed` or
    `person_set` (Scout tried to move a check-back the person chose)."""

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
    check = None if s.check_back_at is None else datetime.fromisoformat(s.check_back_at)
    return OpenItem(
        s.id,
        s.kind,
        s.state,
        s.task_id,
        s.caused_by,
        s.saved_call,
        s.live_only,
        s.job_id,
        datetime.fromisoformat(s.created_at),
        datetime.fromisoformat(s.deadline_at),
        check,
        s.check_back_by,
        s.urgent,
        closed,
        s.closed_by,
        s.answer,
        s.reason,
        s.window_s,
    )


def at_time(at: "datetime | str | None") -> datetime | None:
    """A body's ISO time (or a datetime) as an aware datetime; None when absent or unreadable."""
    if isinstance(at, str):
        try:
            at = datetime.fromisoformat(at)
        except ValueError:
            return None
    if at is not None and at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    return at


class OpenItems:
    def __init__(self, db: sqlite3.Connection, now: Callable[[], datetime]) -> None:
        self.db = db
        self._now = now

    def open(
        self,
        kind: str,
        *,
        task_id: str | None = None,
        caused_by: str | None = None,
        check_back_at: datetime | None = None,
        urgent: bool = False,
        saved_call: dict | None = None,
        live_only: bool = False,
        job_id: str | None = None,
        ttl_s: float = DEADLINE_S,
        id: str | None = None,
    ) -> OpenItem:
        now = self._now()
        id = id or uuid.uuid4().hex
        store.insert(
            self.db,
            id,
            kind=kind,
            task_id=task_id,
            caused_by=caused_by,
            saved_call=saved_call,
            live_only=live_only,
            job_id=job_id,
            created_at=utc_text(now),
            deadline_at=utc_text(now + timedelta(seconds=ttl_s)),
            window_s=ttl_s,
            # With no check-back given, look again two-thirds of the way to the deadline.
            check_back_at=utc_text(check_back_at or now + timedelta(seconds=ttl_s * 2 / 3)),
            check_back_by="scout",
            urgent=urgent,
        )
        item = self.get(id)
        _event("opened", item, "brain", kind)
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
        return self._close(item, "answered", by, "answered", answer=answer)

    def finish(self, id: str, reason: str) -> OpenItem:
        """The work for an open or answered item is done (an expired or done one is left as is)."""
        item = self.get(id)
        if item is None:
            raise OpenItemRefused("not_found")
        if item.state in ("open", "answered"):
            return self._close(item, "done", "brain", reason, only=item.state)
        return item

    def expire_due(self, now: datetime, kind: str | None = None) -> list[OpenItem]:
        return [
            self._close(_item(s), "expired", "brain", "deadline")
            for s in store.due(self.db, utc_text(now), kind)
        ]

    def expire(self, id: str, reason: str) -> OpenItem:
        """End one open item as expired, for a deadline the caller keeps itself."""
        item = self.get(id)
        if item is None:
            raise OpenItemRefused("not_found")
        return self._close(item, "expired", "brain", reason)

    def expire_live_only(self, job_id: str | None = None) -> list[OpenItem]:
        """Run at start (all of them) and when one job's process ends (only that job's): the
        items tied to a process can no longer run."""
        return [
            self._close(_item(s), "expired", "brain", "process_ended")
            for s in store.live_only_open(self.db, job_id)
        ]

    def list_open(self, kind: str | None = None) -> list[OpenItem]:
        return [_item(s) for s in store.list_open(self.db, kind)]

    def for_task(self, task_id: str) -> list[OpenItem]:
        return [_item(s) for s in store.for_task(self.db, task_id)]

    def not_now(self, id: str, at: datetime | None, by: str) -> OpenItem:
        """Look at this card again at `at` (half an hour on when None). A time the person set
        stays theirs: Scout's try is refused. The deadline moves with it, keeping its window."""
        item = self.get(id)
        if item is None:
            raise OpenItemRefused("not_found")
        if item.state != "open":
            raise OpenItemRefused("expired" if item.state == "expired" else "closed")
        if by == "scout" and item.check_back_by == "person":
            raise OpenItemRefused("person_set")
        at = at or self._now() + timedelta(seconds=NOT_NOW_DEFAULT_S)
        deadline = at + timedelta(seconds=item.window_s)
        store.set_check_back(self.db, id, utc_text(at), by, utc_text(deadline))
        moved = self.get(id)
        _event("not_now", moved, by, utc_text(at))
        return moved

    def due_checks(self, now: datetime) -> list[OpenItem]:
        return [_item(s) for s in store.due_checks(self.db, utc_text(now))]

    def checked(self, id: str, next_at: datetime | None) -> None:
        """The check-back was acted on (`card_due` posted): clear it, or move it to `next_at`."""
        item = self.get(id)
        if item is not None:
            store.set_check_back(
                self.db, id, None if next_at is None else utc_text(next_at), item.check_back_by
            )

    def list_answered(self, kind: str) -> list[OpenItem]:
        """Answered but not done: after a restart these are closed or run again, never lost."""
        return [_item(s) for s in store.answered(self.db, kind)]

    def find_open(self, kind: str, match: dict) -> OpenItem | None:
        """The open item whose saved call holds all of `match`, so a repeat opens no second one."""
        s = store.find_open(self.db, kind, match)
        return None if s is None else _item(s)

    def _close(
        self,
        item: OpenItem,
        state: str,
        by: str,
        reason: str,
        only: str = "open",
        answer: str | None = None,
    ) -> OpenItem:
        at = utc_text(self._now())
        if not store.close(self.db, item.id, state, at, by, reason, answer=answer, only=only):
            raise OpenItemRefused("closed")  # another move got there first
        closed = self.get(item.id)
        _event(state, closed, by, reason)
        return closed

    def expired_since(self, since: datetime) -> list[OpenItem]:
        """Items that expired at or after `since`: what ended while a body was away."""
        return [_item(s) for s in store.expired_since(self.db, utc_text(since))]
