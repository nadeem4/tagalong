"""Loops as `loop` work rows, with the per-app mail switch and read cursors beside them.

`WorkStore` holds the row and its events (history and "surfaced" marks); `store.connections`
holds the cursors and `apps.reads_mail`. This class only translates between a `Loop` and those.
Text is masked on the way in (by the work store), so a secret in a mail never lands on disk.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, time, timedelta

from brain.loops.loop import Loop
from brain.store import connections
from brain.store.db import transaction, utc_text
from brain.store.work import WorkRow, WorkStore

DIGEST_ID = "loop-digest"
# Loop statuses Home and the triggers see, by the work state they end in.
_ENDED = {
    "done": ("done", "done"),
    "dropped": ("cancelled", "dropped"),
    "stale": ("expired", "went quiet"),
}
_STATUS = {"done": "done", "cancelled": "dropped", "expired": "stale"}


def _parse(text: str | None) -> datetime | None:
    return datetime.fromisoformat(text) if text else None


def next_local_midnight(now: datetime) -> datetime:
    return datetime.combine(now.astimezone().date() + timedelta(days=1), time()).astimezone()


class LoopStore:
    def __init__(
        self, work: WorkStore, db: sqlite3.Connection, now: Callable[[], datetime]
    ) -> None:
        self.work = work
        self.db = db
        self._now = now

    def save(self, loop: Loop) -> Loop:
        """Insert, or update the loop with the same (source, ref); its id and history stay.

        New mail on a loop that is done or went quiet reopens it; a dropped one stays dropped."""
        existing = self.work.find_loop(loop.source, loop.ref)
        if existing is None:
            row = self.work.create("loop", loop.title, due_at=loop.due)
        else:
            self.work.update(existing, title=loop.title, due_at=loop.due)
            row = self.work.get(existing)
            assert row is not None
            if row.state in ("done", "expired"):
                self.work.transition(row.id, "planned")
        self.work.set_loop_detail(
            row.id,
            source=loop.source,
            ref=loop.ref,
            direction=loop.direction,
            people=loop.people,
            anchors=loop.anchors,
            quiet_after=loop.quiet_after,
            asks=loop.asks,
        )
        return self.get(row.id)  # type: ignore[return-value]

    def get(self, loop_id: str) -> Loop | None:
        row = self.work.get(loop_id)
        detail = self.work.loop_details(loop_id).get(loop_id)
        if row is None or row.kind != "loop" or detail is None:
            return None
        return self._loop(row, detail)

    def list(self, status: str | None = None) -> list[Loop]:
        details = self.work.loop_details()
        loops = [self._loop(r, details[r.id]) for r in self.work.of_kind("loop") if r.id in details]
        return [lp for lp in loops if status is None or lp.status == status]

    def set_status(self, loop_id: str, status: str) -> None:
        """held (open again, snooze cleared), done, dropped or stale."""
        row = self.work.get(loop_id)
        if row is None:
            return
        if status == "held":
            if row.state != "planned":
                self.work.transition(loop_id, "planned")
            else:
                self.work.update(loop_id)  # touched: the stale clock starts over
        else:
            state, reason = _ENDED[status]
            self.work.transition(loop_id, state, reason=reason)
            self.work.mark_reported(loop_id)  # Scout hears loops through the service, not this
        self.work.set_snooze(loop_id, None)

    def snooze(self, loop_id: str, until: datetime) -> None:
        row = self.work.get(loop_id)
        if row is not None and row.state != "planned":
            self.work.transition(loop_id, "planned")  # a loop that went quiet is waiting again
        self.work.set_snooze(loop_id, until)
        self.work.update(loop_id)

    def mask(self, text: str) -> str:
        return self.work.mask(text)

    def add_history(self, loop_id: str, note: str, mail_at: datetime | None = None) -> None:
        if self.work.get(loop_id) is None:
            return
        data = {"note": self.work.mask(note)}
        if mail_at:  # when the mail itself arrived, so a later reply can be compared with it
            data["mail_at"] = mail_at.isoformat()
        self.work.add_event(loop_id, "history", data)

    def mark_surfaced(self, loop_id: str, anchor: str, day: str) -> None:
        self.work.add_event(loop_id, "surfaced", {"anchor": anchor, "day": day})

    def surfaced(self, loop_id: str) -> dict[str, str]:
        """anchor -> the local day it last surfaced."""
        return {
            e.data["anchor"]: e.data["day"]
            for e in self.work.events_of_kind(loop_id, "surfaced")
            if e.data
        }

    def cursor(self, app_id: str) -> str | None:
        return connections.cursor(self.db, app_id, "mail")

    def set_cursor(self, app_id: str, value: str) -> None:
        self._put(app_id, "mail", value)

    # Two more places per app: where the sent scan got to, and whether the unanswered-only
    # backfill finished.
    def sent_cursor(self, app_id: str) -> str | None:
        return connections.cursor(self.db, app_id, "sent")

    def set_sent_cursor(self, app_id: str, value: str) -> None:
        self._put(app_id, "sent", value)

    def backfilled(self, app_id: str) -> bool:
        return connections.cursor(self.db, app_id, "backfill") is not None

    def set_backfilled(self, app_id: str) -> None:
        self._put(app_id, "backfill", "done")

    def set_on(self, app_id: str, on: bool) -> None:
        connections.set_reads_mail(self.db, app_id, on)

    def on_apps(self):
        return connections.reads_mail_apps(self.db)

    def forget(self, loop_id: str) -> None:
        with transaction(self.db):
            self.work.delete_loops(loop_id)

    def wipe(self) -> None:
        with transaction(self.db):
            self.work.delete_loops()
            connections.clear_mail(self.db)

    # The daily digest is a watch row Timers leaves alone; the service runs it on a return.
    def digest_due(self) -> bool:
        row = self.work.get(DIGEST_ID)
        return row is not None and row.due_at is not None and row.due_at <= utc_text(self._now())

    def advance_digest(self) -> None:
        self.work.update(DIGEST_ID, due_at=next_local_midnight(self._now()))

    def _put(self, app_id: str, stream: str, value: str) -> None:
        connections.set_cursor(self.db, app_id, stream, value, utc_text(self._now()))

    def _loop(self, row: WorkRow, d: dict) -> Loop:
        loop = Loop(
            id=row.id, source=d["source"], ref=d["ref"], title=row.title, asks=d["asks"],
            direction=d["direction"], people=d["people"], due=_parse(row.due_at),
            quiet_after=_parse(d["quiet_after"]), anchors=d["anchors"],
            status=self._status(row, d),
            history=[
                {"at": e.at, **(e.data or {})} for e in self.work.events_of_kind(row.id, "history")
            ],
            created=_parse(row.created_at), updated=_parse(row.updated_at),
            snoozed_until=_parse(d["snoozed_until"]),
        )  # fmt: skip
        return replace(loop, surfaced=self.surfaced(loop.id))

    @staticmethod
    def _status(row: WorkRow, d: dict) -> str:
        if row.state == "planned":
            return "snoozed" if d["snoozed_until"] else "held"
        return _STATUS[row.state]
