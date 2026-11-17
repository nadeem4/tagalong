"""The turn runner's choosing: which ready events Scout is told next, and on which body.
A person's words go first, then news oldest first; one turn takes every other ready event
for the same body, up to a cap. `pick` is pure: the gate and the target come in as callbacks,
so choosing never records a wake or spends a cap.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from brain.bodies import Bodies
from brain.events import EventLog, is_internal
from brain.presence import Presence
from brain.store.events import EventRow

PERSON_KINDS = frozenset({"say", "card_answer"})
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
    ) -> None:
        self._events = events
        self._presence = presence
        self._bodies = bodies
        self._session = session
        self._now = now
        self._guards = guards

    def target(self, row: EventRow) -> str | None:
        """The body a turn for this event runs on, or None when no body can show it (the event
        then waits). A say answers where it was said if that body displays, else where the
        person is. News goes where the person is, else back to the body that caused it."""
        shown = self._bodies.display_ids()
        using = self._presence.using_now()
        if row.kind in PERSON_KINDS:
            return row.source if row.source in shown else using
        if using is not None:
            return using
        origin = self._events.origin_body(row.id, lambda s: not is_internal(s))
        return origin if origin in shown else None
