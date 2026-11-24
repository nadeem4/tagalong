"""Connected bodies, their tools, a per-body outbox of numbered notifications, and `use` calls.

No socket code: the server's Peer enqueues writes, and connect() returns the backlog
instead of sending it so the hello result can go out first. Outboxes outlive connections
(kept per body id) so a reconnect can replay what it missed. `use` requests are not
replayed: each is bound to the peer it was sent on and fails if that peer goes away.
`WriteQueue` is the bounded write queue each connection owns: live-only audio frames are
dropped oldest-first when it is over its cap; frames carrying `seq`, the speech `done` and
voice status frames are never dropped.
"""

import asyncio
import base64
import contextlib
import json
import logging
import time
import uuid
from collections import deque
from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Protocol

from brain.auth import Principal
from brain.pipes import Pipe
from brain.protocol import (
    BODY_WHATSAPP,
    LIMITS,
    Body,
    ErrorCode,
    PipeCloseParams,
    PipeDataParams,
    PipeSpec,
    RpcError,
    Tool,
)

log = logging.getLogger("brain")

# The body whose `call` a Home tool is serving, for tools that answer differently per caller.
CALLER: ContextVar[str | None] = ContextVar("caller", default=None)


# Frames a connection may hold before the oldest speech audio chunks are dropped. Audio is the
# only thing that piles up (a slow body, a long reply), and a late chunk is worth less than a
# fresh one.
MAX_QUEUED_FRAMES = 256


class LiveFrame(str):
    """A speech audio chunk (live-only, no `seq`): the one kind a full queue may drop. A speech
    `done`, a text-only line and the voice status frames are live-only too but never droppable:
    a body that misses one is left waiting."""


class WriteQueue:
    """One connection's frames, in order, for a single writer to drain. `put` never waits."""

    def __init__(self, cap: int = MAX_QUEUED_FRAMES) -> None:
        self._cap = cap
        self._items: deque[str | None] = deque()
        self._wake = asyncio.Event()

    def put(self, frame: str) -> None:
        self._items.append(frame)
        if len(self._items) > self._cap:
            self._drop_oldest_audio()
        self._wake.set()

    def close(self) -> None:
        self._items.append(None)
        self._wake.set()

    async def get(self) -> str | None:
        while not self._items:
            self._wake.clear()
            await self._wake.wait()
        return self._items.popleft()

    def _drop_oldest_audio(self) -> None:
        kept: deque[str | None] = deque()
        excess = len(self._items) - self._cap
        for item in self._items:
            if excess > 0 and isinstance(item, LiveFrame):
                excess -= 1
            else:
                kept.append(item)
        self._items = kept


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
    local: bool  # connected on the brain's own machine (the loopback listener)
    device_id: str | None = None  # the paired device behind it; None for the local token


class Bodies:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._offline_at: dict[str, float] = {}  # when each offline body went away
        self._outboxes: dict[str, Outbox] = {}
        self._online: dict[str, _Online] = {}
        self._known: dict[str, list[Tool]] = {}  # last declared tools, kept after disconnect
        self._names: dict[str, str] = {}  # each body's declared name, kept after disconnect
        self._owners: dict[str, str] = {}
        self._pending: dict[str, tuple[Peer, asyncio.Future[dict]]] = {}
        self._pipes: dict[str, tuple[str, Pipe]] = {}  # pipe id -> (body id, pipe)
        self._next_id = 0
        # Session sets this: (body id, seconds it was away, None if unknown) so a wake that
        # waited for a body can start and a long absence can be noticed.
        self.on_connect: Callable[[str, float | None], None] | None = None

    def name(self, body_id: str) -> str:
        """The name a body declared, even after it left; its id if it never connected."""
        return self._names.get(body_id, body_id)

    def connect(
        self,
        body: Body,
        tools: list[Tool],
        peer: Peer,
        last_seq: int | None,
        principal: Principal,
    ) -> Joined | None:
        """None when the body id already belongs to another principal."""
        if self._owners.setdefault(body.id, principal.key) != principal.key:
            return None
        box = self._outboxes.setdefault(body.id, Outbox())
        old = self._online.get(body.id)
        if old is not None:
            old.peer.close()
            self._fail_pending(old.peer)
        self._online[body.id] = _Online(body, tools, peer, principal.local, principal.device_id)
        self._known[body.id] = tools
        self._names[body.id] = body.name
        gone_at = self._offline_at.pop(body.id, None)
        away = None if gone_at is None else self._clock() - gone_at
        if self.on_connect is not None:
            try:
                self.on_connect(body.id, away)
            except Exception:  # a failed wake must not leave the body half-connected
                log.exception("on_connect failed")
        if last_seq is None:
            return Joined(box.latest, False, [])
        missed = box.since(last_seq)
        if missed is None:
            return Joined(box.latest, True, [])
        return Joined(box.latest, False, missed)

    def drop_principal(self, key: str) -> None:
        """Close every connection of a principal (a revoked device) and free its body ids; each
        handler then cleans up."""
        for body_id in [b for b, owner in self._owners.items() if owner == key]:
            del self._owners[body_id]
            online = self._online.get(body_id)
            if online is not None:
                online.peer.close()

    def is_current(self, body_id: str, peer: Peer) -> bool:
        current = self._online.get(body_id)
        return current is not None and current.peer is peer

    def disconnect(self, body_id: str, peer: Peer) -> bool:
        """Drop the body if `peer` is its current connection; say whether it was."""
        was_current = self.is_current(body_id, peer)
        if was_current:
            del self._online[body_id]
            self._offline_at[body_id] = self._clock()
            self._end_pipes(body_id)
        self._fail_pending(peer)
        return was_current

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

    def device_id(self, body_id: str) -> str | None:
        online = self._online.get(body_id)
        return online.device_id if online else None

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

    def send_live(self, body_id: str, method: str, params: dict) -> bool:
        # Live-only: no seq, not in the outbox, never replayed. Stale audio must not come back
        # after a reconnect, so an offline body simply misses it.
        current = self._online.get(body_id)
        if current is None:
            return False
        frame = json.dumps({"jsonrpc": "2.0", "method": method, "params": params})
        chunk = method == "speech" and "pcm" in params
        current.peer.send(LiveFrame(frame) if chunk else frame)
        return True

    def online_ids(self) -> list[str]:
        return list(self._online)

    def display_ids(self) -> list[str]:
        # Bodies that can show a turn or an ask (display=false shows nothing), screens first and
        # a phone chat last: Scout speaks first on a screen, and on the phone only when it is
        # the one place left.
        shown = [i for i, o in self._online.items() if o.body.display is not False]
        return sorted(shown, key=self.is_phone)

    def is_phone(self, body_id: str | None) -> bool:
        current = self._online.get(body_id) if body_id is not None else None
        return current is not None and current.body.kind == BODY_WHATSAPP

    def body(self, body_id: str) -> Body | None:
        current = self._online.get(body_id)
        return current.body if current is not None else None

    def is_local(self, body_id: str | None) -> bool:
        current = self._online.get(body_id) if body_id is not None else None
        return current is not None and current.local

    def is_online(self, body_id: str) -> bool:
        return body_id in self._online

    async def use(
        self, body_id: str, call_id: str, tool: str, tool_input: dict, timeout: float = 30.0
    ) -> list[dict]:
        result = await self._request(
            body_id,
            "use",
            {"call": call_id, "tool": tool, "input": tool_input},
            timeout,
            cancel_call=call_id,
            what=tool,
        )
        try:
            return result["output"]
        except (KeyError, TypeError):
            raise RpcError(ErrorCode.tool_failed, "malformed response from body") from None

    async def folder_exists(self, body_id: str, path: str, timeout: float = 10.0) -> bool:
        """Whether a folder exists on a node's machine; a node that cannot answer says no."""
        try:
            result = await self._request(body_id, "folder_check", {"path": path}, timeout)
        except RpcError:
            return False
        return bool(result.get("exists"))

    async def _request(
        self,
        body_id: str,
        method: str,
        params: dict,
        timeout: float,
        *,
        cancel_call: str | None = None,
        what: str = "",
    ) -> dict:
        current = self._online.get(body_id)
        if current is None:
            raise RpcError(ErrorCode.body_offline, f"{body_id} is offline")
        peer = current.peer
        self._next_id += 1
        request_id = f"u{self._next_id}"
        future: asyncio.Future[dict] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = (peer, future)
        try:
            peer.send(
                json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
            )
            async with asyncio.timeout(timeout):
                return await future
        except TimeoutError:
            if cancel_call is not None:
                self._cancel(peer, cancel_call)
            name = what or method
            raise RpcError(ErrorCode.timeout, f"{name} timed out after {timeout:g}s") from None
        except asyncio.CancelledError:
            if cancel_call is not None:
                self._cancel(peer, cancel_call)
            raise
        finally:
            # Always drop the entry so a late or duplicate response finds nothing to resolve.
            self._pending.pop(request_id, None)

    async def open_pipe(self, body_id: str, spec: PipeSpec, timeout: float = 10.0) -> Pipe:
        """Ask a node to start an allowed command; the node's refusal comes back as RpcError."""
        pipe_id = uuid.uuid4().hex

        def send(data: bytes) -> None:
            encoded = base64.b64encode(data).decode()
            self.send_live(body_id, "pipe_data", {"pipe": pipe_id, "data": encoded})

        def close() -> None:
            self._pipes.pop(pipe_id, None)
            self.send_live(body_id, "pipe_close", {"pipe": pipe_id})

        pipe = Pipe(send, close)
        self._pipes[pipe_id] = (body_id, pipe)
        try:
            await self._request(
                body_id,
                "pipe_open",
                {"pipe": pipe_id, "spec": spec.model_dump(exclude_none=True)},
                timeout,
            )
        except BaseException as exc:
            self._pipes.pop(pipe_id, None)
            if isinstance(exc, RpcError) and exc.code == ErrorCode.timeout:
                self.send_live(body_id, "pipe_close", {"pipe": pipe_id})  # it may have started
            raise
        return pipe

    def pipe_event(self, body_id: str, peer: Peer, method: str, params: Any) -> None:
        """A node's pipe_data or pipe_close; only the node that owns the pipe may speak for it."""
        if not self.is_current(body_id, peer):
            return
        try:
            if method == "pipe_data":
                data = PipeDataParams.model_validate(params)
                if (pipe := self._owned_pipe(body_id, data.pipe)) is not None:
                    pipe.feed(data.data)
            elif method == "pipe_close":
                closed = PipeCloseParams.model_validate(params)
                if (pipe := self._owned_pipe(body_id, closed.pipe)) is not None:
                    del self._pipes[closed.pipe]
                    pipe.end()
        except ValueError:
            return

    def _owned_pipe(self, body_id: str, pipe_id: str) -> Pipe | None:
        owned = self._pipes.get(pipe_id)
        return owned[1] if owned is not None and owned[0] == body_id else None

    def _end_pipes(self, body_id: str) -> None:
        for pipe_id, (owner, pipe) in list(self._pipes.items()):
            if owner == body_id:
                del self._pipes[pipe_id]
                pipe.end()

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
                future.set_result(message["result"])
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
