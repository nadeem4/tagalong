"""Choices: Scout's non-blocking question to the person.

`ask` opens a `choice` open item and its card, and returns the id at once. The answer is a card
answer that this code takes (`answered`): it emits a `choice` event, which wakes Scout. Nobody
answering in time expires the item and tells Scout so (`expired`), so a turn is never stuck
waiting, nothing is dropped silently, and a late answer finds no open ask (not_found). A choice
left from a last run is expired at start by the session; Scout is not told of those.
"""

import asyncio
import logging
from collections.abc import Callable

from brain.asks import Asks
from brain.events import Event
from brain.open_items import OpenItemRefused, OpenItems
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
        # ask id -> (question, options, the timer that ends it unanswered), until it is answered
        self._open: dict[str, tuple[str, list[str], asyncio.TimerHandle]] = {}
        asks.register("choice", self.answered)

    def ask(self, text: str, options: list[str], recommended: str | None, free_text: bool) -> str:
        if not options and not free_text:
            raise MemoryRefused("choose needs options, or free_text for a typed answer.")
        if not self._asks.anyone_online():
            raise MemoryRefused("nobody is online to ask.")
        # Tied to this process: the timer dies with it, so the item expires at start.
        ask_id = self._items.open("choice", live_only=True, ttl_s=self._timeout).id
        lapse = asyncio.get_running_loop().call_later(self._timeout, self._lapse, ask_id)
        self._open[ask_id] = (text, options, lapse)
        self._asks.card(
            ask_id,
            kind="choice",
            text=text,
            options=options,
            free_text=free_text,
            recommended=recommended,
            tool="choose",  # lets a body tell Scout's question from an expert's
        )
        return ask_id

    def answered(
        self, ask_id: str, option: str, body_id: str, text: str | None, _at: str | None
    ) -> None:
        entry = self._open.pop(ask_id, None)
        if entry is None:
            return  # it lapsed first
        question, options, lapse = entry
        lapse.cancel()
        # A typed answer is the text alone: the body picked no option, so none is reported.
        picked = option if option in options else ""
        try:
            self._items.answer(ask_id, picked or text or "", "person")
        except OpenItemRefused:
            return  # past its deadline: the item ended and Scout was told
        self._emit(Event("choice", "scout", self._facts(ask_id, question, picked, text or "")))

    def _lapse(self, ask_id: str) -> None:
        entry = self._open.pop(ask_id, None)
        if entry is None:
            return
        log.info("choice %s closed without an answer", ask_id)
        self._asks.expire(ask_id, "timeout")
        try:
            self._items.expire(ask_id, "no_answer")  # this item only, whatever else is open
        except OpenItemRefused:
            return
        self._emit(Event("choice", "scout", self._facts(ask_id, entry[0], "", "", expired=True)))

    @staticmethod
    def _facts(ask_id: str, text: str, option: str, typed: str, expired: bool = False) -> dict:
        facts = {"ask": ask_id, "question": text, "option": option, "text": typed}
        if expired:
            facts["expired"] = "yes"
        return facts
