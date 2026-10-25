"""Checks the per-body outbox (seq, replay, resync) and the Bodies registry.

Pure unit tests with a fake peer: no sockets, and the clock is injected so the replay
window can be tested without sleeping.
"""

import json

from brain.bodies import Bodies, Joined, Outbox
from brain.protocol import Body, Tool


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class FakePeer:
    def __init__(self) -> None:
        self.frames: list[str] = []
        self.closed = False

    def send(self, frame: str) -> None:
        self.frames.append(frame)

    def close(self) -> None:
        self.closed = True


def seqs(frames: list[str]) -> list[int]:
    return [json.loads(f)["params"]["seq"] for f in frames]


def body(id: str) -> Body:
    return Body(id=id, kind="desktop", name=id)


def tool(name: str) -> Tool:
    return Tool(name=name, description="d", input_schema={"type": "object"})


def test_seq_starts_at_one_and_rises():
    box = Outbox()
    a = json.loads(box.add("say", {"text": "hi"}))
    b = json.loads(box.add("say", {"text": "yo"}))
    assert a == {"jsonrpc": "2.0", "method": "say", "params": {"text": "hi", "seq": 1}}
    assert b["params"]["seq"] == 2
    assert box.latest == 2


def test_since_returns_missed_in_order():
    box = Outbox()
    for _ in range(4):
        box.add("m", {})
    assert seqs(box.since(1)) == [2, 3, 4]


def test_since_latest_is_empty():
    box = Outbox()
    box.add("m", {})
    assert box.since(1) == []


def test_resync_when_last_seq_ahead():
    assert Outbox().since(5) is None


def test_resync_when_pruned_by_count():
    box = Outbox(max_count=3)
    for _ in range(5):
        box.add("m", {})
    assert box.since(1) is None
    assert seqs(box.since(2)) == [3, 4, 5]


def test_resync_when_pruned_by_age():
    clock = Clock()
    box = Outbox(max_age_ms=1000, clock=clock)
    box.add("m", {})
    clock.now = 1.5
    assert box.since(0) is None


def test_connect_first_time():
    bodies = Bodies()
    peer = FakePeer()
    joined = bodies.connect(body("a"), [tool("t")], peer, None)
    assert joined == Joined(0, False, [])
    assert bodies.online() == [body("a")]
    assert bodies.tools("a") == [tool("t")]


def test_notify_reaches_online_and_queues_offline():
    bodies = Bodies()
    a, b = FakePeer(), FakePeer()
    bodies.connect(body("a"), [], a, None)
    bodies.connect(body("b"), [], b, None)
    bodies.disconnect("b", b)
    bodies.notify("say", {"text": "x"})
    assert seqs(a.frames) == [1]
    assert b.frames == []
    joined = bodies.connect(body("b"), [], FakePeer(), 0)
    assert joined.seq == 1 and not joined.resync
    assert seqs(joined.backlog) == [1]


def test_reconnect_replays_missed():
    bodies = Bodies()
    peer = FakePeer()
    bodies.connect(body("a"), [], peer, None)
    bodies.disconnect("a", peer)
    for _ in range(3):
        bodies.notify("m", {})
    joined = bodies.connect(body("a"), [], FakePeer(), 0)
    assert joined.seq == 3
    assert seqs(joined.backlog) == [1, 2, 3]


def test_connect_resync_when_ahead():
    bodies = Bodies()
    joined = bodies.connect(body("a"), [], FakePeer(), 9)
    assert joined == Joined(0, True, [])


def test_newer_connection_wins():
    bodies = Bodies()
    old, new = FakePeer(), FakePeer()
    bodies.connect(body("a"), [], old, None)
    bodies.connect(body("a"), [], new, None)
    assert old.closed and not new.closed
    bodies.disconnect("a", old)
    assert bodies.online() == [body("a")]
    bodies.notify("m", {})
    assert old.frames == [] and len(new.frames) == 1


def test_set_tools_replaces():
    bodies = Bodies()
    bodies.connect(body("a"), [tool("x")], FakePeer(), None)
    peer = FakePeer()
    bodies.connect(body("a"), [tool("x")], peer, None)
    bodies.set_tools("a", peer, [tool("y")])
    assert bodies.tools("a") == [tool("y")]


def test_set_tools_from_stale_peer_is_ignored():
    bodies = Bodies()
    old, new = FakePeer(), FakePeer()
    bodies.connect(body("a"), [tool("x")], old, None)
    bodies.connect(body("a"), [tool("x")], new, None)
    bodies.set_tools("a", old, [tool("stale")])
    assert bodies.tools("a") == [tool("x")]
