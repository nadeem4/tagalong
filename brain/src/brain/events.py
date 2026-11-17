"""Event kinds Scout can be woken by, the notes on how to weigh each, and the durable log.
A kind is data (batching, caps); the note is wording for the model, kept in
mind/events.md so code stays free of canned lines. `EventLog` saves every event that must
survive a restart (masked) before anything acts on it.
"""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from functools import cache
from importlib.resources import files
from typing import Literal
from uuid import uuid4

from pydantic import ValidationError

from brain.masking import Masker
from brain.protocol import BackData, DownloadData, FocusData, TabData
from brain.store import events as store
from brain.store.db import transaction, utc_text

BRAIN = "brain"  # the origin of an item no body started


@dataclass(frozen=True)
class Event:
    kind: str
    # A body id, `timer`, `setup`, `scout`, or a prefixed source (`job:<id>`, `loop:<app>`,
    # `tool:<name>`).
    source: str
    payload: dict
    caused_by: str | None = None
    # Not compared: two reports of the same fact are equal even though each has its own id.
    id: str = field(default_factory=lambda: uuid4().hex, compare=False)
    at: datetime | None = None
    # A newer pending event with the same kind and key replaces the older one (until T1c).
    key: str | None = None
    # The body it came from, "brain" when none did: its wake turn is shown there if it can.
    origin_body: str = BRAIN


Urgency = Literal["now", "next_pause", "idle", "hold"]


@dataclass(frozen=True)
class EventKind:
    name: str
    # When the dispatcher may hand this kind to Scout. Code sets it per kind; neither the
    # model nor an item's payload can raise it (see dispatcher.py).
    urgency: Urgency = "idle"
    wakes: bool = True
    enabled: bool = True
    # None: never merged, one wake per event.
    batch_seconds: int | None = 0
    # None: exempt from the per-kind and the global cap.
    max_per_hour: int | None = None


_KINDS = (
    # Items the dispatcher delivers itself (a person's words, a card answer), never a wake.
    EventKind("say", urgency="now", wakes=False),
    EventKind("card_answer", urgency="now", wakes=False),
    EventKind("timer", urgency="next_pause", batch_seconds=0, max_per_hour=6),
    EventKind("watches_paused", urgency="idle", batch_seconds=0, max_per_hour=2),
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
            return Event("back", body_id, facts, key=f"back:{body_id}")
        if name == "focus":
            focus = FocusData.model_validate(data)
            facts = {"body": body_id, "app": focus.app, "title": focus.title[:200]}
            return Event("focus", body_id, facts, key=body_id)
        if name == "tab":
            tab = TabData.model_validate(data)
            facts = {"body": body_id, "title": tab.title[:200], "url": tab.url[:300]}
            return Event("tab", body_id, facts, key=body_id)
        if name == "download":
            dl = DownloadData.model_validate(data)
            facts = {"body": body_id, "name": dl.name[:200], "state": dl.state}
            return Event("download", body_id, facts, key=body_id)
        if name == "ask_closed":
            # The answer or tap met a question the brain no longer holds.
            if isinstance(data, dict) and data.get("via") in ("tap", "answer"):
                return Event(
                    "ask_closed",
                    body_id,
                    {"body": body_id, "via": data["via"]},
                    key=f"ask_closed:{body_id}",
                )
        if name == "many_pending":
            asks = data.get("asks") if isinstance(data, dict) else None
            if isinstance(asks, int) and not isinstance(asks, bool) and asks > 1:
                return Event(
                    "many_pending",
                    body_id,
                    {"body": body_id, "asks": asks},
                    key=f"many_pending:{body_id}",
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
        key=f"body_online:{body_id}",
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

_INTERNAL_SOURCES = frozenset({"timer", "setup", "scout"})


def is_internal(source: str) -> bool:
    """True when Scout's own machinery posted it, false for a body id."""
    return source in _INTERNAL_SOURCES or ":" in source


class EventLog:
    """The durable in queue: every input is saved here first, masked, then acted on."""

    def __init__(self, db: sqlite3.Connection, masker: Masker, now: Callable[[], datetime]) -> None:
        self._db = db
        self._masker = masker
        self._now = now

    def post(
        self, event: Event, *, then: Callable[[sqlite3.Connection], None] | None = None
    ) -> bool:
        """Save the event; False when its id is already known (a retried say is one event).

        `then` runs in the same transaction, so a failure leaves no row behind.
        """
        if event.kind not in EVENT_KINDS:
            raise ValueError(f"unknown event kind {event.kind!r}")
        if event.kind not in SAVED_KINDS:
            return True
        payload = json.loads(self._masker.mask(json.dumps(event.payload)))
        at = utc_text(event.at or self._now())
        row = store.EventRow(
            id=event.id,
            kind=event.kind,
            at=at,
            source=event.source,
            caused_by=event.caused_by,
            payload=payload,
        )
        with transaction(self._db):
            if not store.insert(self._db, row):
                return False
            if then is not None:
                then(self._db)
        return True

    def get(self, id: str) -> store.EventRow | None:
        return store.get(self._db, id)

    def ready(self) -> list[store.EventRow]:
        return store.list_new(self._db, utc_text(self._now()))

    def take(self, ids: list[str], turn_id: str) -> list[str]:
        with transaction(self._db):
            return store.set_taken(self._db, ids, turn_id)

    def finish(self, ids: list[str], state: str, end_reason: str | None = None) -> None:
        with transaction(self._db):
            store.set_state(self._db, ids, state, end_reason=end_reason, at=utc_text(self._now()))

    def origin_body(self, id: str, is_body: Callable[[str], bool]) -> str | None:
        """The first source on the way back through `caused_by` that is a body."""
        return next((r.source for r in store.chain(self._db, id) if is_body(r.source)), None)
