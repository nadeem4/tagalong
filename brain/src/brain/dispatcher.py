"""The front door: everything that wants Scout's attention is posted here with an urgency.

Urgency comes from the event kind (events.py), never from the payload or the model.
`now` is delivered at once, `next_pause` at a sentence break or when speech is idle, `idle`
only when speech is idle and no conversation is active, `hold` is kept as an open item and
never dropped. Items that arrive close together go out in one delivery. Every source posts
here (a say, a timer, a job's question or result, a card answer, setup news); a kind nobody
registered is refused, so no source can bypass the rules by inventing one.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace

from brain.events import EVENT_KINDS, EventKind, Urgency
from brain.open_items import OpenItems

BATCH_S = 2.0  # items arriving within this window of each other share one delivery
MAX_FAILS = 3  # a delivery that fails this often is logged and given up (F12 will hold it)

_log = logging.getLogger("brain.dispatcher")
_RANK: dict[str, int] = {"now": 0, "next_pause": 1, "idle": 2, "hold": 3}


Hook = Callable[[], None] | None


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
    # Run in this process only, never saved with a held item: the wake began, it was dropped, and
    # its turn ended (with the end reason: a cancelled turn did not carry the news).
    on_start: Hook = field(default=None, compare=False)
    on_drop: Hook = field(default=None, compare=False)
    on_end: Callable[[str], None] | None = field(default=None, compare=False)


@dataclass
class _Entry:
    rank: int
    seq: int
    item: Item
    posted: float
    # Set once the item has had to wait for its gate: it then goes the moment the gate opens,
    # because a sentence break can be over before any batching window would end.
    gated: bool = False
    fails: int = 0


def _label(e: _Entry) -> str:
    return f"{e.item.kind}:{e.item.key}"


class Dispatcher:
    def __init__(
        self,
        deliver: Callable[[list[Item]], Awaitable[None]],
        open_items: OpenItems,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        now: Callable[[], float] = time.monotonic,
        kinds: dict[str, EventKind] = EVENT_KINDS,
        batch_s: float = BATCH_S,
    ) -> None:
        self.deliver = deliver
        self._kinds = kinds
        self._batch_s = batch_s
        self._open_items = open_items
        self._sleep = sleep
        self._now = now
        self._queue: asyncio.Queue[_Entry] = asyncio.Queue()
        self._waiting: list[_Entry] = []
        self._inflight: list[_Entry] = []
        self._seq = 0
        self._state = "idle"
        self._conversation = False
        self._changed = asyncio.Event()
        self._task: asyncio.Task | None = None

    def post(self, item: Item) -> None:
        """Queue an item. Its kind decides its urgency; an unregistered kind raises."""
        kind = self._kinds.get(item.kind)
        if kind is None:
            raise ValueError(f"unregistered kind {item.kind!r}")
        urgency = kind.urgency
        item = replace(item, urgency=urgency)
        self.start()  # a source may post before the server's loop ran
        if urgency == "hold":
            self._hold(item)
            return
        self._seq += 1
        self._queue.put_nowait(_Entry(_RANK[urgency], self._seq, item, self._now()))
        self._changed.set()

    def drop(self, kind: str, key: str) -> None:
        """Forget a waiting item of that kind and key (its news is superseded); no hook runs."""
        self._intake()
        self._waiting = [
            w for w in self._waiting if not (w.item.kind == kind and w.item.key == key)
        ]

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
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None
        left = self._inflight + self._waiting
        while not self._queue.empty():
            left.append(self._queue.get_nowait())
        self._inflight, self._waiting = [], []
        if left:
            # Logged, not silent; F12 turns this into holding them as open items.
            _log.warning("dispatcher.dropped items=%s", [_label(e) for e in left])

    def _hold(self, item: Item) -> None:
        # Kept, not dropped: it shows on return or on Home like any open item. The kind must be
        # one the open-items table knows; a hold of any other kind fails loudly, not silently.
        self._open_items.open(item.kind, item.origin_body, saved_call={"payload": item.payload})

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

    async def _wait_window(self, seconds: float) -> None:
        """Sleep, but return early when anything changes (a `now` item, a state change)."""
        sleeper = asyncio.ensure_future(self._sleep(seconds))
        changed = asyncio.ensure_future(self._changed.wait())
        try:
            await asyncio.wait({sleeper, changed}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            sleeper.cancel()
            changed.cancel()

    async def _run(self) -> None:
        while True:
            self._changed.clear()
            self._intake()
            for w in self._waiting:
                if not self._can_deliver(w.item.urgency):
                    w.gated = True
            ready = [w for w in self._waiting if self._can_deliver(w.item.urgency)]
            if not ready:
                await self._changed.wait()
                continue
            if not any(w.item.urgency == "now" or w.gated for w in ready):
                # Items arriving close together share one delivery: wait out what is left of
                # the window since the oldest was posted, unless something changes.
                left = self._batch_s - (self._now() - min(w.posted for w in ready))
                if left > 0:
                    await self._wait_window(left)
                    if self._changed.is_set():
                        continue
            self._inflight = [w for w in self._waiting if self._can_deliver(w.item.urgency)]
            self._waiting = [w for w in self._waiting if w not in self._inflight]
            try:
                await self.deliver([w.item for w in self._inflight])
            except asyncio.CancelledError:
                raise
            except Exception:
                _log.exception(
                    "dispatcher.deliver_failed items=%s", [_label(w) for w in self._inflight]
                )
                for w in self._inflight:
                    w.fails += 1
                    if w.fails >= MAX_FAILS:
                        _log.error("dispatcher.gave_up item=%s", _label(w))
                    else:
                        # Back in with its original order; a newer same-key item will replace it.
                        self._waiting.append(w)
                self._inflight = []
                await self._sleep(BATCH_S)
                continue
            self._inflight = []
