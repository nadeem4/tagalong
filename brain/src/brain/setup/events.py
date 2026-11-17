"""Setup events that wake Scout (an install or a login finished) saved as `setup` open items.

The item stays open until its event was handled, so a restart no longer loses the news:
`resume` sends the saved ones again at start. A newer event from the same source (one expert or
app) replaces the saved one.
"""

from collections.abc import Callable
from datetime import datetime

from brain.events import Event
from brain.open_items import BRAIN, OpenItem, OpenItems

SAVED = ("setup_done", "setup_login")  # setup_progress is context only and never woken


class SetupEvents:
    def __init__(
        self, items: OpenItems, emit: Callable[..., None], now: Callable[[], datetime]
    ) -> None:
        self._items = items
        self._emit = emit  # the session's post_event: takes the event and on_end
        self._now = now

    def emit(self, event: Event) -> None:
        if event.kind not in SAVED:
            self._emit(event)
            return
        for old in self._saved():
            if (old.saved_call["kind"], old.saved_call["source"]) == (event.kind, event.source):
                self._items.finish(old.id, "superseded")
        item = self._items.open(
            "setup",
            BRAIN,
            saved_call={"kind": event.kind, "payload": event.payload, "source": event.source},
        )
        self._send(item.id, event)

    def resume(self) -> None:
        """At start: news the last run never told is sent again (a day-old one is let go)."""
        self._items.expire_due(self._now(), "setup")
        for item in self._saved():
            call = item.saved_call
            self._send(item.id, Event(call["kind"], call["source"], call["payload"]))

    def _saved(self) -> list[OpenItem]:
        return self._items.list_open(kind="setup")

    def _send(self, item_id: str, event: Event) -> None:
        # Told only when its event was handled; one returned at a stop stays open for the next
        # start.
        def told(state: str) -> None:
            if state == "handled":
                self._items.finish(item_id, "told")

        self._emit(event, on_end=told)
