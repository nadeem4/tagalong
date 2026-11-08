"""Asks: open an ask to the bodies, wait for one person's answer.

`permission` is the tool gate's turn-bound confirm ask; `open` is for work with no turn
(expert jobs): custom options, optional typed answer, no default timeout. The waiting future
lives in memory; the `ask` work row beside it is the record, so a restart leaves an expired
row instead of nothing. A row ends with its ask (answered, timed out, cancelled) or with its
parent job. The first answer wins; later ones are not_found. Timeout and cancel close the ask
for every body. How the person's choice counts (approved, refused) is written by Approvals.
"""

import asyncio
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from brain.bodies import Bodies
from brain.mind.turn import Call
from brain.protocol import ErrorCode, RpcError
from brain.store.work import State, TransitionRefused, WorkStore

if TYPE_CHECKING:
    from brain.permission import OpenRecord


@dataclass(frozen=True)
class Answer:
    option: str | None  # None: nobody was online to ask
    text: str | None = None
    apps: tuple[str, ...] | None = (
        None  # a hand-off card's kept apps; None: the card was not edited
    )


class AskExpired(Exception):
    """The ask ended without an answer because the job above it ended."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class _Open:
    params: dict
    future: asyncio.Future[Answer]
    free_text: bool = False


ASK_TIMEOUT_S = 300.0  # how long a turn-bound card (choices, offers, setup) waits


class Asks:
    def __init__(self, bodies: Bodies, work: WorkStore) -> None:
        self._bodies = bodies
        self._work = work
        self._parked: set[str] = set()
        self._open: dict[str, _Open] = {}
        work.on_transition(self._row_ended)

    def anyone_online(self) -> bool:
        return bool(self._bodies.display_ids())  # a body that shows nothing cannot be asked

    async def permission(
        self,
        call: Call,
        spec_name: str,
        locked: bool,
        *,
        ask_id: str | None = None,
        parent_id: str | None = None,
        record: "OpenRecord | None" = None,
        reopen: bool = False,
    ) -> str:
        # `reopen`: the ask row already exists (a waiting ask shown again after a restart), so
        # only the card goes out. Nobody displaying is no reason to refuse: the ask stays open,
        # and a body that shows one later gets the open-ask replay.
        params = {
            "id": ask_id or uuid.uuid4().hex,
            "state": "open",
            "text": call.text,
            "options": ["allow", "deny"] if locked else ["allow", "always", "deny"],
            "confirm": True,
            "tool": spec_name,
            "input": call.input,
        }
        # An expert's call belongs to no turn of Scout's; a parked ask's turn is already over.
        if call.turn and params["id"] not in self._parked:
            params["turn"] = call.turn
        entry = _Open(params, asyncio.get_running_loop().create_future())
        return (await self._wait(entry, None, parent_id, record, reopen)).option or "deny"

    async def open(
        self,
        *,
        text: str,
        options: list[str],
        tool: str | None = None,
        input: dict | None = None,
        timeout: float | None = None,
        free_text: bool = False,
        ask_id: str | None = None,
        recommended: str | None = None,
        parent_id: str | None = None,
        stay_open: bool = False,
    ) -> Answer:
        # No turn and no confirm: a job's ask can outlive turns, and confirm asks only
        # allow the fixed allow/always/deny sets. Waits until closed unless timeout is given.
        if ask_id is not None and ask_id in self._open:
            raise ValueError(f"ask {ask_id} is already open")
        if recommended is not None and recommended not in options:
            raise ValueError("recommended must be one of the options")
        # A question or card is told to the person later by other means; a job's permission
        # ask says `stay_open` and waits for somebody to come back.
        if not stay_open and not self.anyone_online():
            return Answer(None)
        params: dict = {"id": ask_id or uuid.uuid4().hex, "state": "open", "text": text}
        params["options"] = options
        # Bodies only learn a text box is wanted, or what is recommended, from these fields.
        if free_text:
            params["free_text"] = True
        if recommended is not None:
            params["recommended"] = recommended
        if tool is not None:
            params["tool"] = tool
        if input is not None:
            params["input"] = input
        entry = _Open(params, asyncio.get_running_loop().create_future(), free_text)
        return await self._wait(entry, timeout, parent_id)

    async def _wait(
        self,
        entry: _Open,
        timeout: float | None,
        parent_id: str | None,
        record: "OpenRecord | None" = None,
        reopen: bool = False,
    ) -> Answer:
        ask_id = entry.params["id"]
        self._open[ask_id] = entry
        if not reopen:
            self._record_open(entry.params, parent_id, record)
        self._bodies.notify("ask", entry.params)
        try:
            async with asyncio.timeout(timeout):
                return await entry.future
        except TimeoutError:
            if entry.future.done() and not entry.future.cancelled():
                return entry.future.result()  # the answer landed just before the timeout
            self._close(ask_id, "timeout")
            raise RpcError(ErrorCode.timeout, "nobody answered the ask in time") from None
        except asyncio.CancelledError:
            self._close(ask_id, "cancelled")
            raise
        finally:
            self._parked.discard(ask_id)  # answered, timed out, cancelled or ended with its job

    def cancel_all(self, ask_ids: Iterable[str]) -> None:
        """Close the named open asks as cancelled; their waiters get a cancelled error."""
        for ask_id in ask_ids:
            entry = self._open.get(ask_id)
            # A done future means its waiter was cancelled or timed out; it closes the ask itself.
            if entry is not None and not entry.future.done():
                del self._open[ask_id]
                entry.future.set_exception(RpcError(ErrorCode.cancelled, "the ask was cancelled"))
                self._bodies.notify("ask", {"id": ask_id, "state": "closed", "reason": "cancelled"})
                self._end_row(ask_id, "expired", "ask cancelled")

    def answer(
        self,
        ask_id: str,
        option: str,
        body_id: str,
        text: str | None = None,
        apps: Iterable[str] | None = None,
    ) -> None:
        entry = self._open.get(ask_id)
        # A done future means the wait was cancelled or timed out and is about to close.
        if entry is None or entry.future.done():
            raise RpcError(ErrorCode.not_found, f"no open ask {ask_id}")
        if option not in entry.params["options"] and not (entry.free_text and text):
            raise RpcError(ErrorCode.invalid_params, f"{option} is not offered by this ask")
        del self._open[ask_id]
        entry.future.set_result(Answer(option, text, None if apps is None else tuple(apps)))
        closed = {"id": ask_id, "state": "closed", "reason": "answered"}
        self._bodies.notify("ask", {**closed, "option": option, "by": body_id})
        self._end_row(ask_id, "done", "answered", {"option": option})

    def park(self, ask_id: str) -> None:
        """The turn that raised this ask is over: a replayed card must not name it."""
        self._parked.add(ask_id)  # the row may not be open yet (nobody displays)
        entry = self._open.get(ask_id)
        if entry is not None:
            entry.params.pop("turn", None)

    def expire(self, ask_id: str, reason: str) -> bool:
        """The deadline passed: free the waiter with `reason` and close the card for every body.
        False when the ask is not live here; the caller then logs the end itself."""
        entry = self._open.get(ask_id)
        if entry is None or entry.future.done():
            return False
        del self._open[ask_id]
        entry.future.set_exception(AskExpired(reason))
        self._bodies.notify("ask", {"id": ask_id, "state": "closed", "reason": "timeout"})
        return True

    def is_open(self, ask_id: str) -> bool:
        """The ask has a card showing in this session (a restart leaves none)."""
        return ask_id in self._open

    def open_asks(self) -> list[dict]:
        return [dict(e.params) for e in self._open.values()]

    def _close(self, ask_id: str, reason: str) -> None:
        if self._open.pop(ask_id, None) is not None:
            self._bodies.notify("ask", {"id": ask_id, "state": "closed", "reason": reason})
            self._end_row(
                ask_id, "expired", "timed out" if reason == "timeout" else "ask cancelled"
            )

    def _row_ended(self, work_id: str, kind: str, to: str) -> None:
        """The row ended from outside (its job closed, or a restart scan): the waiter is done."""
        entry = self._open.pop(work_id, None) if kind == "ask" else None
        if entry is not None and not entry.future.done():
            row = self._work.get(work_id)
            why = (row.end_reason if row is not None and row.end_reason else to).removeprefix(
                "parent ended: "
            )
            reason = f"job ended: {why}" if row is not None and row.parent_id else why
            entry.future.set_exception(AskExpired(reason))
            self._bodies.notify("ask", {"id": work_id, "state": "closed", "reason": "timeout"})

    def _record_open(
        self, params: dict, parent_id: str | None, record: "OpenRecord | None" = None
    ) -> None:
        ask_id = params["id"]
        self._work.create(
            "ask",
            params["text"],
            id=ask_id,
            state="active",
            parent_id=self._work.open_goal(parent_id),
            input=None if record is None else record.call,
            due_at=None if record is None else record.due_at,
            safe_to_retry=record is not None and record.safe_to_retry,
        )
        if record is None:
            self._work.add_ask(ask_id, tool=params.get("tool"))
        else:
            self._work.add_ask(
                ask_id,
                source=record.source,
                tool=params.get("tool"),
                summary=record.summary,
                input=record.input,
                group_key=record.group_key,
            )

    def _end_row(self, ask_id: str, to: State, reason: str, data: dict | None = None) -> None:
        try:
            self._work.settle(ask_id, to, reason, data)
        except TransitionRefused:
            pass  # its job already ended it
