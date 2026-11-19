"""The turn runner: the only thing that starts a Scout turn, one at a time.
A person's words go first, then news oldest first; one turn takes every other ready event for
the same body, up to a cap. `pick` is pure: the gate and the target come in as callbacks, so
choosing never records a wake or spends a cap; the wake is counted by `record_take`. A say on
the running turn's body joins it at its next step (`take_more`); next-pause news is told at a
sentence break, by an interjection first, which takes the event and gives it back untold. A
turn's events end with it, or wait out a growing backoff in the log and are tried again.
"""

import asyncio
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

from brain.bodies import Bodies
from brain.builtin_guards import WAKE_WINDOW_S
from brain.events import (
    EVENT_KINDS,
    PERSON_KINDS,
    EventKind,
    EventLog,
    is_internal,
    load_notes,
)
from brain.guards import EmitCtx, Hook
from brain.presence import Presence
from brain.store.events import EventRow
from brain.tasks import Tasks, age_text
from brain.tools import _fence_safe

_log = logging.getLogger(__name__)

IDLE_WINDOW_S = 10  # idle news stays quiet this long after the person last spoke
GROUP_CAP = 20  # one turn tells at most this many events, so a long backlog cannot swamp it
RECHECK_S = 60.0  # news behind a closed gate is looked at again at least this often
# Ends that settle a turn: done, cancelled by the person, no screen to answer on, and a request
# the API refuses (sent again it would be refused again, so it is not retried).
_HANDLED = frozenset({"done", "cancelled", "rejected", "unanswered"})


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


def _age(rows: list[EventRow], now: datetime) -> str:
    """How long the oldest of these has waited, in one unit: Scout weighs old news, code never
    drops it."""
    return age_text(int((now - min(datetime.fromisoformat(r.at) for r in rows)).total_seconds()))


def wake_text(
    kind: EventKind,
    rows: list[EventRow],
    note: str,
    now: datetime,
    attrs: dict[str, str] | None = None,
) -> str:
    """The facts of a batch of one kind, fenced as data: the model reads them, never obeys them.
    The block carries its `age`; `attrs` mark it (a resumed or given-up event). Code sets both,
    never a payload."""
    lines = [f"Event: {kind.name}", *([f"How to weigh it: {note}"] if note else [])]
    for row in rows:
        at = datetime.fromisoformat(row.at).astimezone(now.tzinfo)
        task = f" task={row.task}" if row.task else ""
        lines.append(f"- at {at.strftime('%Y-%m-%d %H:%M %z')}{task}")
        for name, value in (row.payload or {}).items():
            first, *rest = str(value).split("\n")
            lines.append(f"  {name}: {first}")
            lines.extend(f"    {r}" for r in rest)
    shown = {"age": _age(rows, now), **(attrs or {})}
    marks = "".join(f' {k}="{v}"' for k, v in shown.items() if v)  # none empty
    return f'<data kind="event"{marks}>\n{_fence_safe(chr(10).join(lines))}\n</data>'


class TurnHost(Protocol):
    """What the runner needs of the session."""

    def ready(self) -> bool: ...  # a model can answer (a key is set)

    # A row with `resume` was sent by a failed turn: its words are in the history already.
    # `gave_up`: events Scout could not finish, told once on a person's turn.
    def start_events(
        self, turn_id: str, body: str, rows: list[EventRow], gave_up: list[EventRow]
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
        tasks: Tasks,
        quiet: Callable[[datetime], bool] | None = None,
        kinds: dict[str, EventKind] = EVENT_KINDS,
    ) -> None:
        self._events = events
        self._presence = presence
        self._bodies = bodies
        self._session = session
        self._now = now
        self._guards = guards
        self._tasks = tasks
        self._quiet = quiet
        self._kinds = kinds
        self.notes = load_notes()  # per-kind notes for the wake text; the session reads them too
        self._wakes: list[tuple[datetime, str]] = []  # (when, kind) of each news turn taken
        self._person_at: datetime | None = None
        self._turn: _Turn | None = None  # the running turn
        self._taken: dict[str, list[str]] = {}  # turn id -> the events it took
        self._riders: dict[str, list[str]] = {}  # turn id -> the given-up events it carries
        self._tried: set[str] = set()  # next-pause news an interjection already tried
        self._interjecting: tuple[asyncio.Task, str] | None = None  # the call and its event
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

    async def stop(self) -> list[str]:
        """The brain is closing: the running turn's events go back to `new` (no attempt), so a
        quit never loses a say, and their hooks hear it; then the turn is cancelled. Returns
        the turn's events, which the session marks `resume` if the turn saved any work."""
        self._stopped = True
        if self._alarm is not None:
            self._alarm.cancel()
        turn, self._turn = self._turn, None
        ids: list[str] = []
        if turn is not None:
            ids = self._taken.pop(turn.id, [])
            self._events.finish(ids, "new")
            self._events.ended(ids, "new")
            self._session.cancel_turn()
        tasks = [self._task] if self._task else []
        if self._interjecting is not None:  # its event goes back too, never left taken
            task, id = self._interjecting
            self.give_back(id)
            self._events.ended([id], "new")
            tasks.append(task)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        return ids

    def turn_ended(self, turn_id: str, reason: str) -> None:
        """Spec 6.5. A done, person-cancelled or rejected turn handled its events. Over budget,
        a say was answered (the person sees why) while news waits as `new` for the budget, no
        attempt counted. Any other end (an error, a timeout, the step cap) backs them off and
        tries again; the fourth failure gives them up. Given-up events a done turn carried
        were told."""
        if self._stopped:
            return  # the cancel the stop caused: stop already put them back
        ids = self._taken.pop(turn_id, [])
        riders = self._riders.pop(turn_id, [])
        if reason in _HANDLED:
            self._events.finish(ids, "handled", end_reason=reason)
            if reason == "done":  # told: the state says so, and why it was given up stays
                for row in filter(None, map(self._events.get, riders)):
                    self._events.finish([row.id], "handled", end_reason=row.end_reason)
        elif reason == "over_budget":
            rows = [r for r in map(self._events.get, ids) if r is not None]
            says = [r.id for r in rows if r.kind in PERSON_KINDS]
            self._events.finish(says, "handled", end_reason=reason)
            news = [r.id for r in rows if r.id not in says]
            self._events.finish(news, "new")
            # What it said before the cut is in the history: after the reset it goes on, not again.
            self._events.set_resume(news)
        else:
            self._events.backoff(ids, reason)
        self._tasks.settle()  # an Ask ends with the turn that answered it, or gave its say up
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
            and not r.resume  # its words are in the history: it waits for a turn of its own
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
        # Read on every step, before any return: a break latched while no news waited for it
        # (or while a turn ran) is spent here, so it cannot let later news cut a sentence.
        at_break = self._presence.break_seen() or self._presence.at_break()
        if self._interjecting is None and self._presence.at_break() and self._interject():
            return
        # An interjection is speaking into the reply: no plain turn starts around it. Its
        # give-back pokes again, so an untold event still gets its turn.
        if self._turn is not None or self._interjecting is not None:
            return
        # A backing-off event is not ready until its wait is over: it gives up its place.
        ready = self._release_questions(self._events.ready())
        got = pick(ready, self.target, lambda r: self.gate(r, at_break))
        if got is None:
            if ready or self._events.next_retry() is not None:
                self._arm(ready)
            return
        turn_id = uuid.uuid4().hex
        taken = set(self._events.take([r.id for r in got.events], turn_id))
        rows = [r for r in got.events if r.id in taken]
        if not rows:
            return
        self._tried -= taken
        self.record_take(rows)
        self._taken[turn_id] = [r.id for r in rows]
        # What Scout could not finish is told once, on a turn the person is there for.
        riders = self._events.gave_up() if any(r.kind in PERSON_KINDS for r in rows) else []
        self._riders[turn_id] = [r.id for r in riders]
        self._turn = _Turn(turn_id, got.body)
        try:
            self._session.start_events(turn_id, got.body, rows, riders)
        except Exception:
            # Else the one turn would stay taken for good. An attempt, so a start that always
            # breaks gives up; not a resume, since nothing of this turn reached the history.
            self._taken.pop(turn_id, None)
            self._riders.pop(turn_id, None)
            self._turn = None
            self._events.backoff(list(taken), "error", resume=False)
            self.poke()
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

    def take_for_interjection(self) -> EventRow | None:
        """The oldest next-pause news this sentence break may tell, taken so no turn takes it
        meanwhile. Each event is tried once; untold, `give_back` returns it for a plain turn."""
        for r in sorted(self._events.ready(), key=_order):
            if (
                r.id in self._tried
                or r.kind in PERSON_KINDS
                or self._kinds[r.kind].urgency != "next_pause"
                or self.target(r) is None
                or not self.gate(r, at_break=True)
            ):
                continue
            if self._events.take([r.id], f"interjection:{uuid.uuid4().hex}"):
                self._tried.add(r.id)
                return r
        return None

    def give_back(self, id: str) -> None:
        """An interjection did not tell it: it waits as `new` again, no attempt counted."""
        self._events.finish([id], "new")

    def _interject(self) -> bool:
        """Next-pause news while Scout speaks: one short call may tell it at this break. True
        when one started."""
        row = self.take_for_interjection()
        if row is None:
            return False
        body = self.target(row)
        assert body is not None  # it had one when taken, and nothing ran since
        kind = self._kinds[row.kind]
        text = wake_text(kind, [row], self.notes.get(kind.name, ""), self._now())
        task = asyncio.get_running_loop().create_task(
            self._interjection(body, row, [{"type": "text", "text": text}])
        )
        self._interjecting = (task, row.id)
        return True

    async def _interjection(self, body: str, row: EventRow, content: list) -> None:
        told = False
        try:
            told = await self._session.interject(body, content)
        except asyncio.CancelledError:
            raise  # a stop: it gave the event back already
        except Exception:
            _log.exception("runner.interject_failed kind=%s", row.kind)
        self._interjecting = None
        if told:  # words replaced the rest of the reply: that told the news
            self.record_take([row])
            self._events.finish([row.id], "handled", end_reason="interjected")
        else:
            self.give_back(row.id)
        self.poke()

    def _arm(self, waiting: list[EventRow]) -> None:
        """Look again when the soonest closed gate can open (a batch, the idle window or the
        budget's reset at local midnight) or a backing-off event's wait ends. A cap, quiet
        hours, no key or no body has no known time, so those are looked at again later."""
        now = self._now()
        delay = RECHECK_S
        retry = self._events.next_retry()
        if retry is not None:
            delay = min(delay, max((retry - now).total_seconds(), 0))
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
        if waiting and self.over_budget():  # held for the budget: the reset opens the gate
            tomorrow = now + timedelta(days=1)
            midnight = tomorrow.replace(hour=0, minute=0, second=0, microsecond=0)
            delay = min(delay, (midnight - now).total_seconds())
        self._alarm = asyncio.get_running_loop().call_later(delay, self._rang)

    def _rang(self) -> None:
        self.poke()

    def target(self, row: EventRow) -> str | None:
        """The body a turn for this event runs on, or None when no body displays (the event
        then waits). Only a body that displays is ever chosen: a reply sent to one that shows
        nothing is lost. An event a body sent (a say, a tap on the phone) answers there. Else a
        say goes where the person is, and news where the person is, else the body its task came
        from; else the first screen. The phone is otherwise chosen only when no screen is online:
        Scout speaks first on a screen."""
        shown = self._bodies.display_ids()
        if row.source in shown:
            return row.source

        def fits(body: str | None) -> bool:
            return body in shown and (body == shown[0] or not self._bodies.is_phone(body))

        wanted = [self._presence.using_now()]
        if row.kind not in PERSON_KINDS:
            source = self._tasks.source_of(row.task)
            wanted.append(source if source and not is_internal(source) else None)
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
        # An urgent card check-back is the one news that gets through them.
        urgent = row.kind == "card_due" and bool(row.payload.get("urgent"))
        if kind.max_per_hour is not None and self._quiet is not None and self._quiet(now):
            if not urgent:
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
