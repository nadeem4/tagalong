"""Choices: Scout's non-blocking question to the person.

`ask` opens a `choice` open item and its ask, and returns the id at once; a background task
waits for the answer and emits a `choice` event, which wakes Scout. Nobody answering in time
expires the item and tells Scout so (`expired`), so a turn is never stuck waiting, nothing is
dropped silently, and a late answer finds no open ask (not_found). A choice left from a last
run is expired at start by the session; Scout is not told of those.
"""

import asyncio
import logging
from collections.abc import Callable

from brain.asks import Asks
from brain.events import Event
from brain.open_items import OpenItems
from brain.protocol import RpcError
from brain.store.memory import MemoryRefused

log = logging.getLogger("brain")

MAX_CHOICE_OPTIONS = 6


class Choices:
    def __init__(
        self,
        asks: Asks,
        emit: Callable[[Event], None],
        items: OpenItems,
        timeout: float = 600.0,
    ) -> None:
        self._asks = asks
        self._emit = emit
        self._items = items
        self._timeout = timeout
        self._tasks: set[asyncio.Task] = set()  # held so they are not collected mid-wait

    def ask(self, text: str, options: list[str], recommended: str | None, free_text: bool) -> str:
        if not options and not free_text:
            raise MemoryRefused("choose needs options, or free_text for a typed answer.")
        if not self._asks.anyone_online():
            raise MemoryRefused("nobody is online to ask.")
        # Tied to this process: the waiting task dies with it, so the item expires at start.
        ask_id = self._items.open("choice", "brain", live_only=True, ttl_s=self._timeout).id
        task = asyncio.get_running_loop().create_task(
            self._wait(ask_id, text, options, recommended, free_text)
        )
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return ask_id

    async def _wait(
        self, ask_id: str, text: str, options: list[str], recommended: str | None, free_text: bool
    ) -> None:
        try:
            answer = await self._asks.open(
                text=text,
                options=options,
                free_text=free_text,
                recommended=recommended,
                ask_id=ask_id,
                tool="choose",  # lets a body tell Scout's question from an expert's
                timeout=self._timeout,
            )
        except RpcError:
            log.info("choice %s closed without an answer", ask_id)
            self._items.expire(ask_id, "no_answer")  # this item only, whatever closed the ask
            self._emit(Event("choice", self._facts(ask_id, text, "", "", expired=True), key=ask_id))
            return
        if answer.option is None:  # everyone went offline before it opened
            self._items.finish(ask_id, "nobody_online")
            return
        # A typed answer is the text alone: the body picked no option, so none is reported.
        picked = answer.option if answer.option in options else ""
        self._items.answer(ask_id, picked or answer.text or "", "person")
        facts = self._facts(ask_id, text, picked, answer.text or "")
        self._emit(Event("choice", facts, key=ask_id))

    @staticmethod
    def _facts(ask_id: str, text: str, option: str, typed: str, expired: bool = False) -> dict:
        facts = {"ask": ask_id, "question": text, "option": option, "text": typed}
        if expired:
            facts["expired"] = "yes"
        return facts
