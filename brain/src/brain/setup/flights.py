"""One sign-in or install in flight per expert: a second request joins the first.

A flight is a background task plus the open item (`signin` or `install`) that stands for it.
A request that finds one running gets that same item back and starts nothing, so a person
who taps twice, or a model that asks again, never opens a second window or a second install.
The item closes when the task ends: done, or expired if it was cancelled (shutdown).
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from brain.open_items import OpenItem, OpenItemRefused, OpenItems

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Flight:
    item: OpenItem
    task: asyncio.Task
    joined: bool  # True when a flight was already running and this request took its place


class Flights:
    def __init__(self, items: OpenItems, kind: str) -> None:
        self._items, self._kind = items, kind
        self._running: dict[str, tuple[str, asyncio.Task]] = {}

    def has(self, key: str) -> bool:
        return key in self._running and not self._running[key][1].done()

    def start(self, key: str, run: Callable[[], Awaitable[Any]]) -> Flight:
        """Join the running flight for `key`, or open its item and start `run` in the background."""
        # A task that is done but whose `_ended` has not run yet is over: not joined.
        if (current := self._running.get(key)) is not None and not current[1].done():
            item_id, task = current
            item = self._items.get(item_id)
            assert item is not None  # an open item is only closed when its task ends
            return Flight(item, task, True)
        item = self._items.open(self._kind, "brain", saved_call={"id": key}, live_only=True)
        task = asyncio.ensure_future(run())
        self._running[key] = (item.id, task)
        task.add_done_callback(lambda t: self._ended(key, item.id, t))
        return Flight(item, task, False)

    async def stop(self) -> None:
        """Cancel every flight at shutdown (each cleans up after itself)."""
        tasks = [task for _, task in self._running.values()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def _ended(self, key: str, item_id: str, task: asyncio.Task) -> None:
        if self._running.get(key, ("", task))[0] == item_id:
            del self._running[key]
        try:
            if task.cancelled():
                self._items.expire(item_id, "cancelled")
                return
            if err := task.exception():
                log.warning("%s flight for %s failed: %r", self._kind, key, err)
            self._items.finish(item_id, "ended")
        except OpenItemRefused:  # already closed by another move
            pass
