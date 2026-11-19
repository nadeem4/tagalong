"""Setup events that wake Scout (an install or a login finished), posted to the event log.

The log keeps each one until a turn handles it, so a restart does not lose the news. A newer
event from the same source (one expert or app) ends the one still waiting: only the latest
outcome is told.
"""

from collections.abc import Callable

from brain.events import Event

SAVED = ("setup_done", "setup_login")  # setup_progress is context only and never woken


class SetupEvents:
    def __init__(self, post: Callable[[Event], None], finish_matching: Callable[..., object]):
        self._post = post  # the session's post_event
        self._finish_matching = finish_matching  # the log's: ends waiting events of kind, source

    def emit(self, event: Event) -> None:
        # Posted first: a crash before the older one ends leaves both, never neither.
        self._post(event)
        if event.kind in SAVED:
            self._finish_matching(event.kind, event.source, keep=event.id)
