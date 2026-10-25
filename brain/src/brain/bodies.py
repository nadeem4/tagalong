"""Connected bodies, their tools, and a per-body outbox of numbered notifications.

Pure and synchronous on purpose: the server's Peer enqueues writes, and connect()
returns the backlog instead of sending it so the hello result can go out first.
Outboxes outlive connections (kept per body id) so a reconnect can replay what it missed.
"""

import json
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from brain.protocol import LIMITS, Body, Tool


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

    def connect(self, body: Body, tools: list[Tool], peer: Peer, last_seq: int | None) -> Joined:
        box = self._outboxes.setdefault(body.id, Outbox())
        old = self._online.get(body.id)
        if old is not None:
            old.peer.close()
        self._online[body.id] = _Online(body, tools, peer)
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

    def set_tools(self, body_id: str, peer: Peer, tools: list[Tool]) -> None:
        # A replaced connection may still deliver a frame; only the current peer counts.
        current = self._online.get(body_id)
        if current is not None and current.peer is peer:
            current.tools = tools

    def tools(self, body_id: str) -> list[Tool]:
        return self._online[body_id].tools

    def online(self) -> list[Body]:
        return [o.body for o in self._online.values()]

    def notify(self, method: str, params: dict) -> None:
        for body_id, box in self._outboxes.items():
            frame = box.add(method, params)
            if body_id in self._online:
                self._online[body_id].peer.send(frame)
