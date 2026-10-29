"""Scheduler for event wakes: holds events in per-kind batches and starts one turn at a time.
Facts come from outside (job reports, window titles), so the whole body is
fenced and cannot close its own <data> tag.

The scheduler never owns a turn; Session hands it `busy`, `last_body` and `start`, and calls
`turn_ended` so the next held batch can run. Each event may carry three hooks: on_start (the
wake began), on_drop (the budget was spent, so it never will) and on_end (its turn ended).
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
_WINDOW = 3600  # seconds in the rolling cap window


def wake_text(kind: EventKind, events: list[tuple[Event, datetime]], note: str) -> str:
    lines = [f"Event: {kind.name}", f"How to weigh it: {note}"]
    for event, at in events:
        lines.append(f"- at {at.strftime('%Y-%m-%d %H:%M %z')}")
        for name, value in event.facts.items():
            first, *rest = str(value).split("\n")
            lines.append(f"  {name}: {first}")
            lines.extend(f"    {r}" for r in rest)
    return f'<data kind="event">\n{_fence_safe(chr(10).join(lines))}\n</data>'


_Hook = Callable[[], None] | None
_Hooks = tuple[_Hook, _Hook, _Hook]  # on_start, on_drop, on_end


@dataclass
class _Group:
    kind: EventKind
    opened: datetime
    events: list[tuple[Event, datetime]] = field(default_factory=list)
    hooks: list[_Hooks] = field(default_factory=list)  # parallel to events


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
        self._budget = budget
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
        self._wakes: list[tuple[datetime, str]] = []  # capped wakes in the rolling hour
        self._on_ends: dict[str, list[Callable[[], None]]] = {}  # by the turn id start returned

    def emit(
        self,
        event: Event,
        *,
        on_start: _Hook = None,
        on_drop: _Hook = None,
        on_end: _Hook = None,
    ) -> None:
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
        if event.key is not None:  # a never-merged kind holds each event in its own group
            self._replace_held(kind, event.key)
        if group is None or group not in self._groups:
            group = _Group(kind, now)
            self._groups.append(group)
        group.events.append((event, now))
        group.hooks.append((on_start, on_drop, on_end))
        self.pump()

    def _replace_held(self, kind: EventKind, key: str) -> None:
        for group in self._groups:
            if group.kind is not kind:
                continue
            for i, (old, _) in enumerate(group.events):
                if old.key == key:
                    del group.events[i], group.hooks[i]
                    if not group.events:
                        self._groups.remove(group)
                    return

    def pump(self) -> None:
        try:
            if self._groups and not self._budget.allows():
                self._drop_all()
            if self._groups and not self._busy():
                group = next((g for g in self._groups if self._remaining(g) <= 0), None)
                body_id = self._choose_body() if group is not None else None
                if group is not None and body_id is not None:
                    self._groups.remove(group)
                    self._run(group, body_id)
        finally:
            self._arm_timer()

    def _run(self, group: _Group, body_id: str) -> None:
        # A raising start must not propagate: pump runs from done callbacks and body
        # connects. The batch is dropped so a broken start cannot loop; unreported jobs
        # re-emit at the next brain start.
        if group.kind.max_per_hour is not None:
            self._wakes.append((self._now(), group.kind.name))
        text = wake_text(group.kind, group.events, self._notes.get(group.kind.name, ""))
        try:
            turn_id = self._start(body_id, [{"type": "text", "text": text}])
        except Exception:
            log.exception("could not start a %s wake", group.kind.name)
            return
        ends = [h[2] for h in group.hooks if h[2] is not None]
        if ends:
            self._on_ends[turn_id] = ends
        # after the start, so a failed start stays untold
        self._call([h[0] for h in group.hooks], "on_start", group.kind)

    def turn_ended(self, turn_id: str) -> None:
        self._call(self._on_ends.pop(turn_id, []), "on_end", None)
        self.pump()

    @staticmethod
    def _call(hooks: list, name: str, kind: EventKind | None) -> None:
        for hook in hooks:
            if hook is not None:
                try:
                    hook()
                except Exception:
                    log.exception("%s failed for a %s wake", name, kind.name if kind else "")

    def next_due(self) -> float | None:
        if not self._groups:
            return None
        return max(0.0, min(self._remaining(g) for g in self._groups))

    def latest(self, kind: str) -> dict[str, Event]:
        return dict(self._latest.get(kind, {}))

    def _remaining(self, group: _Group) -> float:
        wait = group.kind.batch_seconds or 0
        batch = wait - (self._now() - group.opened).total_seconds()
        return max(batch, self._cap_wait(group.kind))

    def _cap_wait(self, kind: EventKind) -> float:
        # Seconds until enough recorded wakes age out of the window; 0 when under both caps.
        if kind.max_per_hour is None:
            return 0.0
        now = self._now()
        self._wakes = [(t, k) for t, k in self._wakes if (now - t).total_seconds() < _WINDOW]
        waits = [0.0]
        for times, cap in (
            ([t for t, k in self._wakes if k == kind.name], kind.max_per_hour),
            ([t for t, _ in self._wakes], self._wakes_per_hour),
        ):
            if len(times) >= cap:
                oldest_blocking = times[len(times) - cap]
                waits.append(_WINDOW - (now - oldest_blocking).total_seconds())
        return max(waits)

    def _drop_all(self) -> None:
        for group in self._groups:
            log.warning("budget spent, dropped %d %s event(s)", len(group.events), group.kind.name)
        groups, self._groups = self._groups, []
        for group in groups:
            self._call([h[1] for h in group.hooks], "on_drop", group.kind)

    def _choose_body(self) -> str | None:
        last = self._last_body()
        if last is not None and self._bodies.is_online(last):
            return last
        online = self._bodies.online_ids()
        return online[0] if online else None  # none: the next connect retries

    def _arm_timer(self) -> None:
        # Only a group still waiting on time (batch or cap) needs a timer; busy and no-body
        # groups are woken by turn_ended and by a body connecting.
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
