"""Choices: Scout's non-blocking question to the person.

`ask` opens an ask and returns its id at once; a background task waits for the answer and
emits a `choice` event, which wakes Scout. Nobody answering in time emits nothing, so a turn
is never stuck waiting and a late answer finds no open ask (not_found).
"""

import asyncio
import logging
import uuid
from collections.abc import Callable

from brain.asks import Asks
from brain.events import Event
from brain.memory import MemoryRefused
from brain.protocol import RpcError

log = logging.getLogger("brain")

MAX_CHOICE_OPTIONS = 6


class Choices:
    def __init__(self, asks: Asks, emit: Callable[[Event], None], timeout: float = 600.0) -> None:
        self._asks = asks
        self._emit = emit
        self._timeout = timeout
        self._tasks: set[asyncio.Task] = set()  # held so they are not collected mid-wait

    def ask(self, text: str, options: list[str], recommended: str | None, free_text: bool) -> str:
        if not options and not free_text:
            raise MemoryRefused("choose needs options, or free_text for a typed answer.")
        if not self._asks.anyone_online():
            raise MemoryRefused("nobody is online to ask.")
        ask_id = uuid.uuid4().hex
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
            return
        if answer.option is None:  # everyone went offline before it opened
            return
        # A typed answer is the text alone: the body picked no option, so none is reported.
        picked = answer.option if answer.option in options else ""
        facts = {
            "ask": ask_id,
            "question": text,
            "option": picked,
            "text": answer.text or "",
        }
        self._emit(Event("choice", facts, key=ask_id))
