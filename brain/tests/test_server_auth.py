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
from brain.identity import load_or_create_identity, server_ssl_context
from brain.memory import Memory
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
