"""Tasks: what the person asked for, one row each, that events and work hang off.

A say opens an Ask, which no one sees and which ends with its turn; later slices open Do, Later,
Watch and Own tasks. `settle` ends Asks, Laters and told Owns by looking at the rows, not by
hooks, so a crash cannot leave one open. `open_block` is the facts line Scout reads about
what is open.
`stop` is the one place a task is stopped (spec 6.13): the session passes it what to call.
"""

import logging
import secrets
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from brain.events import PERSON_KINDS, Event
from brain.open_items import OpenItem, OpenItems
from brain.store import tasks as store
from brain.store.db import transaction, utc_text
from brain.store.memory import MemoryRefused
from brain.store.work import TITLE_CAP
from brain.tools import _fence_safe

_log = logging.getLogger(__name__)

RESULT_CAP = 2_000  # like a work summary: a line or two, not a report


def age_text(seconds: int) -> str:
    """How long, in one unit: Scout weighs the age, code never drops what is old."""
    for size, unit in ((86400, "d"), (3600, "h"), (60, "m")):
        if seconds >= size:
            return f"{seconds // size}{unit}"
    return f"{max(seconds, 0)}s"


@dataclass(frozen=True)
class TaskStopHooks:
    """What stopping a task asks of the rest of the brain, built by the session once it has the
    parts. All are required: a part with nothing to stop passes a no-op."""

    stop_jobs: Callable[[str], Awaitable[None]]  # kill its jobs, cancel planned ones
    cancel_rows: Callable[[str], None]  # cancel its timers and watches
    close_cards: Callable[[list[str]], None]  # take its cards down on the bodies
    finish_events: Callable[[str], None]  # handle its waiting news as stopped
    cancel_turn_if_only: Callable[[set[str]], None]  # the turn that held only them
    stop_watch: Callable[[str], None]  # switch off what a Watch task stands for (mail, updates)


class Tasks:
    def __init__(
        self,
        db: sqlite3.Connection,
        mask: Callable[[str], str],
        now: Callable[[], datetime],
        *,
        items: OpenItems | None = None,  # what waits on the person; `stop` closes the task's
        post: Callable[[Event], None] | None = None,  # the session's post_event
    ) -> None:
        self._db = db
        self._mask = mask
        self._now = now
        self._items = items
        self._post = post
        # The session sets it once what it needs exists; `stop` needs it.
        self.hooks: TaskStopHooks | None = None

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
            title=None if title is None else self._mask(title)[:TITLE_CAP],
            source=source, caused_by=caused_by, result=None,
            created_at=at, updated_at=at, ended_at=None, end_reason=None,
        )  # fmt: skip
        with transaction(self._db):
            store.insert(self._db, row)
        return id

    def for_turn(self, cause: str | None, kind: str, title: str | None = None) -> str:
        """A new task for the turn that took `cause`: it comes from that event's source and is
        caused by it. With no cause (Scout on its own) the source is `scout`."""
        source = (None if cause is None else store.event_source(self._db, cause)) or "scout"
        return self.open(kind, source, caused_by=cause, title=title)

    def claim(self, given: object, cause: str | None, kind: str, title: str) -> str:
        """The task a tool call works for: the open one named, or a new `kind` task for the turn
        that took `cause`. The caller waits it once what it set going has started."""
        if given is None:
            id = self.for_turn(cause, kind, title)
        else:
            row = store.get(self._db, given) if isinstance(given, str) else None
            if row is None or row.state not in ("open", "waiting"):
                raise MemoryRefused(f"no open task {given}.")
            id = row.id
        return id

    def watching(self, source: str, title: str) -> str:
        """The open Watch task of a source, opened when there is none: one per thing watched."""
        return store.open_of_source(self._db, "watch", source) or self.open(
            "watch", source, title=title
        )

    def open_watch(self, source: str) -> str | None:
        return store.open_of_source(self._db, "watch", source)

    def timers_of(self, id: str) -> list[str]:
        return store.timers_of(self._db, id)

    def get(self, id: str) -> store.TaskRow | None:
        return store.get(self._db, id)

    def person_cause(self, event_id: str | None) -> bool:
        """The one person rule: the event is a person's say or card answer. A missing or swept
        event is not (fail safe: the hand-off card shows)."""
        return event_id is not None and store.event_kind(self._db, event_id) in PERSON_KINDS

    def is_person(self, id: str | None) -> bool:
        """Whether a person started the task: the event that caused it is a person's."""
        row = None if id is None else store.get(self._db, id)
        return row is not None and self.person_cause(row.caused_by)

    def card_fields(self, item: OpenItem) -> dict | None:
        """What a card of this item carries for its task: the task, and when it will be looked at
        again. None for no task or an Ask task: the person never sees that one."""
        row = None if item.task_id is None else self.get(item.task_id)
        if row is None or row.kind == "ask":
            return None
        return {
            "task": {"id": row.id, "title": row.title},
            "check_back_at": item.check_back_at.isoformat() if item.check_back_at else None,
            "check_back_by": item.check_back_by,
            "urgent": item.urgent,
        }

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
        result = None if result is None else self._mask(result)[:RESULT_CAP]
        with transaction(self._db):
            return store.set_state(
                self._db, id, state, at=utc_text(self._now()), result=result, end_reason=reason
            )

    async def stop(self, id: str, by: str) -> list[str]:
        """The person ended the task (spec 6.13): it and every task it started end as stopped,
        and for each its jobs are killed, its timers cancelled, its cards closed and its waiting
        news handled. A turn that held only their events is cancelled, and Scout hears one
        `task_stop`. Returns the task ids stopped, the task first; [] when it was already over."""
        if not self.end(id, "stopped", reason="the person stopped it"):
            return []
        stopped, queue = [id], [id]
        while queue:  # all ended first, so nothing started meanwhile can claim one
            for child in store.caused_by_tasks(self._db, queue.pop(0)):
                if self.end(child, "stopped", reason="the task that started it was stopped"):
                    stopped.append(child)
                    queue.append(child)
        hooks = self.hooks
        if hooks is None:
            raise RuntimeError("Tasks.stop needs its hooks")
        # The task has ended, so one failing step must not skip the rest, nor later tasks.
        for task in stopped:
            try:
                await hooks.stop_jobs(task)
            except Exception:
                _log.exception("stopping task %s: its jobs", task)
            self._step("its timers", task, hooks.cancel_rows, task)
            self._step("its cards", task, self._close_cards, task)
            self._step("its news", task, hooks.finish_events, task)
            self._step("what it watches", task, hooks.stop_watch, task)
        self._step("the running turn", id, hooks.cancel_turn_if_only, set(stopped))
        if self._post:
            self._post(Event("task_stop", by, {"task": id, "by": by}, task=id))
        return stopped

    def _close_cards(self, task: str) -> None:
        if self._items is None:
            return
        closed = [i.id for i in self._items.for_task(task)]
        for item_id in closed:
            self._items.finish(item_id, "cancelled")
        if closed:
            assert self.hooks is not None
            self.hooks.close_cards(closed)

    @staticmethod
    def _step(what: str, task: str, call: Callable, arg: object) -> None:
        try:
            call(arg)
        except Exception:
            _log.exception("stopping task %s: %s", task, what)

    def settle(self) -> list[str]:
        """End every Ask whose say is over, every Later with nothing left to run and every Own
        that was told (an offer ends on its answer instead, and has no event)."""
        ended = []
        with transaction(self._db):
            at = utc_text(self._now())
            for id, state in store.asks_to_settle(self._db):
                if store.set_state(self._db, id, state, at=at):
                    ended.append(id)
            for id in store.laters_to_settle(self._db) + store.owns_to_settle(self._db):
                if store.set_state(self._db, id, "done", at=at):
                    ended.append(id)
        return ended

    def sweep(self, keep_days: int) -> int:
        """Delete ended tasks older than `keep_days`, so the table does not grow forever."""
        before = utc_text(self._now() - timedelta(days=keep_days))
        with transaction(self._db):
            return store.sweep(self._db, before)

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
            lines.append(
                f"{r.id} {r.kind} {r.state} {title!r} from {r.source}, last news {age} ago"
            )
        if len(rows) > limit:
            lines.append(f"and {len(rows) - limit} more")
        return "\n".join(lines)
