"""Event kinds Scout can be woken by, the notes on how to weigh each, and the durable log.
A kind is data (batching, caps); the note is wording for the model, kept in
mind/events.md so code stays free of canned lines. `EventLog` saves every event that must
survive a restart (masked) before anything acts on it.
"""

import logging
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import cache
from importlib.resources import files
from typing import Literal
from uuid import uuid4

from pydantic import ValidationError

from brain.masking import Masker
from brain.protocol import BackData, DownloadData, FocusData, TabData
from brain.store import events as store
from brain.store.db import transaction, utc_text

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Event:
    kind: str
    # A body id, `scout`, or a prefixed source (`timer:<id>`, `setup:<id>`, `job:<id>`,
    # `loop:<app>`, `tool:<name>`): a source that names one thing is what a later event can finish.
    source: str
    payload: dict
    caused_by: str | None = None
    # Not compared on purpose: equality means the same fact; the log identifies events by id.
    # Two reports of the same fact are equal even though each has its own id.
    id: str = field(default_factory=lambda: uuid4().hex, compare=False)
    at: datetime | None = None
    task: str | None = None


Urgency = Literal["now", "next_pause", "idle", "hold"]


@dataclass(frozen=True)
class EventKind:
    name: str
    # When the runner may tell Scout this kind. Code sets it per kind; neither the model nor
    # an event's payload can raise it (see runner.py).
    urgency: Urgency = "idle"
    wakes: bool = True
    enabled: bool = True
    # None: never merged, one wake per event.
    batch_seconds: int | None = 0
    # None: exempt from the per-kind and the global cap.
    max_per_hour: int | None = None


_KINDS = (
    # A person's words and card answers: never a wake (see runner.PERSON_KINDS).
    EventKind("say", urgency="now", wakes=False),
    EventKind("card_answer", urgency="now", wakes=False),
    EventKind("timer", urgency="next_pause", batch_seconds=0, max_per_hour=6),
    EventKind("job_ended", urgency="idle", batch_seconds=30, max_per_hour=10),
    EventKind("ask_notice", urgency="idle", batch_seconds=60, max_per_hour=6),
    EventKind("ask_ended", urgency="next_pause", batch_seconds=30, max_per_hour=10),
    EventKind("asks_waiting", urgency="next_pause", batch_seconds=None, max_per_hour=None),
    EventKind("job_quiet", urgency="idle", batch_seconds=0, max_per_hour=3),
    EventKind("job_step_failed", urgency="idle", batch_seconds=120, max_per_hour=4),
    EventKind("work_failed", urgency="next_pause", batch_seconds=0, max_per_hour=10),
    EventKind("loop", urgency="idle", batch_seconds=0, max_per_hour=4),
    EventKind("body_online", urgency="next_pause", batch_seconds=0, max_per_hour=2),
    EventKind("back", urgency="next_pause", batch_seconds=0, max_per_hour=2),
    # A tool the owner's talking over left running has finished; its result returns here.
    EventKind("tool_result", urgency="next_pause", batch_seconds=0, max_per_hour=None),
    EventKind("job_question", urgency="next_pause", batch_seconds=None, max_per_hour=None),
    EventKind("choice", urgency="next_pause", batch_seconds=None, max_per_hour=None),
    EventKind("setup_progress", urgency="idle", wakes=False),
    EventKind("setup_done", urgency="next_pause", batch_seconds=None, max_per_hour=None),
    EventKind("setup_login", urgency="next_pause", batch_seconds=None, max_per_hour=None),
    # The WhatsApp body reports these moments as facts; Scout words any reply.
    EventKind("ask_closed", urgency="next_pause", batch_seconds=0, max_per_hour=6),
    EventKind("many_pending", urgency="next_pause", batch_seconds=0, max_per_hour=6),
    EventKind("focus", urgency="idle", wakes=False),
    EventKind("tab", urgency="idle", wakes=False),
    EventKind("download", urgency="idle", wakes=False),
)
EVENT_KINDS: dict[str, EventKind] = {k.name: k for k in _KINDS}

# A body that returns sooner than this was just reconnecting, not away.
BODY_ONLINE_MIN_AWAY_S = 600


def from_body(body_id: str, name: str, data: object) -> Event | None:
    """An event a body reported, or None for an unknown name or data of the wrong shape.

    Bodies are untrusted input: nothing here may raise on a bad frame.
    """
    try:
        if name == "back":
            back = BackData.model_validate(data)
            facts = {"body": body_id, "idle_seconds": back.idle_seconds}
            return Event("back", body_id, facts)
        if name == "focus":
            focus = FocusData.model_validate(data)
            facts = {"body": body_id, "app": focus.app, "title": focus.title[:200]}
            return Event("focus", body_id, facts)
        if name == "tab":
            tab = TabData.model_validate(data)
            facts = {"body": body_id, "title": tab.title[:200], "url": tab.url[:300]}
            return Event("tab", body_id, facts)
        if name == "download":
            dl = DownloadData.model_validate(data)
            facts = {"body": body_id, "name": dl.name[:200], "state": dl.state}
            return Event("download", body_id, facts)
        if name == "ask_closed":
            # The answer or tap met a question the brain no longer holds.
            if isinstance(data, dict) and data.get("via") in ("tap", "answer"):
                return Event(
                    "ask_closed",
                    body_id,
                    {"body": body_id, "via": data["via"]},
                )
        if name == "many_pending":
            asks = data.get("asks") if isinstance(data, dict) else None
            if isinstance(asks, int) and not isinstance(asks, bool) and asks > 1:
                return Event(
                    "many_pending",
                    body_id,
                    {"body": body_id, "asks": asks},
                )
    except ValidationError:
        return None
    return None


def from_connect(body_id: str, away_seconds: float | None, kind: str | None = None) -> Event | None:
    """Wake only when a body that was seen earlier comes back after a real absence.

    A browser opens and closes all day and is not the owner arriving, so it never wakes.
    """
    if kind == "browser" or away_seconds is None or away_seconds < BODY_ONLINE_MIN_AWAY_S:
        return None
    return Event(
        "body_online",
        body_id,
        {"body": body_id, "offline_seconds": int(away_seconds)},
    )


@cache
def load_notes() -> dict[str, str]:
    """One `## <kind>` section per kind in mind/events.md, body stripped."""
    text = files("brain.mind").joinpath("events.md").read_text(encoding="utf-8")
    notes: dict[str, str] = {}
    for part in ("\n" + text).split("\n## ")[1:]:
        name, _, body = part.partition("\n")
        notes[name.strip()] = body.strip()
    return notes


# Kinds that survive a restart: every one that wakes Scout, plus a person's say and card answer.
# focus, tab, download and setup_progress are latest-value facts and are never stored.
SAVED_KINDS = frozenset(k.name for k in _KINDS if k.wakes) | {"say", "card_answer"}

BACKOFF_S = (30, 120, 600)  # the waits before the 1st, 2nd and 3rd retry of a failed turn
MAX_RETRIES = 3  # the failure after the last retry gives the event up

_INTERNAL_SOURCES = frozenset({"scout"})  # the rest are `kind:id`, internal by the ":" rule


def is_internal(source: str) -> bool:
    """True when Scout's own machinery posted it, false for a body id."""
    return source in _INTERNAL_SOURCES or ":" in source


class EventLog:
    """The durable in queue: every input is saved here first, masked, then acted on."""

    def __init__(self, db: sqlite3.Connection, masker: Masker, now: Callable[[], datetime]) -> None:
        self._db = db
        self._masker = masker
        self._now = now
        self.on_post: Callable[[], None] = lambda: None  # the runner's poke
        # Home's Waiting list: told that an event was saved or changed state, so it reads again.
        self.on_change: Callable[[], None] = lambda: None
        # In memory on purpose: a hook is a live caller waiting (a job's question); after a
        # restart nobody waits, and the event row alone carries on.
        self._on_end: dict[str, Callable[[str], None]] = {}

    def post(
        self,
        event: Event,
        *,
        then: Callable[[sqlite3.Connection], None] | None = None,
        on_end: Callable[[str], None] | None = None,
    ) -> bool:
        """Save the event; False when its id is already known (a retried say is one event).

        `then` runs in the same transaction, so a failure leaves no row behind. `on_end(state)`
        is called once, when the event is handled or given up, or returned to `new` at a stop.
        """
        if event.kind not in EVENT_KINDS:
            raise ValueError(f"unknown event kind {event.kind!r}")
        if event.kind not in SAVED_KINDS:
            if then is not None:  # nothing would run it: refuse rather than drop the write
                raise ValueError(f"event kind {event.kind!r} is not saved, so `then` cannot run")
            if on_end is not None:  # nothing would end it: the hook would never fire
                raise ValueError(f"event kind {event.kind!r} is not saved, so it never ends")
            return True
        payload = self._mask(event.payload)
        at = utc_text(event.at or self._now())
        row = store.EventRow(
            id=event.id,
            kind=event.kind,
            at=at,
            source=event.source,
            caused_by=event.caused_by,
            payload=payload,
            task=event.task,
        )
        with transaction(self._db):
            if not store.insert(self._db, row):
                return False
            if then is not None:
                then(self._db)
        if on_end is not None:
            self._on_end[event.id] = on_end
        self.on_change()
        self.on_post()
        return True

    def _mask(self, value):
        """Mask string leaves only: masking dumped JSON could eat an escaped quote."""
        if isinstance(value, str):
            try:
                return self._masker.mask(value)
            # Fail closed, like the saved chat: a say is not lost, a secret is not kept.
            except Exception:
                _log.exception("masking an event failed; the text is withheld")
                return "[withheld]"
        if isinstance(value, dict):
            return {k: self._mask(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._mask(v) for v in value]
        return value

    def get(self, id: str) -> store.EventRow | None:
        return store.get(self._db, id)

    def ready(self) -> list[store.EventRow]:
        return store.list_new(self._db, utc_text(self._now()))

    def amend(self, id: str, fields: dict) -> None:
        """Add facts learned after the save (what an interrupted say cut off), masked too."""
        row = self.get(id)
        if row is None:
            return
        with transaction(self._db):
            store.set_payload(self._db, id, {**row.payload, **self._mask(fields)})

    def take(self, ids: list[str], turn_id: str) -> list[str]:
        with transaction(self._db):
            moved = store.set_taken(self._db, ids, turn_id)
        if moved:
            self.on_change()
        return moved

    def finish(self, ids: list[str], state: str, end_reason: str | None = None) -> None:
        """Move events to `state`; `new` puts them back to be taken again."""
        with transaction(self._db):
            store.set_state(self._db, ids, state, end_reason=end_reason, at=utc_text(self._now()))
        if ids:
            self.on_change()
        if state in ("handled", "gave_up"):
            self.ended(ids, state)

    def backoff(
        self, ids: list[str], reason: str, *, resume: bool = True, wait: bool = True
    ) -> None:
        """A turn that took these failed (`error`, `step_cap`): each waits 30 s, 2 min, then
        10 min and is tried again; the fourth failure gives it up. `resume=False` when the
        turn never started, so nothing of it reached the history. `wait=False` counts the
        attempt but runs it again at once (a restart: the crash already cost the time)."""
        now = self._now()
        gave_up: list[str] = []
        with transaction(self._db):
            for id in ids:
                row = store.get(self._db, id)
                if row is None or row.state != "taken":
                    continue  # ended some other way while the turn ran
                if row.attempts < MAX_RETRIES:
                    delay = timedelta(seconds=BACKOFF_S[row.attempts] if wait else 0)
                    store.set_backoff(self._db, [id], utc_text(now + delay), reason, resume=resume)
                else:
                    gave_up += store.set_gave_up(self._db, [id], reason, utc_text(now))
        self.on_change()
        self.ended(gave_up, "gave_up")

    def recover(self) -> int:
        """At start: each event a crashed turn held counts as a failed attempt by the retry
        rule (a crash loop ends in `gave_up`) and comes back with `resume`, ready at once (spec
        6.14). A clean stop already returned its events without an attempt. Returns how many
        came back as attempts."""
        with transaction(self._db):
            ids = store.recover_taken(self._db, utc_text(self._now()))
            # One that died before its turn saved its request comes back in full: its words
            # never reached the history.
            saved = store.saved(self._db, ids)
            self.backoff([i for i in ids if i in saved], "restart", wait=False)
            self.backoff([i for i in ids if i not in saved], "restart", resume=False, wait=False)
        return len(ids)

    def set_resume(self, ids: list[str]) -> None:
        """A stopped turn had saved some of its work: its events, back as `new`, are named as
        going on next time instead of told again (their words are in the history)."""
        with transaction(self._db):
            store.set_resume(self._db, ids)

    def sweep(self, keep_days: int) -> int:
        """Delete handled events older than `keep_days`; the rest are still owed or shown."""
        before = utc_text(self._now() - timedelta(days=keep_days))
        with transaction(self._db):
            return store.sweep(self._db, before)

    def gave_up(self) -> list[store.EventRow]:
        """Events Scout could not finish, not yet told: the next person turn hears of them."""
        return store.list_state(self._db, "gave_up")

    def next_retry(self) -> datetime | None:
        """When the soonest backing-off event is ready again; None when none waits."""
        text = store.next_not_before(self._db, utc_text(self._now()))
        return None if text is None else datetime.fromisoformat(text)

    def finish_matching(
        self, kind: str, source: str, state: str = "handled", *, keep: str | None = None
    ) -> list[str]:
        """End the waiting events of this kind and source, all but `keep`: stale news is never
        told. Returns the ids it ended."""
        with transaction(self._db):
            ids = [id for id in store.new_ids(self._db, kind, source) if id != keep]
            store.set_state(self._db, ids, state, end_reason=None, at=utc_text(self._now()))
        if ids:
            self.on_change()
        self.ended(ids, state)
        return ids

    def ended(self, ids: list[str], state: str) -> None:
        """Call each event's `on_end` once; a raising hook must not stop the others."""
        for id in ids:
            hook = self._on_end.pop(id, None)
            if hook is None:
                continue
            try:
                hook(state)
            except Exception:
                _log.exception("an event's on_end failed id=%s", id)

    def origin_body(self, id: str, is_body: Callable[[str], bool]) -> str | None:
        """The first source on the way back through `caused_by` that is a body."""
        return next((r.source for r in store.chain(self._db, id) if is_body(r.source)), None)
