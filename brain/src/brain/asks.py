"""Permission asks: open a confirm ask to the bodies, wait for one person's answer.

Asks live only in memory; open ones are listed so a reconnecting body can see them.
The first answer wins; later ones are not_found. Timeout and cancel close the ask for
every body so no dialog is left hanging.
"""

import asyncio
import uuid
from dataclasses import dataclass

from brain.bodies import Bodies
from brain.mind.turn import Call
from brain.protocol import ErrorCode, RpcError


@dataclass
class _Open:
    params: dict
    future: asyncio.Future[str]


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
        self._open[ask_id] = entry
        self._bodies.notify("ask", params)
        try:
            async with asyncio.timeout(self._timeout):
                return await entry.future
        except TimeoutError:
            if entry.future.done() and not entry.future.cancelled():
                return entry.future.result()  # the answer landed just before the timeout
            self._close(ask_id, "timeout")
            raise RpcError(ErrorCode.timeout, "nobody answered the ask in time") from None
        except asyncio.CancelledError:
            self._close(ask_id, "cancelled")
            raise

    def answer(self, ask_id: str, option: str, body_id: str) -> None:
        entry = self._open.get(ask_id)
        # A done future means the wait was cancelled or timed out and is about to close.
        if entry is None or entry.future.done():
            raise RpcError(ErrorCode.not_found, f"no open ask {ask_id}")
        if option not in entry.params["options"]:
            raise RpcError(ErrorCode.invalid_params, f"{option} is not offered by this ask")
        del self._open[ask_id]
        entry.future.set_result(option)
        closed = {"id": ask_id, "state": "closed", "reason": "answered"}
        self._bodies.notify("ask", {**closed, "option": option, "by": body_id})

    def open_asks(self) -> list[dict]:
        return [dict(e.params) for e in self._open.values()]

    def _close(self, ask_id: str, reason: str) -> None:
        if self._open.pop(ask_id, None) is not None:
            self._bodies.notify("ask", {"id": ask_id, "state": "closed", "reason": reason})
