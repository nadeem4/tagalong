"""End-to-end checks of the websocket server: hello, tools, errors and replay.

Uses a real server on a free port and the websockets client, so framing, close
behaviour and write ordering are exercised for real.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from brain.bodies import Bodies
from brain.mind.turn import Final
from brain.server import start_server
from brain.sessions import Session

DESKTOP = {"id": "desktop", "kind": "desktop", "name": "Desktop"}
TOOL = {
    "name": "see_screen",
    "description": "Capture the screen",
    "input_schema": {"type": "object", "properties": {}},
}


def hello(last_seq=None, protocol=1, req_id=1):
    params = {"protocol": protocol, "body": DESKTOP, "tools": [TOOL]}
    if last_seq is not None:
        params["last_seq"] = last_seq
    return {"jsonrpc": "2.0", "id": req_id, "method": "hello", "params": params}


def request(method, params, req_id=2):
    return {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}


@pytest.fixture
async def env():
    bodies = Bodies()
    server = await start_server("127.0.0.1", 0, bodies, "s1", None)
    url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    yield bodies, url
    server.close()
    await server.wait_closed()


async def call(ws, frame):
    await ws.send(json.dumps(frame) if not isinstance(frame, (str, bytes)) else frame)
    return json.loads(await ws.recv())


async def assert_closed(ws):
    with pytest.raises(ConnectionClosed):
        await ws.recv()


async def test_hello_ok(env):
    bodies, url = env
    async with connect(url) as ws:
        reply = await call(ws, hello())
        assert reply == {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"protocol": 1, "session": "s1", "tools": [], "seq": 0, "resync": False},
        }
        assert [b.id for b in bodies.online()] == ["desktop"]


async def test_message_before_hello_closes(env):
    _, url = env
    async with connect(url) as ws:
        reply = await call(ws, request("say", {"text": "hi"}))
        assert reply["error"]["code"] == -32600
        await assert_closed(ws)


async def test_version_mismatch_closes(env):
    _, url = env
    async with connect(url) as ws:
        reply = await call(ws, hello(protocol=2))
        assert reply["error"]["code"] == -32000
        assert reply["error"]["data"] == {"protocol": 1}
        await assert_closed(ws)


async def test_version_checked_before_shape(env):
    _, url = env
    frame = hello(protocol=2)
    frame["params"]["body"] = {"id": "desktop", "kind": "desktop"}  # no name
    async with connect(url) as ws:
        reply = await call(ws, frame)
        assert reply["error"]["code"] == -32000
        assert reply["error"]["data"] == {"protocol": 1}
        await assert_closed(ws)


async def test_garbage_before_hello_closes(env):
    _, url = env
    async with connect(url) as ws:
        reply = await call(ws, "{not json")
        assert reply["error"]["code"] == -32700
        assert reply["id"] is None
        await assert_closed(ws)


async def test_null_optional_is_invalid_params(env):
    _, url = env
    frame = hello()
    frame["params"]["last_seq"] = None
    async with connect(url) as ws:
        reply = await call(ws, frame)
        assert reply["error"]["code"] == -32602
        await assert_closed(ws)


async def test_second_hello_is_invalid_request(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, hello(req_id=5))
        assert reply["error"]["code"] == -32600
        assert reply["id"] == 5
        assert (await call(ws, request("tools", {"tools": []})))["result"] == {}


async def test_tools_replaces_list(env):
    bodies, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, request("tools", {"tools": [TOOL]}))
        assert reply == {"jsonrpc": "2.0", "id": 2, "result": {}}
        assert [t.name for t in bodies.tools("desktop")] == ["see_screen"]


async def test_unbuilt_request_is_method_not_found(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, request("ask", {"text": "hi"}))
        assert reply["error"]["code"] == -32601
        await ws.send(json.dumps({"jsonrpc": "2.0", "method": "event", "params": {"name": "x"}}))
        reply = await call(ws, request("nope", {}, req_id=3))
        assert reply["id"] == 3
        assert reply["error"]["code"] == -32601


async def test_garbage_after_hello_keeps_connection(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, "{not json")
        assert reply["error"]["code"] == -32700
        assert reply["id"] is None
        assert (await call(ws, "[1,2]"))["error"]["code"] == -32600
        assert (await call(ws, b"\x00\x01"))["error"]["code"] == -32700
        assert (await call(ws, request("tools", {"tools": []})))["result"] == {}


async def test_reconnect_replays_after_result(env):
    bodies, url = env
    async with connect(url) as ws:
        await call(ws, hello())
    for _ in range(100):  # the server notices the close a moment later
        if not bodies.online():
            break
        await asyncio.sleep(0.01)
    assert not bodies.online()
    bodies.notify("changed", {"what": "settings"})
    bodies.notify("changed", {"what": "settings"})
    async with connect(url) as ws:
        reply = await call(ws, hello(last_seq=0))
        assert reply["result"]["seq"] == 2
        assert reply["result"]["resync"] is False
        first = json.loads(await ws.recv())
        second = json.loads(await ws.recv())
        assert [first["params"]["seq"], second["params"]["seq"]] == [1, 2]


async def test_resync_when_ahead(env):
    _, url = env
    async with connect(url) as ws:
        reply = await call(ws, hello(last_seq=9))
        assert reply["result"]["resync"] is True
        assert reply["result"]["seq"] == 0


async def test_second_connection_same_id_closes_first(env):
    bodies, url = env
    async with connect(url) as first, connect(url) as second:
        await call(first, hello())
        await call(second, hello())
        await assert_closed(first)
        # first is closed, so it can't send tools; the stale guard is tested in test_bodies.
        bodies.notify("changed", {"what": "settings"})
        assert json.loads(await second.recv())["params"]["what"] == "settings"


async def test_response_before_hello_closes(env):
    _, url = env
    async with connect(url) as ws:
        reply = await call(ws, {"jsonrpc": "2.0", "id": 1, "result": {}})
        assert reply["error"]["code"] == -32600
        await assert_closed(ws)


# --- say and cancel ---------------------------------------------------------


class ScriptedModel:
    model_id = "claude-sonnet-5-5"

    def __init__(self, gate):
        self.gate = gate

    async def stream(self, system, messages, tools):
        await self.gate.wait()
        yield "hel"
        yield "lo"
        yield Final([{"type": "text", "text": "hello"}], "end_turn", SimpleNamespace())


class Open:
    def allows(self):
        return True

    def spend(self, usage, model):
        pass


@pytest.fixture
async def chat():
    gate = asyncio.Event()
    bodies = Bodies()
    session = Session(ScriptedModel(gate), Open(), bodies, 10)
    server = await start_server("127.0.0.1", 0, bodies, "s1", session)
    url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    yield url, gate
    server.close()
    await server.wait_closed()


async def test_say_reaches_every_body(chat):
    url, gate = chat
    ext = hello(req_id=1)
    ext["params"]["body"] = {"id": "ext", "kind": "extension", "name": "Chrome"}
    async with connect(url) as a, connect(url) as b:
        await call(a, hello())
        await call(b, ext)
        reply = await call(a, request("say", {"text": "hi"}))
        assert reply["result"]["joined"] is False
        turn = reply["result"]["turn"]
        gate.set()
        for ws in (a, b):
            got = [json.loads(await ws.recv())["params"] for _ in range(5)]
            assert got[0]["state"] == "started"
            assert [g.get("delta") for g in got[1:3]] == ["hel", "lo"]
            assert got[3]["done"] is True
            assert got[4] == {
                "seq": 5,
                "turn": turn,
                "body": "desktop",
                "state": "ended",
                "reason": "done",
            }


async def test_say_during_turn_joins(chat):
    url, gate = chat
    async with connect(url) as ws:
        await call(ws, hello())
        first = await call(ws, request("say", {"text": "a"}, req_id=2))
        started = json.loads(await ws.recv())
        assert started["params"]["state"] == "started"
        second = await call(ws, request("say", {"text": "b"}, req_id=3))
        assert second["result"] == {"turn": first["result"]["turn"], "joined": True}
        gate.set()


async def test_cancel_notification_ends_turn(chat):
    url, _ = chat
    async with connect(url) as ws:
        await call(ws, hello())
        first = await call(ws, request("say", {"text": "a"}, req_id=2))
        await ws.recv()  # started
        cancel = {"jsonrpc": "2.0", "method": "cancel", "params": {"turn": first["result"]["turn"]}}
        await ws.send(json.dumps(cancel))
        ended = json.loads(await ws.recv())
        assert ended["params"]["state"] == "ended"
        assert ended["params"]["reason"] == "cancelled"


async def test_cancel_request_answers_empty(chat):
    url, _ = chat
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, request("cancel", {"turn": "nope"}))
        assert reply["result"] == {}


async def test_bad_say_params(chat):
    url, _ = chat
    async with connect(url) as ws:
        await call(ws, hello())
        for req_id, params in enumerate([{}, {"text": 5}, {"parts": []}], start=3):
            reply = await call(ws, request("say", params, req_id=req_id))
            assert reply["error"]["code"] == -32602
