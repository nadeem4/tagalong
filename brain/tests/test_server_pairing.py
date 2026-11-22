"""pair before hello, a device's token at hello, the body id bound to its device, instant revoke."""

import asyncio
import json

import pytest
from event_log import make_session
from test_server import Open, ScriptedModel
from test_server_auth import frame
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from brain.auth import Authenticator
from brain.bodies import Bodies
from brain.devices import Devices
from brain.identity import load_or_create_identity
from brain.memory import Memory
from brain.pairing import Pairing
from brain.server import start_server
from brain.store.db import open_db

NOW = "2026-11-21T00:00:00Z"


def pair_frame(code, name="Laptop", kind="desktop"):
    return json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 7,
            "method": "pair",
            "params": {"code": code, "device": {"name": name, "kind": kind}},
        }
    )


class Env:
    pass


@pytest.fixture
async def make_env(tmp_path):
    servers = []

    async def make(offer_pairing=True, loopback=False):
        env = Env()
        env.bodies = Bodies()
        db = open_db(tmp_path / "d.db")
        env.devices = Devices(
            db, lambda: NOW, on_revoke=lambda i: env.bodies.drop_principal(f"device:{i}")
        )
        env.pairing = Pairing(
            db, env.devices, load_or_create_identity(tmp_path), lambda: NOW, lambda: "h:1"
        )
        session = make_session(
            ScriptedModel(asyncio.Event()), Open(), env.bodies, 10, Memory(":memory:")
        )
        server = await start_server(
            "127.0.0.1",
            0,
            env.bodies,
            "s1",
            session,
            auth=Authenticator(None, env.devices),
            pairing=env.pairing if offer_pairing else None,
            loopback=loopback,
        )
        servers.append(server)
        env.url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
        return env

    yield make
    for server in servers:
        server.close()
        await server.wait_closed()


async def exchange(url, text):
    async with connect(url) as ws:
        await ws.send(text)
        return json.loads(await ws.recv())


async def test_a_paired_device_joins_with_the_token_pair_returned(make_env):
    env = await make_env()
    code = env.pairing.make_code().secret
    result = (await exchange(env.url, pair_frame(code)))["result"]
    assert "result" in await exchange(env.url, frame(result["token"]))


async def test_a_wrong_code_is_unauthorized_and_closes_the_connection(make_env):
    env = await make_env()
    async with connect(env.url) as ws:
        await ws.send(pair_frame("nope"))
        assert json.loads(await ws.recv())["error"]["code"] == -32009
        with pytest.raises(ConnectionClosed):
            await ws.recv()


async def test_pair_is_unknown_on_a_listener_that_does_not_offer_it(make_env):
    env = await make_env(offer_pairing=False)
    assert (await exchange(env.url, pair_frame("x")))["error"]["code"] == -32601


async def test_a_bad_pair_shape_does_not_echo_the_code(make_env):
    env = await make_env()
    bad = json.loads(pair_frame("secret-code-text", kind="whatsapp"))
    reply = await exchange(env.url, json.dumps(bad))
    assert reply["error"]["code"] == -32602
    assert "secret-code-text" not in json.dumps(reply)


async def test_a_device_cannot_take_another_devices_body_id(make_env):
    env = await make_env()
    _, first = env.devices.create("A", "desktop")
    _, second = env.devices.create("B", "desktop")
    async with connect(env.url) as a:
        await a.send(frame(first))
        assert "result" in json.loads(await a.recv())
        assert (await exchange(env.url, frame(second)))["error"]["code"] == -32009
        assert [b.id for b in env.bodies.online()] == ["desktop-a1b2c3"]


async def test_revoke_closes_the_live_connection_and_the_next_hello_is_refused(make_env):
    env = await make_env()
    device_id, token = env.devices.create("A", "desktop")
    async with connect(env.url) as ws:
        await ws.send(frame(token))
        await ws.recv()
        env.devices.revoke(device_id)
        with pytest.raises(ConnectionClosed):
            async with asyncio.timeout(1):
                await ws.recv()
    assert (await exchange(env.url, frame(token)))["error"]["code"] == -32009


async def test_the_loopback_listener_pairs_only_the_browser_add_on(make_env):
    env = await make_env(loopback=True)
    desktop = env.pairing.make_code().secret
    assert (await exchange(env.url, pair_frame(desktop)))["error"]["code"] == -32009
    short = env.pairing.make_code("browser").secret
    reply = await exchange(env.url, pair_frame(short, "Chrome", "browser"))
    assert "token" in reply["result"]
