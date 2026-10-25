"""End-to-end checks of the websocket server: hello, tools, errors and replay.

Uses a real server on a free port and the websockets client, so framing, close
behaviour and write ordering are exercised for real.
"""

import asyncio
import json

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from brain.bodies import Bodies
from brain.server import start_server

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
    server = await start_server("127.0.0.1", 0, bodies, "s1")
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
        reply = await call(ws, request("say", {"text": "hi"}))
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
        bodies.notify("changed", {"what": "settings"})
        assert json.loads(await second.recv())["params"]["what"] == "settings"
