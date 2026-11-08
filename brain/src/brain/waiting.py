"""Scout asks that outlive their turn: parked while the person is away.

A tool call that needs the person's yes waits in its turn, then parks: the turn goes on and the
decision keeps running here. This module owns that still-running decision, finds a repeated call
for it, and (later in this slice) carries the call out when the person finally answers.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime
from typing import TYPE_CHECKING

from brain.asks import Asks
from brain.events import Event
from brain.mind.turn import Call
from brain.permission import AskRequest, Decision
from brain.store.work import WorkStore

if TYPE_CHECKING:
    from brain.toolbox import Toolbox

log = logging.getLogger(__name__)


class WaitingAsks:
    def __init__(
        self,
        work: WorkStore,
        asks: Asks,
        toolbox: "Callable[[], Toolbox]",
        emit: Callable[[Event], None],
        now: Callable[[], datetime],
        mask: Callable[[dict], dict] = lambda value: value,
    ) -> None:
        self._work = work
        self._asks = asks
        self._toolbox = toolbox
        self._emit = emit
        self._now = now
        self._mask = mask  # the same masking the saved call went through
        self._tasks: set[asyncio.Task[Decision]] = set()

    def find(self, tool: str, input: dict) -> str | None:
        """The id of an open Scout ask already saved for this very call, if any."""
        wanted = self._mask(input)
        for row in self._work.waiting_asks():
            saved = row.input or {}
            if saved.get("name") == tool and saved.get("input") == wanted:
                return row.id
        return None

    def adopt(self, task: "asyncio.Task[Decision]", call: Call, req: AskRequest) -> None:
        """Keep the decision still running after its turn moved on."""
        self._asks.park(req.ask_id)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
