"""Holds: an expert's permission request or question, held on a card with no timeout.

An expert is waiting on the person, so the card has no deadline: it stays up until it is answered
or its job or task ends. The wait is a future in memory that the card's answer event resolves
(the `expert_ask` and `question` handlers `Asks` calls). The card is an `expert_ask` open item
with the job's task, so Not now moves its check-back (the wait goes on) and Stop the task ends the
task and cancels every held card of it. The job keeps its slot meanwhile. The `ask` work row beside
it is the log entry; it ends with the answer, the cancel or the job.
"""

import asyncio
import uuid
from contextlib import suppress
from dataclasses import dataclass
from typing import TYPE_CHECKING, NamedTuple

from brain.asks import AskExpired, Asks
from brain.mind.turn import Call
from brain.open_items import OpenItemRefused, OpenItems, at_time
from brain.protocol import ErrorCode, RpcError
from brain.store.work import State, TransitionRefused, WorkStore

if TYPE_CHECKING:  # tasks imports tools, which imports jobs, which holds this
    from brain.tasks import Tasks


class Reply(NamedTuple):
    option: str  # "" when the person only typed
    text: str | None = None


@dataclass
class _Held:
    job_id: str | None
    part: str | None
    future: asyncio.Future[Reply]


class Holds:
    def __init__(
        self, asks: Asks, work: WorkStore, items: OpenItems, tasks: "Tasks | None" = None
    ) -> None:
        self.asks = asks
        self._work = work
        self._items = items
        self._tasks = tasks
        self._held: dict[str, _Held] = {}
        self._stopping: set[asyncio.Task] = set()  # held so a running stop is not collected
        asks.register("expert_ask", self._answered)
        asks.register("question", self._answered)
        work.on_transition(self._row_ended)

    def anyone_online(self) -> bool:
        return self.asks.anyone_online()

    async def permission(
        self,
        call: Call,
        spec_name: str,
        locked: bool,
        *,
        ask_id: str | None = None,
        parent_id: str | None = None,
    ) -> str:
        """The confirm card of an expert's tool call: allow, always or deny."""
        reply = await self.ask(
            kind="expert_ask",
            text=call.text,
            options=["allow", "deny"] if locked else ["allow", "always", "deny"],
            tool=spec_name,
            input=call.input,
            confirm=True,
            ask_id=ask_id,
            job_id=parent_id,
            part=None,  # the toolbox's card belongs to no part, so no part's end cancels it
        )
        return reply.option

    async def ask(
        self,
        *,
        kind: str,
        text: str,
        options: list[str],
        tool: str | None = None,
        input: dict | None = None,
        free_text: bool = False,
        confirm: bool = False,
        ask_id: str | None = None,
        job_id: str | None = None,
        part: str | None = "p1",
    ) -> Reply:
        """Show the card and wait for its answer, however long it takes. Raises RpcError
        (cancelled) when the part or task ends, AskExpired when the job's row ends."""
        ask_id = ask_id or uuid.uuid4().hex
        goal = None if job_id is None else self._work.get(job_id)
        if goal and goal.task_id and self._tasks:
            row = self._tasks.get(goal.task_id)
            if row is not None and row.state not in ("open", "waiting"):
                # Stop the task does not kill the job yet (T2d): it may not open a new card.
                raise RpcError(ErrorCode.cancelled, "the task has ended")
        item = self._items.open(
            "expert_ask",
            task_id=goal.task_id if goal else None,
            caused_by=((goal and goal.input) or {}).get("caused_by"),
            live_only=True,  # tied to the expert's process
            job_id=job_id,
            id=ask_id,
        )
        self._work.create(
            "ask", text, id=ask_id, state="active", parent_id=self._work.open_goal(job_id)
        )
        self._work.add_ask(ask_id, tool=tool)
        held = _Held(job_id, part, asyncio.get_running_loop().create_future())
        self._held[ask_id] = held
        self.asks.card(
            ask_id,
            kind=kind,
            text=text,
            options=options,
            tool=tool,
            input=input,
            free_text=free_text,
            confirm=confirm,
            task=self._tasks.card_fields(item) if self._tasks else None,
        )
        try:
            return await held.future
        except BaseException as err:
            self._held.pop(ask_id, None)
            item = self._items.get(ask_id)
            if isinstance(err, AskExpired):
                self.asks.expire(ask_id, err.reason)
            elif item is not None and item.state == "done" and item.reason == "approved":
                self.asks.close_answered(ask_id, "scout")  # Scout's side-check said yes first
            else:
                self.asks.cancel(ask_id)
            self._end_row(ask_id, "expired", "ask cancelled")
            with suppress(OpenItemRefused):  # a task stop or Scout's yes may have ended it
                self._items.expire(ask_id, "process_ended")
            raise

    def cancel_part(self, job_id: str, part: str) -> None:
        """The part ended: its held cards are cancelled and its experts told so."""
        for ask_id, held in list(self._held.items()):
            if (held.job_id, held.part) == (job_id, part):
                self._cancel(ask_id)

    def close(self, ask_ids: list[str]) -> None:
        """Cards ended from outside (Stop the task on another card): a held one is cancelled and
        its expert told; any other is only closed on the bodies."""
        for ask_id in ask_ids:
            if ask_id in self._held:
                self._cancel(ask_id)
            else:
                self.asks.card_closed(ask_id)

    def _cancel(self, ask_id: str) -> None:
        held = self._held.pop(ask_id, None)
        if held is not None and not held.future.done():
            held.future.set_exception(RpcError(ErrorCode.cancelled, "the ask was cancelled"))

    # ---- the card's answer ----

    def _answered(
        self, ask_id: str, option: str, body_id: str, text: str | None, check_back_at: str | None
    ) -> None:
        held = self._held.get(ask_id)
        if held is None:
            return  # it ended first
        if option == "not_now":
            try:
                item = self._items.not_now(ask_id, at_time(check_back_at), "person")
            except OpenItemRefused:
                return
            if item.check_back_at is not None and item.check_back_by is not None:
                self.asks.reschedule(ask_id, item.check_back_at.isoformat(), item.check_back_by)
        elif option == "stop_task":
            self._stop_task(ask_id, body_id)
        else:
            del self._held[ask_id]
            self._end_row(ask_id, "done", "answered", {"option": option})
            with suppress(OpenItemRefused):
                self._items.finish(ask_id, "answered")
            held.future.set_result(Reply(option, text))

    def _stop_task(self, ask_id: str, body_id: str) -> None:
        """The person ended the task from this card: the task ends (its jobs, timers and other
        cards with it). The answer is sync, so the stop runs as its own task."""
        item = self._items.get(ask_id)
        task = asyncio.get_running_loop().create_task(self._stop(ask_id, item, body_id))
        self._stopping.add(task)
        task.add_done_callback(self._stopping.discard)

    async def _stop(self, ask_id: str, item, body_id: str) -> None:
        if item and item.task_id and self._tasks:
            await self._tasks.stop(item.task_id, body_id)
        if ask_id in self._held:  # no task to stop, or it was over already: this card still goes
            self._cancel(ask_id)

    def _row_ended(self, work_id: str, kind: str, to: str) -> None:
        """The row ended from outside (its job closed, or a restart scan): the wait is done."""
        held = self._held.pop(work_id, None) if kind == "ask" else None
        if held is not None and not held.future.done():
            row = self._work.get(work_id)
            why = (row.end_reason if row is not None and row.end_reason else to).removeprefix(
                "parent ended: "
            )
            reason = f"job ended: {why}" if row is not None and row.parent_id else why
            held.future.set_exception(AskExpired(reason))

    def _end_row(self, ask_id: str, to: State, reason: str, data: dict | None = None) -> None:
        with suppress(TransitionRefused):  # its job already ended it
            self._work.settle(ask_id, to, reason, data)
