"""The one conversation: shared history, at most one running turn, says that join it.

Turn bookkeeping lives in a done callback, not in the task body, so `ended` is sent and the
turn cleared even if the task is cancelled before it ever ran.
"""

import asyncio
import logging
import uuid
from collections.abc import Callable
from datetime import datetime

from brain.bodies import Bodies
from brain.mind.prompt import system_prompt, user_content
from brain.mind.turn import Model, run_turn
from brain.protocol import SayParams, SayResult

log = logging.getLogger("brain")


async def _no_tools(name: str, tool_input: dict):
    raise RuntimeError("no tools yet")


class Session:
    def __init__(
        self,
        model: Model,
        budget,
        bodies: Bodies,
        step_cap: int,
        now: Callable[[], datetime] = lambda: datetime.now().astimezone(),
    ) -> None:
        self._model = model
        self._budget = budget
        self._bodies = bodies
        self._step_cap = step_cap
        self._now = now
        self.history: list = []
        self._inbox: list = []
        self._turn_id: str | None = None
        self._task: asyncio.Task | None = None
        self._tasks: set[asyncio.Task] = set()  # strong references until each turn ends

    def say(self, body_id: str, params: SayParams) -> SayResult:
        content = user_content(params)  # may raise ValueError before anything changes
        if self._turn_id is not None:
            self._inbox.append(content)
            return SayResult(turn=self._turn_id, joined=True)
        turn_id = uuid.uuid4().hex
        self._turn_id = turn_id
        self.history.append({"role": "user", "content": content})
        notify = self._bodies.notify
        # Deferred a tick so the say result goes out before the started notification.
        asyncio.get_running_loop().call_soon(
            notify, "turn", {"turn": turn_id, "body": body_id, "state": "started"}
        )
        task = asyncio.create_task(
            run_turn(
                turn_id=turn_id,
                body_id=body_id,
                model=self._model,
                system=lambda: system_prompt(self._now(), self._bodies.online()),
                history=self.history,
                tools=[],
                run_tool=_no_tools,
                inbox=self._inbox,
                notify=notify,
                budget=self._budget,
                step_cap=self._step_cap,
            )
        )
        self._task = task
        self._tasks.add(task)
        task.add_done_callback(lambda t: self._ended(t, turn_id, body_id))
        return SayResult(turn=turn_id, joined=False)

    def cancel(self, turn_id: str) -> None:
        if turn_id == self._turn_id and self._task is not None:
            self._task.cancel()

    def _ended(self, task: asyncio.Task, turn_id: str, body_id: str) -> None:
        self._tasks.discard(task)
        if task.cancelled():
            reason = "cancelled"
        elif task.exception() is not None:
            log.error("turn failed", exc_info=task.exception())
            reason = "error"
        else:
            reason = task.result()
        if self._inbox:  # says that arrived too late for the loop must not be lost
            self.history.append({"role": "user", "content": [b for s in self._inbox for b in s]})
            self._inbox.clear()
        self._turn_id = None
        self._task = None
        self._bodies.notify(
            "turn", {"turn": turn_id, "body": body_id, "state": "ended", "reason": reason}
        )
