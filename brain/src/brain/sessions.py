"""The one conversation: shared history, at most one running turn, says that join it.
It also owns the Scheduler, which starts the wakes the brain begins itself (a job ended).

Turn bookkeeping lives in a done callback, not in the task body, so `ended` is sent and the
turn cleared even if the task is cancelled before it ever ran.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Callable
from datetime import datetime
from functools import partial
from typing import Literal

from brain.app_tools import AppSource, app_home_tools
from brain.approvals import Approvals, approval_home_tools
from brain.apps import Apps, TokenFile
from brain.asks import Asks
from brain.bodies import Bodies
from brain.builtin_guards import (
    anyone_online,
    person_ask,
    side_check_guard,
    spend_guards,
    tool_mode,
    wake_caps,
)
from brain.config import (
    DEFAULT_EXPERT_CMD,
    DEFAULT_EXPERT_TIMEOUT_S,
    DEFAULT_KEEP_ASKING_DAYS,
    DEFAULT_OFFER_MIN_APPROVALS,
    DEFAULT_OFFER_WINDOW_DAYS,
    DEFAULT_TURN_TIMEOUT_S,
    DEFAULT_WAKES_PER_HOUR,
)
from brain.events import EVENT_KINDS, Event, EventKind, from_body, from_connect
from brain.experts import ExpertRun
from brain.jobs import Jobs, job_note
from brain.masking import Masker, mask_json, mask_secrets
from brain.memory import Job, Memory, _compaction_text
from brain.mind.prompt import render_know, system_prompt, user_content
from brain.mind.resume import rebuild_history
from brain.mind.turn import Call, Model, run_turn
from brain.offers import Offers, OfferSettings
from brain.protocol import SayParams, SayResult, Tool
from brain.questions import ScoutQuestions
from brain.scheduler import Scheduler
from brain.side_check import SideCheck
from brain.timers import Timers
from brain.toolbox import BodySource, BrainSource, Toolbox
from brain.tools import brain_tools, expert_tools, home_tools, question_tools, timer_tools

log = logging.getLogger("brain")

DEFAULT_OFFER_SETTINGS = OfferSettings(
    DEFAULT_OFFER_MIN_APPROVALS, DEFAULT_OFFER_WINDOW_DAYS, DEFAULT_KEEP_ASKING_DAYS
)


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
        apps: Apps | None = None,
        tokens: TokenFile | None = None,
        wakes_per_hour: int = DEFAULT_WAKES_PER_HOUR,
        kinds: dict[str, EventKind] | None = None,
        offers: OfferSettings = DEFAULT_OFFER_SETTINGS,
        turn_timeout: float = DEFAULT_TURN_TIMEOUT_S,
        masker: Masker | None = None,
    ) -> None:
        self._model = model
        self._budget = budget
        self._bodies = bodies
        self._step_cap = step_cap
        self._turn_timeout = turn_timeout
        self._memory = memory
        self._asks = Asks(bodies)
        # One set of spend guards for the loop, the scheduler, the side-check and offers.
        self.guards = spend_guards(budget, step_cap)
        self.guards.add(wake_caps(wakes_per_hour))
        if masker is not None:  # what reaches disk (chat, approvals, job results) is masked
            self.guards.add(mask_secrets(masker))
        notify = bodies.notify
        # main passes the configured command and timeout; the defaults keep tests short.
        make_run = make_run or partial(
            ExpertRun, command=[DEFAULT_EXPERT_CMD], timeout=DEFAULT_EXPERT_TIMEOUT_S
        )
        # Built first: the questions and the timers emit through it. It only calls back into the
        # session once an event arrives, by which time the rest of __init__ has run.
        self.scheduler = Scheduler(
            bodies=bodies,
            budget=budget,
            guards=self.guards,
            busy=self._busy,
            last_body=lambda: self._last_body,
            start=lambda body_id, content: self._start_turn(body_id, content, "brain"),
            now=now,
            wakes_per_hour=wakes_per_hour,
            kinds=kinds or EVENT_KINDS,
        )
        questions = ScoutQuestions(self.scheduler.emit)
        approvals = Approvals(memory, notify, now, guards=self.guards)
        # Scout's look before an ask reaches the person; shares the session's model and budget.
        side_check = SideCheck(model, budget, memory, guards=self.guards)
        # Scout's offer to approve a repeated kind of ask; one service for tools and experts.
        offer = Offers(
            model, budget, memory, self._asks, approvals, offers, now, guards=self.guards
        )
        self.jobs = Jobs(
            memory,
            self._asks,
            notify,
            make_run,
            on_finished=self._on_job_finished,
            scout_questions=questions,
            approvals=approvals,
            side_check=side_check,
            offers=offer,
            guards=self.guards,
            on_away=self._on_job_away,
        )
        self.jobs.startup()  # rows left running by a dead brain become stopped
        timers = Timers(memory, self.scheduler.emit, now)
        tools = (
            brain_tools(memory, notify)
            + home_tools(budget, lambda: self.toolbox)
            + expert_tools(self.jobs)
            + timer_tools(memory, timers, now)
            + question_tools(questions)
            + approval_home_tools(approvals)
        )
        sources: list = []
        if apps is not None and tokens is not None:  # the two always come as a pair
            tools += app_home_tools(apps, memory, tokens, notify, bodies)
            # Before bodies: BodySource.unavailable claims any `x__y` name whose prefix is not an
            # online body, which would hide an app's own "not connected" line behind its slug.
            sources.append(AppSource(apps))
        sources.append(BodySource(bodies))

        def save_mode(name: str, mode: str) -> None:
            # Every save (Home's set_permission or an "always" answer) refreshes open panels.
            memory.set_permission_mode(name, mode)
            notify("changed", {"what": "permissions"})

        # The tool gate and its ask chain: nobody online, then Scout's look, then the person.
        self.guards.add(tool_mode(memory.permission_modes))
        self.guards.add(anyone_online(self._asks))
        self.guards.add(side_check_guard(side_check, approvals))
        self.guards.add(person_ask())
        self.toolbox = Toolbox(
            [BrainSource(tools), *sources],
            memory.permission_modes,
            save_mode,
            self._asks,
            approvals,
            side_check,
            offer,
            guards=self.guards,
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
        bodies.on_connect = self._on_connect
        for job in memory.unreported_jobs():  # ended while the brain was down, or never told
            self._on_job_finished(job)
        timers.start()

    def say(self, body_id: str, params: SayParams) -> SayResult:
        content = user_content(params)  # may raise ValueError before anything changes
        self._last_body = body_id
        # A finished task whose callback has not run yet is a dead turn: start a new one.
        if self._busy():
            self._inbox.append(content)
            return SayResult(turn=self._turn_id, joined=True)
        return SayResult(turn=self._start_turn(body_id, content), joined=False)

    def body_event(self, body_id: str, name: str, data: object) -> None:
        event = from_body(body_id, name, data)
        if event is not None:
            self.scheduler.emit(event)

    def _on_connect(self, body_id: str, away: float | None) -> None:
        event = from_connect(body_id, away)
        if event is not None:
            self.scheduler.emit(event)
        self.scheduler.pump()  # also starts a wake that was waiting for a body

    def _on_job_finished(self, job: Job) -> None:
        self.scheduler.emit(
            Event("job_ended", {"report": job_note(job)}, key=job.id),
            on_start=lambda: self._memory.mark_reported(job.id),
        )

    def _on_job_away(self, job_id: str, what: str) -> None:
        # No body was online to ask, so hold the news until one connects (no question id: nothing
        # is waiting on Scout). One held item per job.
        self.scheduler.emit(Event("job_question", {"job": job_id, "message": what}, key=job_id))

    def _busy(self) -> bool:
        return self._task is not None and not self._task.done()

    def _start_turn(
        self, body_id: str, content: list, started_by: Literal["user", "brain"] = "user"
    ) -> str:
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
            notify,
            "turn",
            {"turn": turn_id, "body": body_id, "state": "started", "started_by": started_by},
        )
        task = asyncio.create_task(
            run_turn(
                turn_id=turn_id,
                body_id=body_id,
                model=self._model,
                system=lambda: system_prompt(
                    self._now(), self._bodies.online(), know, self._focus()
                ),
                history=self.history,
                tools=self.toolbox.model_tools,
                run_tool=self.toolbox.run,
                inbox=self._inbox,
                notify=notify,
                budget=self._budget,
                step_cap=self._step_cap,
                guards=self.guards,
                turn_timeout=self._turn_timeout,
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

    def _focus(self) -> dict:
        return {key: ev.facts for key, ev in self.scheduler.latest("focus").items()}

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
        self.scheduler.turn_ended(turn_id)  # after ended, so the next turn's started comes second

    def _persist(self) -> None:
        # Saving is best effort: a full disk must not stop the ended notification.
        try:
            # A masked copy goes to disk; self.history keeps the real values for the live turn.
            new = mask_json(self.guards, "chat", self.history[self._saved :])
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
