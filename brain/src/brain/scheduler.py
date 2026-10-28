"""Scheduler for event wakes: holds events in per-kind batches and starts one turn at a time.
Facts come from outside (job reports, window titles), so the whole body is
fenced and cannot close its own <data> tag.

The scheduler never owns a turn; Session hands it `busy`, `last_body` and `start`, and calls
`turn_ended` so the next held batch can run.
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from brain.bodies import Bodies
from brain.config import DEFAULT_WAKES_PER_HOUR
from brain.events import EVENT_KINDS, Event, EventKind, load_notes
from brain.tools import _fence_safe

log = logging.getLogger("brain")


def wake_text(kind: EventKind, events: list[tuple[Event, datetime]], note: str) -> str:
    lines = [f"Event: {kind.name}", f"How to weigh it: {note}"]
    for event, at in events:
        lines.append(f"- at {at.strftime('%Y-%m-%d %H:%M %z')}")
        for name, value in event.facts.items():
            first, *rest = str(value).split("\n")
            lines.append(f"  {name}: {first}")
            lines.extend(f"    {r}" for r in rest)
    return f'<data kind="event">\n{_fence_safe(chr(10).join(lines))}\n</data>'


@dataclass
class _Group:
    kind: EventKind
    opened: datetime
    events: list[tuple[Event, datetime]] = field(default_factory=list)
    on_starts: list[Callable[[], None] | None] = field(default_factory=list)


class Scheduler:
    def __init__(
        self,
        *,
        bodies: Bodies,
        budget,
        busy: Callable[[], bool],
        last_body: Callable[[], str | None],
        start: Callable[[str, list], str],
        now: Callable[[], datetime],
        wakes_per_hour: int = DEFAULT_WAKES_PER_HOUR,
        kinds: dict[str, EventKind] = EVENT_KINDS,
        notes: dict[str, str] | None = None,
    ) -> None:
        self._bodies = bodies
        self._budget = budget  # used by the caps and budget drop, added on top of this queue
        self._busy = busy
        self._last_body = last_body
        self._start = start
        self._now = now
        self._wakes_per_hour = wakes_per_hour
        self._kinds = kinds
        self._notes = load_notes() if notes is None else notes
        self._groups: list[_Group] = []  # oldest first
        self._latest: dict[str, dict[str, Event]] = {}
        self._timer: asyncio.TimerHandle | None = None

    def emit(self, event: Event, *, on_start: Callable[[], None] | None = None) -> None:
        kind = self._kinds.get(event.kind)
        if kind is None or not kind.enabled:
            log.warning("dropped event of unknown or disabled kind %r", event.kind)
            return
        if not kind.wakes:
            self._latest.setdefault(kind.name, {})[event.key or ""] = event
            return
        now = self._now()
        group = None
        if kind.batch_seconds is not None:  # a held group of the kind absorbs the event
            group = next((g for g in self._groups if g.kind is kind), None)
        if group is None:
            group = _Group(kind, now)
            self._groups.append(group)
        if event.key is not None:
            for i, (old, _) in enumerate(group.events):
                if old.key == event.key:
                    del group.events[i], group.on_starts[i]
                    break
        group.events.append((event, now))
        group.on_starts.append(on_start)
        self.pump()

    def pump(self) -> None:
        if self._groups and not self._busy():
            group = next((g for g in self._groups if self._remaining(g) <= 0), None)
            body_id = self._choose_body() if group is not None else None
            if group is not None and body_id is not None:
                self._groups.remove(group)
                text = wake_text(group.kind, group.events, self._notes.get(group.kind.name, ""))
                self._start(body_id, [{"type": "text", "text": text}])
                for on_start in group.on_starts:  # after the start, so a failed start stays untold
                    if on_start is not None:
                        on_start()
        self._arm_timer()

    def turn_ended(self, turn_id: str) -> None:
        self.pump()

    def next_due(self) -> float | None:
        if not self._groups:
            return None
        return max(0.0, min(self._remaining(g) for g in self._groups))

    def latest(self, kind: str) -> dict[str, Event]:
        return dict(self._latest.get(kind, {}))

    def _remaining(self, group: _Group) -> float:
        wait = group.kind.batch_seconds or 0
        return wait - (self._now() - group.opened).total_seconds()

    def _choose_body(self) -> str | None:
        last = self._last_body()
        if last is not None and self._bodies.is_online(last):
            return last
        online = self._bodies.online_ids()
        return online[0] if online else None  # none: the next connect retries

    def _arm_timer(self) -> None:
        # Only a batch still waiting on time needs a timer; busy and no-body groups are
        # woken by turn_ended and by a body connecting.
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        waits = [r for g in self._groups if (r := self._remaining(g)) > 0]
        if not waits:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # before the server starts there is no loop; emit re-arms later
            return
        self._timer = loop.call_later(min(waits), self.pump)
