"""Setup events that wake Scout (an install or a login finished), posted to the event log.

The log keeps each one until a turn handles it, so a restart does not lose the news. A newer
event from the same source (one expert or app) ends the one still waiting: only the latest
outcome is told. News no task asked for is Scout's own idea: it gets an Own task, which ends
(done) by the settle sweep once the news is handled.
"""

from collections.abc import Callable
from dataclasses import replace

from brain.events import Event

SAVED = ("setup_done", "setup_login")  # setup_progress is context only and never woken


class SetupEvents:
    def __init__(
        self,
        post: Callable[[Event], None],
        finish_matching: Callable[..., object],
        open_own: Callable[[str, str], str],
    ):
        self._post = post  # the session's post_event
        self._open_own = open_own  # (source, title) -> a new Own task's id
        self._finish_matching = finish_matching  # the log's: ends waiting events of kind, source

    def emit(self, event: Event) -> None:
        if event.kind in SAVED and event.task is None:  # a person's request keeps its own task
            facts = event.payload
            title = str(
                facts.get("name") or facts.get("expert") or facts.get("app") or event.source
            )
            event = replace(event, task=self._open_own(event.source, title))
        # Posted first: a crash before the older one ends leaves both, never neither.
        self._post(event)
        if event.kind in SAVED:
            self._finish_matching(event.kind, event.source, keep=event.id)
