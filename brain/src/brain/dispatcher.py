"""The front door: everything that wants Scout's attention is posted here with an urgency, and
this one module decides when it is told, who tells it and when it is held instead.

Urgency comes from the event kind (events.py), never from the payload or the model. `now` goes
at once, `next_pause` at a sentence break or when speech is idle, `idle` only when speech is idle
and no conversation is active, `hold` is kept as an open item. A kind nobody registered is
refused, so no source can bypass the rules by inventing one.

Past that gate a waking kind is batched per kind (`batch_seconds`), capped per hour, and started
as one wake turn on a body that can show it, one turn at a time. Words and card answers are
handed to `deliver` instead. Nothing is dropped silently: when the budget is spent, in quiet
hours, once an item has waited too long (no body, a person away), when a delivery gives up and
when the brain stops, the news becomes a `held` open item that shows on return and on Home.
Facts come from outside (job reports, window titles), so a wake's body is fenced and cannot
close its own <data> tag. Each item may carry hooks: on_start (its wake began), on_drop (it was
held), on_end (its turn ended, told how: news is marked told only on `done`).
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from datetime import datetime

from brain.bodies import Bodies
from brain.events import EVENT_KINDS, Event, EventKind, Urgency, load_notes
from brain.guards import EmitCtx, Guards, Hook
from brain.open_items import OpenItems
from brain.tools import _fence_safe

RETRY_S = 2.0  # wait before delivering again after a delivery failed
MAX_FAILS = 3  # a delivery that fails this often is held and given up
STALE_S = 7200  # a wake that has waited this long (no body, a person away) is held, not told late
_WINDOW = 3600  # seconds in the rolling cap window

_log = logging.getLogger("brain.dispatcher")
_RANK: dict[str, int] = {"now": 0, "next_pause": 1, "idle": 2, "hold": 3}

_Cb = Callable[[], None] | None


class WakeSkipped(Exception):
    """Raised by the start callback when a wake cannot run (no key): dropped without a log."""


@dataclass(frozen=True)
class Item:
    kind: str
    # The body it came from ("brain" when none did): its reply is shown there.
    origin_body: str
    payload: dict
    # Replaced by the kind's own urgency on post; kept so a delivery can read it.
    urgency: Urgency
    # A newer waiting item with the same kind and key replaces the older one.
    key: str | None = None
    # Run in this process only, never saved with a held item.
    on_start: _Cb = field(default=None, compare=False)
    on_drop: _Cb = field(default=None, compare=False)
    on_end: Callable[[str], None] | None = field(default=None, compare=False)


@dataclass
class _Entry:
    rank: int
    seq: int
    item: Item
    fails: int = 0


@dataclass
class _Group:
    kind: EventKind
    opened: datetime
    items: list[Item] = field(default_factory=list)


def wake_text(kind: EventKind, items: list[Item], note: str, at: datetime) -> str:
    lines = [f"Event: {kind.name}", f"How to weigh it: {note}"]
    for item in items:
        lines.append(f"- at {at.strftime('%Y-%m-%d %H:%M %z')}")
        for name, value in item.payload.items():
            first, *rest = str(value).split("\n")
            lines.append(f"  {name}: {first}")
            lines.extend(f"    {r}" for r in rest)
    return f'<data kind="event">\n{_fence_safe(chr(10).join(lines))}\n</data>'


def _label(item: Item) -> str:
    return f"{item.kind}:{item.key}"


class Dispatcher:
    def __init__(
        self,
        deliver: Callable[[Item], Awaitable[None]],
        open_items: OpenItems,
        *,
        bodies: Bodies,
        guards: Guards,
        busy: Callable[[], bool],
        last_body: Callable[[], str | None],
        start: Callable[[str, list], str],
        now: Callable[[], datetime],
        gave_up: Callable[[Item], None] | None = None,
        quiet: Callable[[datetime], bool] | None = None,
        kinds: dict[str, EventKind] = EVENT_KINDS,
        notes: dict[str, str] | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.deliver = deliver  # for the kinds that never wake: a say, a card answer
        self._open_items = open_items
        self._bodies = bodies
        self._guards = guards
        self._busy = busy
        self._last_body = last_body
        self._start = start
        self._now = now
        self._gave_up = gave_up
        self._quiet = quiet
        self._kinds = kinds
        self._notes = load_notes() if notes is None else notes
        self._sleep = sleep
        self._queue: asyncio.Queue[_Entry] = asyncio.Queue()
        self._waiting: list[_Entry] = []  # past the post, not yet through the gate
        self._inflight: list[_Entry] = []
        self._groups: list[_Group] = []  # through the gate, waiting on batch, cap, a turn or a body
        self._latest: dict[str, dict[str, Event]] = {}
        self._wakes: list[tuple[datetime, str]] = []  # capped wakes in the rolling hour
        self._on_ends: dict[str, list[Callable[[str], None]]] = {}  # by the turn id start returned
        self._seq = 0
        self._state = "idle"
        self._conversation = False
        self._changed = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._timer: asyncio.TimerHandle | None = None

    def post(self, item: Item) -> None:
        """Queue an item. Its kind decides its urgency; an unregistered kind raises."""
        kind = self._kinds.get(item.kind)
        if kind is None:
            raise ValueError(f"unregistered kind {item.kind!r}")
        if not kind.enabled:
            _log.warning("dropped item of disabled kind %r", item.kind)
            return
        item = replace(item, urgency=kind.urgency)
        self.start()  # a source may post before the server's loop ran
        if kind.urgency == "hold":
            self._hold(item, "held_kind")
            return
        self._seq += 1
        self._queue.put_nowait(_Entry(_RANK[kind.urgency], self._seq, item))
        self._changed.set()

    def record(self, event: Event) -> None:
        """Keep the latest context event of a kind that never wakes (focus, tab, download)."""
        self._latest.setdefault(event.kind, {})[event.key or ""] = event

    def latest(self, kind: str) -> dict[str, Event]:
        return dict(self._latest.get(kind, {}))

    def drop(self, kind: str, key: str) -> None:
        """Forget a waiting item of that kind and key (its news is superseded); no hook runs."""
        self._intake()
        self._waiting = [
            w for w in self._waiting if not (w.item.kind == kind and w.item.key == key)
        ]
        kind_obj = self._kinds.get(kind)
        if kind_obj is not None:
            self._replace_held(kind_obj, key)
            self.pump()

    def set_speech_state(self, state: str) -> None:
        """`talking`, `sentence_break`, `paused` or `idle`, as the mouth reports it."""
        self._state = state
        self._changed.set()

    def set_conversation_active(self, active: bool) -> None:
        self._conversation = active
        self._changed.set()

    def start(self) -> None:
        """Begin delivering. Safe to call again, and a no-op until a loop is running."""
        if self._task is not None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # items wait in the queue until a post or start finds a loop
        self._task = loop.create_task(self._run())

    async def stop(self) -> None:
        """End delivering. What is left waiting is held as open items, never lost."""
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None
        left = [e.item for e in self._inflight + self._waiting]
        while not self._queue.empty():
            left.append(self._queue.get_nowait().item)
        left += [i for g in self._groups for i in g.items]
        self._inflight, self._waiting, self._groups = [], [], []
        for item in left:
            self._hold(item, "stopped")
            self._tell_gave_up(item)

    # The hold: news that cannot be told now is kept where the person will see it.

    def _hold(self, item: Item, why: str) -> None:
        # Scalars only: the payload may carry futures or a person's words, never saved here.
        facts = {k: v for k, v in item.payload.items() if isinstance(v, str | int | float | bool)}
        saved = {"event": item.kind, "key": item.key, "why": why, "facts": facts}
        try:
            self._open_items.open("held", item.origin_body, saved_call=saved)
        except Exception:
            _log.exception("dispatcher.hold_failed item=%s why=%s", _label(item), why)
            return
        _log.info("dispatcher.held item=%s why=%s", _label(item), why)

    def _hold_group(self, group: _Group, why: str) -> None:
        for item in group.items:
            self._hold(item, why)
        self._call([i.on_drop for i in group.items], "on_drop", f"{group.kind.name} wake")

    def _give_up(self, item: Item) -> None:
        _log.error("dispatcher.gave_up item=%s", _label(item))
        self._hold(item, "gave_up")
        self._tell_gave_up(item)

    def _tell_gave_up(self, item: Item) -> None:
        if self._gave_up is None:
            return
        try:
            self._gave_up(item)
        except Exception:
            _log.exception("dispatcher.gave_up_callback_failed item=%s", _label(item))

    def _hold_groups(self) -> None:
        if not self._groups:
            return
        now = self._now()
        why = None
        if self._guards.run_sync(Hook.emit, EmitCtx(None, now, self._wakes)).code == "over_budget":
            why = "budget_spent"
        elif self._quiet is not None and self._quiet(now):
            why = "quiet_hours"
        for group in list(self._groups):
            reason = why or ("stale" if (now - group.opened).total_seconds() > STALE_S else None)
            if reason is not None:
                self._groups.remove(group)
                self._hold_group(group, reason)

    # The gate: when an item may be told, by speech state.

    def _can_deliver(self, urgency: str) -> bool:
        if urgency == "now":
            return True
        if urgency == "next_pause":
            return self._state in ("sentence_break", "idle")
        return self._state == "idle" and not self._conversation

    def _intake(self) -> None:
        while not self._queue.empty():
            e = self._queue.get_nowait()
            if e.item.key is not None:
                self._waiting = [
                    w
                    for w in self._waiting
                    if not (w.item.kind == e.item.kind and w.item.key == e.item.key)
                ]
            self._waiting.append(e)
        self._waiting.sort(key=lambda w: (w.rank, w.seq))

    async def _run(self) -> None:
        while True:
            self._changed.clear()
            self._intake()
            ready = [w for w in self._waiting if self._can_deliver(w.item.urgency)]
            if not ready:
                await self._changed.wait()
                continue
            self._waiting = [w for w in self._waiting if w not in ready]
            self._inflight = ready
            failed = False
            while self._inflight:
                w = self._inflight[0]
                if self._kinds[w.item.kind].wakes:
                    self._stage(w.item)
                else:
                    try:
                        await self.deliver(w.item)
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        _log.exception("dispatcher.deliver_failed item=%s", _label(w.item))
                        failed = True
                        w.fails += 1
                        if w.fails >= MAX_FAILS:
                            self._give_up(w.item)
                        else:
                            self._waiting.append(w)  # back in, original order kept by the sort
                self._inflight.pop(0)
            self._waiting.sort(key=lambda w: (w.rank, w.seq))
            self.pump()
            if failed:
                await self._sleep(RETRY_S)

    # The wake: batch per kind, cap per hour, one turn at a time, on a body that can show it.

    def _stage(self, item: Item) -> None:
        kind = self._kinds[item.kind]
        group = None
        if kind.batch_seconds is not None:  # a waiting group of the kind absorbs the item
            group = next((g for g in self._groups if g.kind is kind), None)
        if item.key is not None:  # a never-merged kind holds each item in its own group
            self._replace_held(kind, item.key)
        if group is None or group not in self._groups:
            group = _Group(kind, self._now())
            self._groups.append(group)
        group.items.append(item)

    def _replace_held(self, kind: EventKind, key: str) -> None:
        for group in self._groups:
            if group.kind is not kind:
                continue
            for i, old in enumerate(group.items):
                if old.key == key:
                    del group.items[i]
                    if not group.items:
                        self._groups.remove(group)
                    return

    def pump(self) -> None:
        """Hold what must not be told, then start the next wake that is due. Run again by the
        session when a turn ends or a body connects."""
        try:
            self._hold_groups()
            if self._groups and not self._busy():
                group = next((g for g in self._groups if self._remaining(g) <= 0), None)
                body_id = self._choose_body(group) if group is not None else None
                if group is not None and body_id is not None:
                    self._groups.remove(group)
                    self._run_group(group, body_id)
        finally:
            self._arm_timer()

    def _run_group(self, group: _Group, body_id: str) -> None:
        # A raising start must not propagate: pump runs from done callbacks and body connects.
        # The batch is held so a broken start cannot loop; with no key it is dropped quietly,
        # and unreported jobs re-emit at the next brain start.
        if group.kind.max_per_hour is not None:
            self._wakes.append((self._now(), group.kind.name))
        text = wake_text(group.kind, group.items, self._notes.get(group.kind.name, ""), self._now())
        try:
            turn_id = self._start(body_id, [{"type": "text", "text": text}])
        except WakeSkipped:
            self._call([i.on_drop for i in group.items], "on_drop", f"{group.kind.name} wake")
            return
        except Exception:
            _log.exception("could not start a %s wake", group.kind.name)
            self._hold_group(group, "start_failed")
            return
        ends = [i.on_end for i in group.items if i.on_end is not None]
        if ends:
            self._on_ends[turn_id] = ends
        # after the start, so a failed start stays untold
        self._call([i.on_start for i in group.items], "on_start", f"{group.kind.name} wake")

    def turn_ended(self, turn_id: str, reason: str = "done") -> None:
        self._call(self._on_ends.pop(turn_id, []), "on_end", "wake turn", reason)
        self.pump()

    @staticmethod
    def _call(hooks: list, name: str, label: str, *args: str) -> None:
        for hook in hooks:
            if hook is not None:
                try:
                    hook(*args)
                except Exception:
                    _log.exception("%s failed for a %s", name, label)

    def _remaining(self, group: _Group) -> float:
        wait = group.kind.batch_seconds or 0
        batch = wait - (self._now() - group.opened).total_seconds()
        return max(batch, self._cap_wait(group.kind))

    def _cap_wait(self, kind: EventKind) -> float:
        # Seconds until enough recorded wakes age out of the window; 0 when under both caps.
        now = self._now()
        self._wakes = [(t, k) for t, k in self._wakes if (now - t).total_seconds() < _WINDOW]
        verdict = self._guards.run_sync(Hook.emit, EmitCtx(kind, now, self._wakes))
        return verdict.value if verdict.code == "held" else 0.0

    def _choose_body(self, group: _Group) -> str | None:
        shown = self._bodies.display_ids()  # screens first, a phone chat last
        for item in group.items:  # the body it came from answers it
            if item.origin_body in shown:
                return item.origin_body
        last = self._last_body()
        # A phone chat is not interrupted by a timer or held mail while a screen is online.
        if last in shown and (last == shown[0] or not self._bodies.is_phone(last)):
            return last
        return shown[0] if shown else None  # none: the next connect retries

    def _arm_timer(self) -> None:
        # Only a group still waiting on time (batch, cap or going stale) needs a timer; busy and
        # no-body groups are woken by turn_ended and by a body connecting.
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        waits = [r for g in self._groups if (r := self._remaining(g)) > 0]
        waits += [STALE_S - (self._now() - g.opened).total_seconds() + 1 for g in self._groups]
        waits = [w for w in waits if w > 0]
        if not waits:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # before the server starts there is no loop; a post re-arms later
            return
        self._timer = loop.call_later(min(waits), self.pump)
