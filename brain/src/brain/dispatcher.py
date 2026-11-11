"""The front door: everything that wants Scout's attention is posted here with an urgency.

Urgency comes from the event kind (events.py), never from the payload or the model.
`now` is delivered at once, `next_pause` at a sentence break or when speech is idle, `idle`
only when speech is idle and no conversation is active, `hold` is kept as an open item and
never dropped. Items that arrive close together go out in one delivery. Nothing posts here yet.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace

from brain.events import EVENT_KINDS, Urgency
from brain.open_items import OpenItems

BATCH_S = 2.0  # items arriving within this window of each other share one delivery

_log = logging.getLogger("brain.dispatcher")
_RANK: dict[str, int] = {"now": 0, "next_pause": 1, "idle": 2, "hold": 3}


@dataclass(frozen=True)
class Item:
    kind: str
    origin_body: str
    payload: dict
    urgency: Urgency
    # A newer waiting item with the same kind and key replaces the older one.
    key: str | None = None


class Dispatcher:
    def __init__(
        self,
        deliver: Callable[[list[Item]], Awaitable[None]],
        open_items: OpenItems | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.deliver = deliver
        self._open_items = open_items
        self._sleep = sleep
        self._queue: asyncio.PriorityQueue[tuple[int, int, Item]] = asyncio.PriorityQueue()
        self._waiting: list[tuple[int, int, Item]] = []
        self._seq = 0
        self._state = "idle"
        self._conversation = False
        self._changed = asyncio.Event()
        self._task: asyncio.Task | None = None

    def post(self, item: Item) -> None:
        """Queue an item. A registered kind decides its own urgency; the item's is only a
        fallback for kinds not registered yet."""
        kind = EVENT_KINDS.get(item.kind)
        urgency = kind.urgency if kind else item.urgency
        item = replace(item, urgency=urgency)
        if urgency == "hold":
            self._hold(item)
            return
        self._seq += 1
        self._queue.put_nowait((_RANK[urgency], self._seq, item))
        self._changed.set()

    def set_speech_state(self, state: str) -> None:
        """`talking`, `sentence_break`, `paused` or `idle`, as the mouth reports it."""
        self._state = state
        self._changed.set()

    def set_conversation_active(self, active: bool) -> None:
        self._conversation = active
        self._changed.set()

    def start(self) -> None:
        self._task = asyncio.get_running_loop().create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    def _hold(self, item: Item) -> None:
        # Kept, not dropped: it shows on return or on Home like any open item. The kind must be
        # one the open-items table knows; a hold of any other kind fails loudly, not silently.
        if self._open_items is None:
            _log.error("dispatcher.hold_lost kind=%s (no open-item store)", item.kind)
            return
        self._open_items.open(item.kind, item.origin_body, saved_call={"payload": item.payload})

    def _can_deliver(self, urgency: str) -> bool:
        if urgency == "now":
            return True
        if urgency == "next_pause":
            return self._state in ("sentence_break", "idle")
        return self._state == "idle" and not self._conversation

    def _intake(self) -> None:
        while not self._queue.empty():
            rank, seq, item = self._queue.get_nowait()
            if item.key is not None:
                self._waiting = [
                    w
                    for w in self._waiting
                    if not (w[2].kind == item.kind and w[2].key == item.key)
                ]
            self._waiting.append((rank, seq, item))
        self._waiting.sort(key=lambda w: (w[0], w[1]))

    def _take(self) -> list[Item]:
        ready = [w for w in self._waiting if self._can_deliver(w[2].urgency)]
        self._waiting = [w for w in self._waiting if w not in ready]
        return [w[2] for w in ready]

    async def _run(self) -> None:
        while True:
            self._changed.clear()
            self._intake()
            ready = [w for w in self._waiting if self._can_deliver(w[2].urgency)]
            if not ready:
                await self._changed.wait()
                continue
            if ready[0][2].urgency != "now":
                # Wait out the window so items arriving close together share one delivery.
                await self._sleep(BATCH_S)
                self._intake()
            batch = self._take()
            if not batch:
                continue
            try:
                await self.deliver(batch)
            except Exception:
                # A failed delivery must not kill the loop; the items go back to wait.
                _log.exception("dispatcher.deliver_failed kinds=%s", [i.kind for i in batch])
                for i in batch:
                    self._seq += 1
                    self._queue.put_nowait((_RANK[i.urgency], self._seq, i))
                await self._sleep(BATCH_S)
