"""Checks the per-body outbox (seq, replay, resync) and the Bodies registry.

Pure unit tests with a fake peer: no sockets, and the clock is injected so the replay
window can be tested without sleeping.
"""

import asyncio
import json

import pytest

from brain.bodies import Bodies, Joined, Outbox
from brain.protocol import Body, ErrorCode, RpcError, Tool


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


def test_a_raising_on_connect_does_not_break_connect():
    bodies = Bodies()

    def boom() -> None:
        raise RuntimeError("wake failed")

    bodies.on_connect = boom
    joined = bodies.connect(body("a"), [], FakePeer(), None)
    assert joined == Joined(0, False, [])
    assert bodies.online() == [body("a")]


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


# --- use requests -----------------------------------------------------------

OK = {"output": [{"type": "text", "text": "ok"}]}


async def start_use(bodies: Bodies, peer: FakePeer, call_id="c1", timeout=30.0):
    """Run use() as a task and wait until its frame is on the peer."""
    task = asyncio.create_task(bodies.use("a", call_id, "see_screen", {}, timeout))
    while not peer.frames:
        await asyncio.sleep(0)
    return task, json.loads(peer.frames[-1])


def online(bodies: Bodies) -> FakePeer:
    peer = FakePeer()
    bodies.connect(body("a"), [], peer, None)
    return peer


async def test_use_sends_frame_and_returns_output():
    bodies = Bodies()
    peer = online(bodies)
    task, frame = await start_use(bodies, peer)
    assert frame["method"] == "use" and frame["jsonrpc"] == "2.0"
    assert frame["params"] == {"call": "c1", "tool": "see_screen", "input": {}}
    assert "seq" not in frame["params"]
    bodies.resolve("a", peer, {"id": frame["id"], "result": OK})
    assert await task == OK["output"]


async def test_use_to_offline_body_raises_body_offline():
    with pytest.raises(RpcError) as err:
        await Bodies().use("a", "c1", "t", {})
    assert err.value.code == ErrorCode.body_offline


async def test_error_response_raises_rpcerror_with_its_code():
    bodies = Bodies()
    peer = online(bodies)
    task, frame = await start_use(bodies, peer)
    bodies.resolve("a", peer, {"id": frame["id"], "error": {"code": -32007, "message": "boom"}})
    with pytest.raises(RpcError) as err:
        await task
    assert err.value.code == ErrorCode.tool_failed and err.value.message == "boom"


async def test_unknown_error_code_becomes_tool_failed():
    bodies = Bodies()
    peer = online(bodies)
    task, frame = await start_use(bodies, peer)
    bodies.resolve("a", peer, {"id": frame["id"], "error": {"code": 42, "message": "odd"}})
    with pytest.raises(RpcError) as err:
        await task
    assert err.value.code == ErrorCode.tool_failed and err.value.message == "odd"


async def test_disconnect_fails_pending_with_body_offline():
    bodies = Bodies()
    peer = online(bodies)
    task, _ = await start_use(bodies, peer)
    bodies.disconnect("a", peer)
    with pytest.raises(RpcError) as err:
        await task
    assert err.value.code == ErrorCode.body_offline
    assert bodies._pending == {}


async def test_replaced_connection_fails_old_pending():
    bodies = Bodies()
    old = online(bodies)
    task, _ = await start_use(bodies, old)
    bodies.connect(body("a"), [], FakePeer(), None)
    with pytest.raises(RpcError) as err:
        await task
    assert err.value.code == ErrorCode.body_offline


async def test_timeout_raises_timeout_and_sends_cancel():
    bodies = Bodies()
    peer = online(bodies)
    with pytest.raises(RpcError) as err:
        await bodies.use("a", "c1", "t", {}, timeout=0.01)
    assert err.value.code == ErrorCode.timeout
    assert json.loads(peer.frames[-1])["method"] == "cancel"
    assert json.loads(peer.frames[-1])["params"] == {"call": "c1"}
    assert bodies._pending == {}


async def test_task_cancel_sends_cancel_and_leaves_no_pending():
    bodies = Bodies()
    peer = online(bodies)
    task, _ = await start_use(bodies, peer)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert json.loads(peer.frames[-1])["params"] == {"call": "c1"}
    assert json.loads(peer.frames[-1])["method"] == "cancel"
    assert bodies._pending == {}


async def test_late_response_after_timeout_is_ignored():
    bodies = Bodies()
    peer = online(bodies)
    task = asyncio.create_task(bodies.use("a", "c1", "t", {}, timeout=0.01))
    while not peer.frames:
        await asyncio.sleep(0)
    frame = json.loads(peer.frames[0])
    with pytest.raises(RpcError):
        await task
    bodies.resolve("a", peer, {"id": frame["id"], "result": OK})  # must not raise


async def test_response_from_old_peer_is_ignored():
    bodies = Bodies()
    old = online(bodies)
    bodies.connect(body("a"), [], new := FakePeer(), None)
    task, frame = await start_use(bodies, new)
    bodies.resolve("a", old, {"id": frame["id"], "result": OK})
    assert not task.done()
    bodies.resolve("a", new, {"id": frame["id"], "result": OK})
    assert await task == OK["output"]


async def test_duplicate_response_ignored():
    bodies = Bodies()
    peer = online(bodies)
    task, frame = await start_use(bodies, peer)
    bodies.resolve("a", peer, {"id": frame["id"], "result": OK})
    bodies.resolve("a", peer, {"id": frame["id"], "error": {"code": -32007, "message": "x"}})
    assert await task == OK["output"]


async def test_ids_are_unique_per_request():
    bodies = Bodies()
    peer = online(bodies)
    t1, f1 = await start_use(bodies, peer, "c1")
    peer.frames.clear()
    t2, f2 = await start_use(bodies, peer, "c2")
    assert f1["id"] != f2["id"]
    for t in (t1, t2):
        t.cancel()
    await asyncio.gather(t1, t2, return_exceptions=True)


def test_is_online():
    bodies = Bodies()
    assert not bodies.is_online("a")
    peer = online(bodies)
    assert bodies.is_online("a")
    bodies.disconnect("a", peer)
    assert not bodies.is_online("a")


async def test_response_with_null_result_raises_tool_failed():
    bodies = Bodies()
    peer = online(bodies)
    task, frame = await start_use(bodies, peer)
    bodies.resolve("a", peer, {"id": frame["id"], "result": None})
    with pytest.raises(RpcError) as err:
        await task
    assert err.value.code == ErrorCode.tool_failed


def test_unhashable_response_id_is_ignored():
    bodies = Bodies()
    bodies.resolve("a", online(bodies), {"id": [1], "result": 1})


def test_notify_one_queues_for_offline_and_sends_to_online():
    bodies = Bodies()
    a, b = FakePeer(), FakePeer()
    bodies.connect(body("a"), [], a, None)
    bodies.connect(body("b"), [], b, None)
    bodies.disconnect("b", b)
    bodies.notify("say", {})  # seq 1 on both
    bodies.notify_one("a", "ask", {"id": "x"})
    bodies.notify_one("b", "ask", {"id": "y"})
    assert seqs(a.frames) == [1, 2]
    assert json.loads(a.frames[1])["method"] == "ask"
    assert b.frames == []
    assert bodies.connect(body("b"), [], FakePeer(), 1).backlog[0].count('"y"') == 1


def test_online_ids_lists_connected_bodies():
    bodies = Bodies()
    peer = FakePeer()
    bodies.connect(body("a"), [], peer, None)
    bodies.connect(body("b"), [], FakePeer(), None)
    bodies.disconnect("b", peer)  # wrong peer: b stays online
    assert bodies.online_ids() == ["a", "b"]


def test_known_tools_survive_disconnect():
    bodies = Bodies()
    peer = FakePeer()
    bodies.connect(body("desktop"), [tool("see_screen")], peer, None)
    bodies.set_tools("desktop", peer, [tool("see_screen"), tool("type_text")])
    bodies.disconnect("desktop", peer)
    assert not bodies.is_online("desktop")
    assert [t.name for t in bodies.known_tools()["desktop"]] == ["see_screen", "type_text"]


def test_known_tools_ignores_stale_peer_set_tools():
    bodies = Bodies()
    old, new = FakePeer(), FakePeer()
    bodies.connect(body("desktop"), [tool("a")], old, None)
    bodies.connect(body("desktop"), [tool("b")], new, None)
    bodies.set_tools("desktop", old, [tool("zzz")])
    assert [t.name for t in bodies.known_tools()["desktop"]] == ["b"]
