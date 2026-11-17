"""The turn runner's choosing: which ready events Scout is told next, and on which body.
A person's words go first, then news oldest first; one turn takes every other ready event
for the same body, up to a cap. `pick` is pure: the gate and the target come in as callbacks,
so choosing never records a wake or spends a cap. `Runner.gate` is the pure check of when news
may be told; the wake it counts is recorded only by `record_take`, when a take succeeds.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from brain.bodies import Bodies
from brain.builtin_guards import WAKE_WINDOW_S
from brain.events import EVENT_KINDS, EventLog, is_internal
from brain.guards import EmitCtx, Hook
from brain.presence import Presence
from brain.store.events import EventRow

PERSON_KINDS = frozenset({"say", "card_answer"})
IDLE_WINDOW_S = 10  # idle news stays quiet this long after the person last spoke
GROUP_CAP = 20  # one turn tells at most this many events, so a long backlog cannot swamp it


@dataclass
class Pick:
    body: str
    events: list[EventRow]


def pick(
    ready: list[EventRow],
    target: Callable[[EventRow], str | None],
    gate: Callable[[EventRow], bool],
) -> Pick | None:
    """The next turn: the first event that has a body and an open gate, with the other open
    events for that body. The sort is stable, so equal times keep their saved order."""
    ordered = sorted(ready, key=lambda r: (r.kind not in PERSON_KINDS, r.at))
    open_for: list[tuple[str, EventRow]] = []
    for r in ordered:
        body = target(r)
        if body is not None and gate(r):
            open_for.append((body, r))
    if not open_for:
        return None
    body = open_for[0][0]
    events = [r for b, r in open_for if b == body][:GROUP_CAP]
    return Pick(body, events)


class Runner:
    def __init__(
        self,
        events: EventLog,
        presence: Presence,
        bodies: Bodies,
        session,
        now: Callable[[], datetime],
        guards,
        quiet: Callable[[datetime], bool] | None = None,
    ) -> None:
        self._events = events
        self._presence = presence
        self._bodies = bodies
        self._session = session
        self._now = now
        self._guards = guards
        self._quiet = quiet
        self._wakes: list[tuple[datetime, str]] = []  # (when, kind) of each news turn taken
        self._person_at: datetime | None = None

    def target(self, row: EventRow) -> str | None:
        """The body a turn for this event runs on, or None when no body displays (the event
        then waits). Only a body that displays is ever chosen: a reply sent to one that shows
        nothing is lost. A say answers where it was said, else where the person is, else the
        first screen. News goes where the person is, else back to the body that caused it,
        else the first screen."""
        shown = self._bodies.display_ids()
        using = self._presence.using_now()
        if row.kind in PERSON_KINDS:
            wanted = [row.source, using]
        else:
            origin = self._events.origin_body(row.id, lambda s: not is_internal(s))
            wanted = [using, origin]
        return next((b for b in wanted if b in shown), shown[0] if shown else None)

    def gate(self, row: EventRow) -> bool:
        """Whether this event may be told now. Pure: it never records a wake, so asking again
        and again for events that are not taken cannot use up a cap. A closed gate only waits;
        nothing is dropped here."""
        if row.kind in PERSON_KINDS:
            return True
        kind = EVENT_KINDS[row.kind]
        now = self._now()
        # A kind with no hourly cap (an expert's question) is never held for quiet hours.
        if kind.max_per_hour is not None and self._quiet is not None and self._quiet(now):
            return False
        if self._guards.run_sync(Hook.emit, EmitCtx(None, now, self._wakes)).code == "over_budget":
            return False
        if kind.urgency == "hold":
            return False
        if kind.urgency != "now" and self._presence.talking():
            return False
        if kind.urgency == "idle" and self._person_recent(now):
            return False
        if now - self._oldest_at(row) < timedelta(seconds=kind.batch_seconds or 0):
            return False
        return self._guards.run_sync(Hook.emit, EmitCtx(kind, now, self._wakes)).code != "held"

    def record_take(self, events: list[EventRow]) -> None:
        """A turn took these events: count one wake per capped kind, and note a person's turn.
        Called only on a successful take, so a closed or passed-over gate costs nothing."""
        now = self._now()
        self._wakes = [(t, k) for t, k in self._wakes if (now - t).total_seconds() < WAKE_WINDOW_S]
        kinds = {e.kind for e in events}
        self._wakes += [(now, k) for k in sorted(kinds) if EVENT_KINDS[k].max_per_hour is not None]
        if kinds & PERSON_KINDS:
            self._person_at = now

    def _person_recent(self, now: datetime) -> bool:
        return (
            self._person_at is not None and (now - self._person_at).total_seconds() < IDLE_WINDOW_S
        )

    def _oldest_at(self, row: EventRow) -> datetime:
        """When the oldest waiting event of this kind arrived: a batch opens then, and the newer
        events of the kind ride with it."""
        waiting = [r.at for r in self._events.ready() if r.kind == row.kind]
        return min(datetime.fromisoformat(at) for at in [row.at, *waiting])
