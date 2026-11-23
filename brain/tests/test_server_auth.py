"""The listener checks the hello token first, serves wss when given a context, and never logs it."""

import asyncio
import json
import logging
import ssl

import pytest
from event_log import make_session
from test_server import Open, ScriptedModel
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, WebSocketException

from brain.auth import Authenticator
from brain.bodies import Bodies
from brain.devices import Devices
from brain.identity import load_or_create_identity, server_ssl_context
from brain.memory import Memory
from brain.memory_mcp import memory_client_tools
from brain.server import start_server


def frame(token, protocol=3, req_id=1):
    return json.dumps(
        {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "hello",
            "params": {
                "protocol": protocol,
                "token": token,
                "body": {"id": "desktop-a1b2c3", "kind": "desktop", "name": "PC"},
                "tools": [],
            },
        }
    )


@pytest.fixture
async def make_env():
    servers = []

    async def make(auth, ssl_context=None):
        bodies = Bodies()
        session = make_session(
            ScriptedModel(asyncio.Event()), Open(), bodies, 10, Memory(":memory:")
        )
        server = await start_server(
            "127.0.0.1", 0, bodies, "s1", session, auth=auth, ssl_context=ssl_context
        )
        servers.append(server)
        port = server.sockets[0].getsockname()[1]
        return bodies, port

    yield make
    for server in servers:
        server.close()
        await server.wait_closed()


async def test_good_local_token_joins(make_env):
    _, port = await make_env(Authenticator("good"))
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(frame("good"))
        assert "result" in json.loads(await ws.recv())


async def test_bad_token_gets_unauthorized_and_is_closed(make_env):
    _, port = await make_env(Authenticator("good"))
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(frame("bad"))
        assert json.loads(await ws.recv())["error"]["code"] == -32009
        with pytest.raises(ConnectionClosed):
            await ws.recv()


async def test_a_refused_hello_joins_no_body(make_env):
    bodies, port = await make_env(Authenticator("good"))
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(frame("bad"))
        await ws.recv()
    assert bodies.online() == []


async def test_token_never_reaches_the_log(make_env, caplog):
    caplog.set_level(logging.DEBUG)
    _, port = await make_env(Authenticator("sekrit-token"))
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(frame("sekrit-token-wrong"))
        await ws.recv()
    assert "sekrit-token" not in caplog.text


async def test_wss_listener_serves_hello_and_refuses_plain_ws(make_env, tmp_path):
    ident = load_or_create_identity(tmp_path)
    _, port = await make_env(Authenticator("good"), server_ssl_context(ident))
    client = ssl.create_default_context(cafile=str(ident.cert_path))
    client.check_hostname = False
    async with connect(f"wss://127.0.0.1:{port}", ssl=client) as ws:
        await ws.send(frame("good"))
        assert "result" in json.loads(await ws.recv())
    with pytest.raises((WebSocketException, OSError)):
        async with connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(frame("good"))
            await ws.recv()


@pytest.mark.parametrize("token", [None, "", 7])
async def test_a_hello_without_a_usable_token_is_unauthorized_and_echoes_nothing(make_env, token):
    _, port = await make_env(Authenticator("good"))
    message = json.loads(frame(token))
    if token is None:
        del message["params"]["token"]
    message["params"]["body"] = {"id": "UPPER-secret-input"}
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(json.dumps(message))
        reply = await ws.recv()
    assert json.loads(reply)["error"]["code"] == -32009
    assert "UPPER-secret-input" not in reply


def client_frame(token, kind="mcp_client", method="hello", params=None, req_id=1):
    if method == "hello":
        params = {
            "protocol": 3,
            "token": token,
            "body": {"id": "claude-code", "kind": kind, "name": "claude-code", "display": False},
            "tools": [],
        }
    return json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})


@pytest.fixture
def memory_env(tmp_path):
    memory = Memory(tmp_path / "t.db")
    devices = Devices(memory.db, lambda: "2026-11-22T00:00:00Z")
    yield memory, devices
    memory.close()


@pytest.fixture
async def make_memory_env(memory_env):
    servers = []
    memory, devices = memory_env

    async def make(auth):
        bodies = Bodies()
        session = make_session(
            ScriptedModel(asyncio.Event()),
            Open(),
            bodies,
            10,
            memory,
            extra_tools=memory_client_tools(memory, bodies.notify),
        )
        server = await start_server("127.0.0.1", 0, bodies, "s1", session, auth=auth)
        servers.append(server)
        return bodies, server.sockets[0].getsockname()[1]

    yield make
    for server in servers:
        server.close()
        await server.wait_closed()


def listeners(devices):
    return {
        "loopback": Authenticator("good", devices, loopback=True),
        "network": Authenticator(None, devices),
    }


@pytest.mark.parametrize("listener", ["loopback", "network"])
async def test_a_memory_client_token_opens_a_connection_that_can_recall(
    make_memory_env, memory_env, listener
):
    memory, devices = memory_env
    memory.remember("about_you", "Likes oat milk")
    _, token = devices.create("claude-code", "mcp_client")
    bodies, port = await make_memory_env(listeners(devices)[listener])
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(client_frame(token))
        assert "result" in json.loads(await ws.recv())
        await ws.send(
            client_frame(token, method="call", params={"tool": "recall", "input": {"query": "oat"}})
        )
        reply = json.loads(await ws.recv())
    assert "oat milk" in reply["result"]["output"][0]["text"]
    assert bodies.online() == []


async def test_a_memory_client_gets_unknown_tool_for_anything_but_memory(
    make_memory_env, memory_env
):
    _, devices = memory_env
    _, token = devices.create("claude-code", "mcp_client")
    _, port = await make_memory_env(listeners(devices)["network"])
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(client_frame(token))
        await ws.recv()
        await ws.send(
            client_frame(token, method="call", params={"tool": "get_settings", "input": {}})
        )
        assert json.loads(await ws.recv())["error"]["code"] == -32001
        await ws.send(
            client_frame(token, method="say", params={"id": "e1", "text": "hi"}, req_id=2)
        )
        assert json.loads(await ws.recv())["error"]["code"] == -32601


async def test_a_revoked_memory_client_is_refused_on_its_next_call(make_memory_env, memory_env):
    _, devices = memory_env
    device_id, token = devices.create("claude-code", "mcp_client")
    _, port = await make_memory_env(listeners(devices)["network"])
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(client_frame(token))
        await ws.recv()
        devices.revoke(device_id)
        await ws.send(
            client_frame(token, method="call", params={"tool": "list_memories", "input": {}})
        )
        assert json.loads(await ws.recv())["error"]["code"] == -32009


@pytest.mark.parametrize(
    ("device_kind", "hello_kind"), [("desktop", "mcp_client"), ("mcp_client", "desktop")]
)
async def test_a_body_token_is_no_memory_client_and_the_reverse(
    make_memory_env, memory_env, device_kind, hello_kind
):
    _, devices = memory_env
    _, token = devices.create("x", device_kind)
    bodies, port = await make_memory_env(listeners(devices)["network"])
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(client_frame(token, kind=hello_kind))
        assert json.loads(await ws.recv())["error"]["code"] == -32009
    assert bodies.online() == []


async def test_an_unexpected_failure_gives_a_memory_client_no_exception_text(
    make_memory_env, memory_env, monkeypatch
):
    async def boom(*args, **kwargs):
        raise RuntimeError("secret detail")

    monkeypatch.setattr("brain.server.call_memory_tool", boom)
    _, devices = memory_env
    _, token = devices.create("claude-code", "mcp_client")
    _, port = await make_memory_env(listeners(devices)["network"])
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(client_frame(token))
        await ws.recv()
        await ws.send(
            client_frame(token, method="call", params={"tool": "recall", "input": {"query": "x"}})
        )
        reply = json.loads(await ws.recv())
    assert reply["error"]["message"] == "Internal error"
