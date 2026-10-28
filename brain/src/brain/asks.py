"""Asks: open an ask to the bodies, wait for one person's answer.

`permission` is the tool gate's turn-bound confirm ask; `open` is for work with no turn
(expert jobs): custom options, optional typed answer, no default timeout. Asks live only in
memory; open ones are listed so a reconnecting body can see them. The first answer wins;
later ones are not_found. Timeout and cancel close the ask for every body.
"""

import asyncio
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from brain.bodies import Bodies
from brain.mind.turn import Call
from brain.protocol import ErrorCode, RpcError


@dataclass(frozen=True)
class Answer:
    option: str | None  # None: nobody was online to ask
    text: str | None = None


@dataclass
class _Open:
    params: dict
    future: asyncio.Future[Answer]
    free_text: bool = False


class Asks:
    def __init__(self, bodies: Bodies, timeout: float = 300.0) -> None:
        self._bodies = bodies
        self._timeout = timeout
        self._open: dict[str, _Open] = {}

    def anyone_online(self) -> bool:
        return bool(self._bodies.online_ids())

    async def permission(self, call: Call, spec_name: str, locked: bool) -> str:
        if not self.anyone_online():
            return "deny"
        ask_id = uuid.uuid4().hex
        params = {
            "id": ask_id,
            "state": "open",
            "turn": call.turn,
            "text": call.text,
            "options": ["allow", "deny"] if locked else ["allow", "always", "deny"],
            "confirm": True,
            "tool": spec_name,
            "input": call.input,
        }
        entry = _Open(params, asyncio.get_running_loop().create_future())
        return (await self._wait(entry, self._timeout)).option or "deny"

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
    ) -> Answer:
        # No turn and no confirm: a job's ask can outlive turns, and confirm asks only
        # allow the fixed allow/always/deny sets. Waits until closed unless timeout is given.
        if not self.anyone_online():
            return Answer(None)
        params: dict = {"id": ask_id or uuid.uuid4().hex, "state": "open", "text": text}
        params["options"] = options
        if tool is not None:
            params["tool"] = tool
        if input is not None:
            params["input"] = input
        entry = _Open(params, asyncio.get_running_loop().create_future(), free_text)
        return await self._wait(entry, timeout)

    async def _wait(self, entry: _Open, timeout: float | None) -> Answer:
        ask_id = entry.params["id"]
        self._open[ask_id] = entry
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

    def cancel_all(self, ask_ids: Iterable[str]) -> None:
        """Close the named open asks as cancelled; their waiters get a cancelled error."""
        for ask_id in ask_ids:
            entry = self._open.pop(ask_id, None)
            if entry is not None:
                entry.future.set_exception(RpcError(ErrorCode.cancelled, "the ask was cancelled"))
                self._bodies.notify("ask", {"id": ask_id, "state": "closed", "reason": "cancelled"})

    def answer(self, ask_id: str, option: str, body_id: str, text: str | None = None) -> None:
        entry = self._open.get(ask_id)
        # A done future means the wait was cancelled or timed out and is about to close.
        if entry is None or entry.future.done():
            raise RpcError(ErrorCode.not_found, f"no open ask {ask_id}")
        if option not in entry.params["options"] and not (entry.free_text and text):
            raise RpcError(ErrorCode.invalid_params, f"{option} is not offered by this ask")
        del self._open[ask_id]
        entry.future.set_result(Answer(option, text))
        closed = {"id": ask_id, "state": "closed", "reason": "answered"}
        self._bodies.notify("ask", {**closed, "option": option, "by": body_id})

    def open_asks(self) -> list[dict]:
        return [dict(e.params) for e in self._open.values()]

    def _close(self, ask_id: str, reason: str) -> None:
        if self._open.pop(ask_id, None) is not None:
            self._bodies.notify("ask", {"id": ask_id, "state": "closed", "reason": reason})
