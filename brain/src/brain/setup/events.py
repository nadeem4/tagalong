"""Setup events that wake Scout (an install or a login finished) saved as `setup` open items.

The item stays open until Scout's wake turn has finished, so a restart or a wake dropped because
the budget was spent no longer loses the news: `resume` sends the saved ones again at start.
A cancelled wake turn leaves it open. A newer event for the same expert or app replaces
the saved one.
"""

from collections.abc import Callable
from datetime import datetime

from brain.events import Event
from brain.open_items import OpenItem, OpenItems

SAVED = ("setup_done", "setup_login")  # setup_progress is context only and never woken


class SetupEvents:
    def __init__(
        self, items: OpenItems, emit: Callable[..., None], now: Callable[[], datetime]
    ) -> None:
        self._items = items
        self._emit = emit  # the scheduler's emit: takes the event and on_start
        self._now = now

    def emit(self, event: Event) -> None:
        if event.kind not in SAVED:
            self._emit(event)
            return
        for old in self._saved():
            if (old.saved_call["kind"], old.saved_call["key"]) == (event.kind, event.key):
                self._items.finish(old.id, "superseded")
        item = self._items.open(
            "setup",
            "brain",
            saved_call={"kind": event.kind, "facts": event.facts, "key": event.key},
        )
        self._send(item.id, event)

    def resume(self) -> None:
        """At start: news the last run never told is sent again (a day-old one is let go)."""
        self._items.expire_due(self._now(), "setup")
        for item in self._saved():
            call = item.saved_call
            self._send(item.id, Event(call["kind"], call["facts"], key=call["key"]))

    def _saved(self) -> list[OpenItem]:
        return self._items.list_open(kind="setup")

    def _send(self, item_id: str, event: Event) -> None:
        # Told only when the turn for it finishes; a dropped or cancelled wake leaves it open
        # for the next start.
        def told(reason: str) -> None:
            if reason == "done":  # a cancelled wake did not tell it: it stays open
                self._items.finish(item_id, "told")

        self._emit(event, on_end=told)
