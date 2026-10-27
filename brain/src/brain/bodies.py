"""Connected bodies, their tools, a per-body outbox of numbered notifications, and `use` calls.

No socket code: the server's Peer enqueues writes, and connect() returns the backlog
instead of sending it so the hello result can go out first. Outboxes outlive connections
(kept per body id) so a reconnect can replay what it missed. `use` requests are not
replayed: each is bound to the peer it was sent on and fails if that peer goes away.
"""

import asyncio
import contextlib
import json
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from brain.protocol import LIMITS, Body, ErrorCode, RpcError, Tool


class Peer(Protocol):
    def send(self, frame: str) -> None: ...

    def close(self) -> None: ...


class Outbox:
    def __init__(
        self,
        max_count: int = LIMITS["replay_count"],
        max_age_ms: int = LIMITS["replay_ms"],
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.latest = 0
        self._max_count = max_count
        self._max_age = max_age_ms / 1000
        self._clock = clock
        self._entries: deque[tuple[int, float, str]] = deque()  # (seq, time, frame)

    def add(self, method: str, params: dict) -> str:
        self.latest += 1
        frame = json.dumps(
            {"jsonrpc": "2.0", "method": method, "params": {**params, "seq": self.latest}}
        )
        self._entries.append((self.latest, self._clock(), frame))
        self._prune()
        return frame

    def since(self, last_seq: int) -> list[str] | None:
        self._prune()
        if last_seq > self.latest:
            return None
        if last_seq == self.latest:
            return []
        # Everything after last_seq must still be held, else the body has a gap.
        if not self._entries or self._entries[0][0] > last_seq + 1:
            return None
        return [frame for seq, _, frame in self._entries if seq > last_seq]

    def _prune(self) -> None:
        while len(self._entries) > self._max_count:
            self._entries.popleft()
        cutoff = self._clock() - self._max_age
        while self._entries and self._entries[0][1] < cutoff:
            self._entries.popleft()


@dataclass(frozen=True)
class Joined:
    seq: int
    resync: bool
    backlog: list[str]


@dataclass
class _Online:
    body: Body
    tools: list[Tool]
    peer: Peer


class Bodies:
    def __init__(self) -> None:
        self._outboxes: dict[str, Outbox] = {}
        self._online: dict[str, _Online] = {}
        self._known: dict[str, list[Tool]] = {}  # last declared tools, kept after disconnect
        self._pending: dict[str, tuple[Peer, asyncio.Future[list[dict]]]] = {}
        self._next_id = 0

    def connect(self, body: Body, tools: list[Tool], peer: Peer, last_seq: int | None) -> Joined:
        box = self._outboxes.setdefault(body.id, Outbox())
        old = self._online.get(body.id)
        if old is not None:
            old.peer.close()
            self._fail_pending(old.peer)
        self._online[body.id] = _Online(body, tools, peer)
        self._known[body.id] = tools
        if last_seq is None:
            return Joined(box.latest, False, [])
        missed = box.since(last_seq)
        if missed is None:
            return Joined(box.latest, True, [])
        return Joined(box.latest, False, missed)

    def disconnect(self, body_id: str, peer: Peer) -> None:
        current = self._online.get(body_id)
        if current is not None and current.peer is peer:
            del self._online[body_id]
        self._fail_pending(peer)

    def set_tools(self, body_id: str, peer: Peer, tools: list[Tool]) -> None:
        # A replaced connection may still deliver a frame; only the current peer counts.
        current = self._online.get(body_id)
        if current is not None and current.peer is peer:
            current.tools = tools
            self._known[body_id] = tools

    def tools(self, body_id: str) -> list[Tool]:
        return self._online[body_id].tools

    def known_tools(self) -> dict[str, list[Tool]]:
        # Home lists permissions for tools whose body is offline right now.
        return dict(self._known)

    def online(self) -> list[Body]:
        return [o.body for o in self._online.values()]

    def notify(self, method: str, params: dict) -> None:
        for body_id, box in self._outboxes.items():
            frame = box.add(method, params)
            if body_id in self._online:
                self._online[body_id].peer.send(frame)

    def notify_one(self, body_id: str, method: str, params: dict) -> None:
        # Queued even when offline, so the body sees it on reconnect within the replay window.
        frame = self._outboxes.setdefault(body_id, Outbox()).add(method, params)
        if body_id in self._online:
            self._online[body_id].peer.send(frame)

    def online_ids(self) -> list[str]:
        return list(self._online)

    def is_online(self, body_id: str) -> bool:
        return body_id in self._online

    async def use(
        self, body_id: str, call_id: str, tool: str, tool_input: dict, timeout: float = 30.0
    ) -> list[dict]:
        current = self._online.get(body_id)
        if current is None:
            raise RpcError(ErrorCode.body_offline, f"{body_id} is offline")
        peer = current.peer
        self._next_id += 1
        request_id = f"u{self._next_id}"
        future: asyncio.Future[list[dict]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = (peer, future)
        try:
            peer.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "method": "use",
                        "params": {"call": call_id, "tool": tool, "input": tool_input},
                    }
                )
            )
            async with asyncio.timeout(timeout):
                return await future
        except TimeoutError:
            self._cancel(peer, call_id)
            raise RpcError(ErrorCode.timeout, f"{tool} timed out after {timeout:g}s") from None
        except asyncio.CancelledError:
            self._cancel(peer, call_id)
            raise
        finally:
            # Always drop the entry so a late or duplicate response finds nothing to resolve.
            self._pending.pop(request_id, None)

    def resolve(self, body_id: str, peer: Peer, message: dict) -> None:
        # A body is untrusted input: a bad id is ignored, a bad shape fails only that call.
        request_id = message.get("id")
        if not isinstance(request_id, str):
            return
        entry = self._pending.get(request_id)
        if entry is None or entry[0] is not peer or entry[1].done():
            return
        future = entry[1]
        try:
            error = message.get("error")
            if error is None:
                future.set_result(message["result"]["output"])
                return
            try:
                code = ErrorCode(error.get("code"))
            except ValueError:
                code = ErrorCode.tool_failed
            future.set_exception(RpcError(code, str(error.get("message", ""))))
        except (AttributeError, KeyError, TypeError):
            future.set_exception(RpcError(ErrorCode.tool_failed, "malformed response from body"))

    def _cancel(self, peer: Peer, call_id: str) -> None:
        # Best effort: the peer may already be gone.
        with contextlib.suppress(Exception):
            peer.send(
                json.dumps({"jsonrpc": "2.0", "method": "cancel", "params": {"call": call_id}})
            )

    def _fail_pending(self, peer: Peer) -> None:
        for held, future in list(self._pending.values()):
            if held is peer and not future.done():
                future.set_exception(
                    RpcError(ErrorCode.body_offline, "the body went offline (disconnected)")
                )
