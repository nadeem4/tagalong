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
from brain.memory import Memory, _compaction_text
from brain.mind.prompt import render_know, system_prompt, user_content
from brain.mind.resume import rebuild_history
from brain.mind.turn import Model, run_turn
from brain.protocol import SayParams, SayResult
from brain.toolbox import BodySource, BrainSource, Toolbox
from brain.tools import brain_tools

log = logging.getLogger("brain")


class Session:
    def __init__(
        self,
        model: Model,
        budget,
        bodies: Bodies,
        step_cap: int,
        memory: Memory,
        now: Callable[[], datetime] = lambda: datetime.now().astimezone(),
    ) -> None:
        self._model = model
        self._budget = budget
        self._bodies = bodies
        self._step_cap = step_cap
        self._memory = memory
        self.toolbox = Toolbox(
            [BrainSource(brain_tools(memory)), BodySource(bodies)],
            memory.permission_modes,
            memory.set_permission_mode,
        )
        self._now = now
        loaded = memory.load_messages()
        self.history: list = rebuild_history(loaded)
        self._saved = len(self.history)  # history[:_saved] is already in the database
        if self.history and (not loaded or self.history[-1] is not loaded[-1]):
            # rebuild_history added a cancelled tool_result; store it with the next save so
            # the stored chat stays valid.
            self._saved -= 1
        self._inbox: list = []
        self._turn_id: str | None = None
        self._task: asyncio.Task | None = None

    def say(self, body_id: str, params: SayParams) -> SayResult:
        content = user_content(params)  # may raise ValueError before anything changes
        # A finished task whose callback has not run yet is a dead turn: start a new one.
        if self._task is not None and not self._task.done():
            self._inbox.append(content)
            return SayResult(turn=self._turn_id, joined=True)
        turn_id = uuid.uuid4().hex
        self._turn_id = turn_id
        if self._inbox:  # says from the finished turn come before this newer one
            self._append_user([b for s in self._inbox for b in s])
            self._inbox.clear()
        self._append_user(content)
        # Read once per turn so the system prompt stays identical across its steps (cache).
        know = render_know(self._memory.always_loaded())
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
                system=lambda: system_prompt(self._now(), self._bodies.online(), know),
                history=self.history,
                tools=self.toolbox.model_tools,
                run_tool=self.toolbox.run,
                inbox=self._inbox,
                notify=notify,
                budget=self._budget,
                step_cap=self._step_cap,
            )
        )
        self._task = task
        task.add_done_callback(lambda t: self._ended(t, turn_id, body_id))
        return SayResult(turn=turn_id, joined=False)

    def cancel(self, turn_id: str) -> None:
        if turn_id == self._turn_id and self._task is not None:
            self._task.cancel()

    def _append_user(self, content: list) -> None:
        # Input arriving while the last user message is still unsaved joins it, so one burst is
        # one saved message. (The API would also accept two user messages in a row and join them.)
        if len(self.history) > self._saved and self.history[-1]["role"] == "user":
            self.history[-1]["content"] += content
        else:
            self.history.append({"role": "user", "content": content})

    def _ended(self, task: asyncio.Task, turn_id: str, body_id: str) -> None:
        if task.cancelled():
            reason = "cancelled"
        elif task.exception() is not None:
            log.error("turn failed", exc_info=task.exception())
            reason = "error"
        else:
            reason = task.result()
        if self._task is task:  # a newer turn may already own the session
            if self._inbox:  # says that arrived too late for the loop must not be lost
                self._append_user([b for s in self._inbox for b in s])
                self._inbox.clear()
            self._turn_id = None
            self._task = None
        self._persist()
        self._bodies.notify(
            "turn", {"turn": turn_id, "body": body_id, "state": "ended", "reason": reason}
        )

    def _persist(self) -> None:
        # Saving is best effort: a full disk must not stop the ended notification.
        try:
            new = self.history[self._saved :]
            self._memory.save_messages(new)
            self._saved = len(self.history)  # before summaries, so a failure there cannot re-save
            for message in new:
                if message["role"] != "assistant" or isinstance(message["content"], str):
                    continue
                for block in message["content"]:
                    if block.get("type") == "compaction" and (text := _compaction_text(block)):
                        self._memory.add_summary(text)
        except Exception:
            log.exception("could not save the chat")
