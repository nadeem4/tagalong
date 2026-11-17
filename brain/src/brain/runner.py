"""The turn runner: the only thing that starts a Scout turn, one at a time.
A person's words go first, then news oldest first; one turn takes every other ready event for
the same body, up to a cap. `pick` is pure: the gate and the target come in as callbacks, so
choosing never records a wake or spends a cap; the wake is counted by `record_take`. A say on
the running turn's body joins it at its next step (`take_more`); next-pause news is told at a
sentence break, by an interjection first. A turn's events end with it, or wait again.
"""

import asyncio
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, tzinfo
from typing import Protocol

from brain.bodies import Bodies
from brain.builtin_guards import WAKE_WINDOW_S
from brain.events import EVENT_KINDS, EventKind, EventLog, is_internal, load_notes
from brain.guards import EmitCtx, Hook
from brain.presence import Presence
from brain.store.events import EventRow
from brain.tools import _fence_safe

_log = logging.getLogger(__name__)

PERSON_KINDS = frozenset({"say", "card_answer"})
IDLE_WINDOW_S = 10  # idle news stays quiet this long after the person last spoke
GROUP_CAP = 20  # one turn tells at most this many events, so a long backlog cannot swamp it
RECHECK_S = 60.0  # news behind a closed gate is looked at again at least this often


@dataclass
class Pick:
    body: str
    events: list[EventRow]


def _order(r: EventRow) -> tuple[bool, str]:
    return (r.kind not in PERSON_KINDS, r.at)


def pick(
    ready: list[EventRow],
    target: Callable[[EventRow], str | None],
    gate: Callable[[EventRow], bool],
) -> Pick | None:
    """The next turn: the first event that has a body and an open gate, with the other open
    events for that body. The sort is stable, so equal times keep their saved order."""
    open_for: list[tuple[str, EventRow]] = []
    for r in sorted(ready, key=_order):
        body = target(r)
        if body is not None and gate(r):
            open_for.append((body, r))
    if not open_for:
        return None
    body = open_for[0][0]
    events = [r for b, r in open_for if b == body][:GROUP_CAP]
    return Pick(body, events)


def wake_text(kind: EventKind, rows: list[EventRow], note: str, tz: tzinfo | None) -> str:
    """The facts of a batch of one kind, fenced as data: the model reads them, never obeys them."""
    lines = [f"Event: {kind.name}", f"How to weigh it: {note}"]
    for row in rows:
        at = datetime.fromisoformat(row.at).astimezone(tz)
        lines.append(f"- at {at.strftime('%Y-%m-%d %H:%M %z')}")
        for name, value in (row.payload or {}).items():
            first, *rest = str(value).split("\n")
            lines.append(f"  {name}: {first}")
            lines.extend(f"    {r}" for r in rest)
    return f'<data kind="event">\n{_fence_safe(chr(10).join(lines))}\n</data>'


class TurnHost(Protocol):
    """What the runner needs of the session."""

    def ready(self) -> bool: ...  # a model can answer (a key is set)

    # `retry`: the rows an errored turn already sent; their words are in history already.
    def start_events(
        self, turn_id: str, body: str, rows: list[EventRow], retry: set[str]
    ) -> None: ...

    def cancel_turn(self) -> None: ...

    async def interject(self, body: str, content: list) -> bool: ...


@dataclass
class _Turn:
    id: str
    body: str


class Runner:
    def __init__(
        self,
        events: EventLog,
        presence: Presence,
        bodies: Bodies,
        session: TurnHost,
        now: Callable[[], datetime],
        guards,
        quiet: Callable[[datetime], bool] | None = None,
        kinds: dict[str, EventKind] = EVENT_KINDS,
    ) -> None:
        self._events = events
        self._presence = presence
        self._bodies = bodies
        self._session = session
        self._now = now
        self._guards = guards
        self._quiet = quiet
        self._kinds = kinds
        self.notes = load_notes()  # per-kind notes for the wake text; the session reads them too
        self._wakes: list[tuple[datetime, str]] = []  # (when, kind) of each news turn taken
        self._person_at: datetime | None = None
        self._turn: _Turn | None = None  # the running turn
        self._taken: dict[str, list[str]] = {}  # turn id -> the events it took
        # Events of an errored turn wait for something new, else a failing model would be asked
        # again and again. In memory, so a restart tries them once more.
        self._held: set[str] = set()
        # Events an errored turn already sent: the next turn names them as a retry instead of
        # sending their words again, since the failed request stays in the history.
        self._retried: set[str] = set()
        self._tried: set[str] = set()  # next-pause news an interjection already tried
        self._interjecting: tuple[asyncio.Task, list[str]] | None = None
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._alarm: asyncio.TimerHandle | None = None
        self._stopped = False
        events.on_post = self.poke
        presence.on_change = self.poke

    def start(self) -> None:
        """Start the loop; a no-op until an event loop runs (a poke starts it then)."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._task is None and not self._stopped:
            self._task = loop.create_task(self._loop())
        self._wake.set()

    def poke(self) -> None:
        """Something changed (an event, a turn end, speech, a body): look again."""
        if self._stopped:
            return
        if self._task is None:
            self.start()
        self._wake.set()

    async def stop(self) -> None:
        """The brain is closing: the running turn's events go back to `new` (no attempt), so a
        quit never loses a say, and their hooks hear it; then the turn is cancelled."""
        self._stopped = True
        if self._alarm is not None:
            self._alarm.cancel()
        turn, self._turn = self._turn, None
        if turn is not None:
            ids = self._taken.pop(turn.id, [])
            self._events.finish(ids, "new")
            self._events.ended(ids, "new")
            self._session.cancel_turn()
        tasks = [t for t in (self._task, self._interjecting and self._interjecting[0]) if t]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def adopt(self, turn_id: str, body: str, ids: list[str]) -> None:
        """A turn the session started itself (the person spoke over Scout) took these events."""
        self._taken[turn_id] = self._events.take(ids, turn_id)
        self._turn = _Turn(turn_id, body)
        self._person_at = self._now()

    def turn_ended(self, turn_id: str, reason: str) -> None:
        """A finished, cancelled, rejected or over-budget turn handled its events: the person
        was answered or told why not, and the same request would fail the same way again. Any
        other end (an error) puts them back, held until something new or the recheck."""
        if self._stopped:
            return  # the cancel the stop caused: stop already put them back
        ids = self._taken.pop(turn_id, [])
        if reason in ("done", "cancelled", "rejected", "over_budget"):
            self._events.finish(ids, "handled", end_reason=reason)
        else:
            self._events.finish(ids, "new")
            self._held.update(ids)
            self._retried.update(ids)
        if self._turn is not None and self._turn.id == turn_id:
            self._turn = None
        self.poke()

    def take_more(self) -> list[EventRow]:
        """The person's new words for the running turn's body, taken into it at its next step."""
        turn = self._turn
        if turn is None:
            return []
        rows = [
            r
            for r in self._events.ready()
            if r.kind == "say"
            and r.id not in self._held | self._retried
            and self.target(r) == turn.body
        ]
        taken = set(self._events.take([r.id for r in rows], turn.id))
        rows = [r for r in rows if r.id in taken]
        if not rows:
            return []
        self._taken.setdefault(turn.id, []).extend(r.id for r in rows)
        self.record_take(rows)
        self._bodies.notify(
            "turn",
            {
                "turn": turn.id,
                "body": turn.body,
                "state": "joined",
                "events": [r.id for r in rows],
                "source": rows[0].source,
            },
        )
        return rows

    async def _loop(self) -> None:
        while True:
            await self._wake.wait()
            self._wake.clear()
            try:
                self._step()
            except Exception:
                _log.exception("runner step failed")

    def _step(self) -> None:
        if self._alarm is not None:
            self._alarm.cancel()
            self._alarm = None
        if self._interjecting is None and self._presence.at_break() and self._interject():
            return
        if self._turn is not None:
            return
        # Read once: a break latched while no news waited for it is spent here, so it cannot
        # let later news cut a sentence.
        at_break = self._presence.break_seen()
        ready = self._release_questions(self._events.ready())
        # Held and retried ids are never taken, so they are all `new`: one that is not ready
        # was ended some other way (by id, as stale news, by an interjection).
        waiting = {r.id for r in ready}
        self._held &= waiting
        self._retried &= waiting
        out = {*self._held, *(self._interjecting[1] if self._interjecting else [])}
        got = pick(
            [r for r in ready if r.id not in out], self.target, lambda r: self.gate(r, at_break)
        )
        if got is None:
            if any(r.id not in out for r in ready) or self._held:
                self._arm([r for r in ready if r.id not in self._held])
            return
        # Events an errored turn left go along with the next turn for their body.
        held = [r for r in ready if r.id in self._held and self.target(r) == got.body]
        self._held -= {r.id for r in held}
        turn_id = uuid.uuid4().hex
        rows = sorted([*held, *got.events], key=_order)  # held first: older on a tie
        taken = set(self._events.take([r.id for r in rows], turn_id))
        rows = [r for r in rows if r.id in taken]
        if not rows:
            return
        self._tried -= taken
        retry = self._retried & taken
        self._retried -= taken
        self.record_take(rows)
        self._taken[turn_id] = [r.id for r in rows]
        self._turn = _Turn(turn_id, got.body)
        try:
            self._session.start_events(turn_id, got.body, rows, retry)
        except Exception:
            self.turn_ended(turn_id, "error")  # else the one turn would stay taken for good
            # This turn never ran: only rows already in the history from before are a retry.
            self._retried -= taken - retry
            raise

    def _release_questions(self, ready: list[EventRow]) -> list[EventRow]:
        """No key or a spent budget: Scout cannot answer an expert's question for now, so it
        gives up and its end hook hands the question to the person. The rest of `ready`."""
        if self._session.ready():
            reason = "over_budget" if self.over_budget() else None
        else:
            reason = "no_key"
        if reason is None:
            return ready
        ids = [r.id for r in ready if r.kind == "job_question"]
        if ids:
            self._events.finish(ids, "gave_up", end_reason=reason)
        return [r for r in ready if r.kind != "job_question"]

    def _interject(self) -> bool:
        """Next-pause news while Scout speaks: one short call may tell it at this break. True
        when one started. Each event is tried once; untold, it waits for a plain turn."""
        rows = [
            r
            for r in self._events.ready()
            if r.id not in self._tried
            and r.id not in self._held
            and r.kind not in PERSON_KINDS
            and self._kinds[r.kind].urgency == "next_pause"
            and self.gate(r, at_break=True)
        ]
        body = next((b for b in map(self.target, rows) if b is not None), None)
        if body is None:
            return False
        kind = self._kinds[next(r.kind for r in rows if self.target(r) == body)]
        rows = [r for r in rows if r.kind == kind.name and self.target(r) == body][:GROUP_CAP]
        ids = [r.id for r in rows]
        self._tried.update(ids)
        text = wake_text(kind, rows, self.notes.get(kind.name, ""), self._now().tzinfo)
        task = asyncio.get_running_loop().create_task(
            self._interjection(body, rows, [{"type": "text", "text": text}])
        )
        self._interjecting = (task, ids)
        return True

    async def _interjection(self, body: str, rows: list[EventRow], content: list) -> None:
        told = False
        try:
            told = await self._session.interject(body, content)
        except asyncio.CancelledError:
            raise
        except Exception:
            _log.exception("runner.interject_failed kind=%s", rows[0].kind)
        self._interjecting = None
        if told:  # words replaced the rest of the reply: that told the news
            self.record_take(rows)
            self._events.finish([r.id for r in rows], "handled", end_reason="interjected")
        self.poke()

    def _arm(self, waiting: list[EventRow]) -> None:
        """Look again when the soonest closed gate can open: a batch or the idle window. A cap,
        quiet hours, no key or no body has no known time, so those are looked at again later;
        so are an errored turn's held events, which the alarm frees to be tried once more."""
        now = self._now()
        delay = RECHECK_S
        for r in waiting:
            if r.kind in PERSON_KINDS:
                continue
            kind = self._kinds[r.kind]
            opens = self._oldest_at(r) + timedelta(seconds=kind.batch_seconds or 0)
            if self._person_at is not None and kind.urgency == "idle":
                opens = max(opens, self._person_at + timedelta(seconds=IDLE_WINDOW_S))
            wait = (opens - now).total_seconds()
            if wait > 0:
                delay = min(delay, wait)
        self._alarm = asyncio.get_running_loop().call_later(delay, self._rang)

    def _rang(self) -> None:
        # Held events wait at most one recheck: an expert waiting on a question must not hang.
        self._held.clear()
        self.poke()

    def target(self, row: EventRow) -> str | None:
        """The body a turn for this event runs on, or None when no body displays (the event
        then waits). Only a body that displays is ever chosen: a reply sent to one that shows
        nothing is lost. An event a body sent (a say, a tap on the phone) answers there. Else a
        say goes where the person is, and news where the person is, else back to the body that
        caused it; else the first screen. The phone is otherwise chosen only when no screen is
        online: Scout speaks first on a screen."""
        shown = self._bodies.display_ids()
        if row.source in shown:
            return row.source

        def fits(body: str | None) -> bool:
            return body in shown and (body == shown[0] or not self._bodies.is_phone(body))

        wanted = [self._presence.using_now()]
        if row.kind not in PERSON_KINDS:
            wanted.append(self._events.origin_body(row.id, lambda s: not is_internal(s)))
        return next((b for b in wanted if fits(b)), shown[0] if shown else None)

    def gate(self, row: EventRow, at_break: bool = False) -> bool:
        """Whether this event may be told now. Pure: it never records a wake, so asking again
        and again for events that are not taken cannot use up a cap. A closed gate only waits;
        nothing is dropped here. `at_break`: a sentence break went by, the pause next-pause
        news waits for."""
        if row.kind in PERSON_KINDS:
            return True
        kind = self._kinds[row.kind]
        now = self._now()
        if not self._session.ready():  # no key: news waits for one, it is not lost
            return False
        # A kind with no hourly cap (an expert's question) is never held for quiet hours.
        if kind.max_per_hour is not None and self._quiet is not None and self._quiet(now):
            return False
        if self.over_budget():
            return False
        if kind.urgency == "hold":
            return False
        paused = at_break and kind.urgency == "next_pause"
        if kind.urgency != "now" and self._presence.talking() and not paused:
            return False
        if kind.urgency == "idle" and self._person_recent(now):
            return False
        if now - self._oldest_at(row) < timedelta(seconds=kind.batch_seconds or 0):
            return False
        return self._guards.run_sync(Hook.emit, EmitCtx(kind, now, self._wakes)).code != "held"

    def over_budget(self) -> bool:
        """The day's budget is spent: no news is told until it is not."""
        ctx = EmitCtx(None, self._now(), self._wakes)
        return self._guards.run_sync(Hook.emit, ctx).code == "over_budget"

    def record_take(self, events: list[EventRow]) -> None:
        """A turn took these events: count one wake per capped kind, and note a person's turn.
        Called only on a successful take, so a closed or passed-over gate costs nothing."""
        now = self._now()
        self._wakes = [(t, k) for t, k in self._wakes if (now - t).total_seconds() < WAKE_WINDOW_S]
        kinds = {e.kind for e in events}
        self._wakes += [(now, k) for k in sorted(kinds) if self._kinds[k].max_per_hour is not None]
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
