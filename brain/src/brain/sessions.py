"""The one conversation: shared history, at most one running turn, says that join it.

Turn bookkeeping lives in a done callback, not in the task body, so `ended` is sent and the
turn cleared even if the task is cancelled before it ever ran.
"""

import asyncio
import json
import logging
import uuid
from collections import deque
from collections.abc import Callable
from datetime import datetime
from functools import partial

from brain.asks import Asks
from brain.bodies import Bodies
from brain.config import DEFAULT_EXPERT_CMD, DEFAULT_EXPERT_TIMEOUT_S
from brain.experts import ExpertRun
from brain.jobs import Jobs
from brain.memory import Memory, _compaction_text
from brain.mind.prompt import render_know, system_prompt, user_content
from brain.mind.resume import rebuild_history
from brain.mind.turn import Call, Model, run_turn
from brain.protocol import SayParams, SayResult, Tool
from brain.toolbox import BodySource, BrainSource, Toolbox
from brain.tools import _fence_safe, brain_tools, expert_tools, home_tools

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
        make_run: Callable[..., ExpertRun] | None = None,
    ) -> None:
        self._model = model
        self._budget = budget
        self._bodies = bodies
        self._step_cap = step_cap
        self._memory = memory
        self._asks = Asks(bodies)
        notify = bodies.notify
        # main passes the configured command and timeout; the defaults keep tests short.
        make_run = make_run or partial(
            ExpertRun, command=[DEFAULT_EXPERT_CMD], timeout=DEFAULT_EXPERT_TIMEOUT_S
        )
        self.jobs = Jobs(memory, self._asks, notify, make_run)
        self.jobs.startup()  # rows left running by a dead brain become stopped
        tools = (
            brain_tools(memory, notify)
            + home_tools(budget, lambda: self.toolbox)
            + expert_tools(self.jobs)
        )

        def save_mode(name: str, mode: str) -> None:
            # Every save (Home's set_permission or an "always" answer) refreshes open panels.
            memory.set_permission_mode(name, mode)
            notify("changed", {"what": "permissions"})

        self.toolbox = Toolbox(
            [BrainSource(tools), BodySource(bodies)],
            memory.permission_modes,
            save_mode,
            self._asks,
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
        self._last_body: str | None = None  # where a wake turn goes first
        self._wakes: deque[tuple[str, Callable[[], None] | None]] = deque()
        bodies.on_connect = self._run_wakes

    def say(self, body_id: str, params: SayParams) -> SayResult:
        content = user_content(params)  # may raise ValueError before anything changes
        self._last_body = body_id
        # A finished task whose callback has not run yet is a dead turn: start a new one.
        if self._busy():
            self._inbox.append(content)
            return SayResult(turn=self._turn_id, joined=True)
        return SayResult(turn=self._start_turn(body_id, content), joined=False)

    def wake(self, event_text: str, on_start: Callable[[], None] | None = None) -> None:
        """Start a turn the brain begins itself (a job ended). Events queue, one turn each.

        on_start runs when this event's turn actually starts, so the caller can mark the event
        as told only then.
        """
        self._wakes.append((event_text, on_start))
        self._run_wakes()

    def _busy(self) -> bool:
        return self._task is not None and not self._task.done()

    def _run_wakes(self) -> None:
        # Called on wake, when a turn ends and when a body connects: the three things that
        # can unblock a waiting event.
        if not self._wakes or self._busy():
            return
        if self._last_body is not None and self._bodies.is_online(self._last_body):
            body_id = self._last_body
        elif online := self._bodies.online_ids():
            body_id = online[0]
        else:
            return  # no body to tell; the next connect retries
        text, on_start = self._wakes.popleft()
        if on_start is not None:
            on_start()
        # Job output is untrusted, so it goes in a fence it cannot close.
        self._start_turn(
            body_id, [{"type": "text", "text": f'<data kind="job">{_fence_safe(text)}</data>'}]
        )

    def _start_turn(self, body_id: str, content: list) -> str:
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
        return turn_id

    def cancel(self, turn_id: str) -> None:
        if turn_id == self._turn_id and self._task is not None:
            self._task.cancel()

    def answer(self, ask_id: str, option: str, body_id: str, text: str | None = None) -> None:
        self._asks.answer(ask_id, option, body_id, text)

    def open_asks(self) -> list[dict]:
        return self._asks.open_asks()

    def home_tools(self) -> list[Tool]:
        return self.toolbox.home_tools()

    async def call_home(self, tool: str, tool_input: dict) -> str:
        """Run a Home tool through the toolbox gate (caller "home" skips the ask)."""
        out = await self.toolbox.run(Call(uuid.uuid4().hex, tool, tool_input, "", ""), "home")
        return out if isinstance(out, str) else json.dumps(out)

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
        self._run_wakes()  # after ended, so the next turn's started comes second

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
