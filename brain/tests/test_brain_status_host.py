"""brain_status names the machine and says whether the asking body is on it."""

import asyncio
import json
import socket

import pytest
from event_log import make_session
from test_server import Open, ScriptedModel, request
from test_server_auth import frame
from websockets.asyncio.client import connect

from brain.auth import Authenticator, Principal
from brain.bodies import CALLER, Bodies
from brain.memory import Memory
from brain.server import start_server
from brain.tools import brain_status_tools

TOKEN = "device-secret"


class OneDevice:
    def verify(self, token):
        if token != TOKEN:
            return None
        return Principal(key="device:1", name="Laptop", kind="desktop", local=False, device_id="1")


async def status_from(loopback: bool) -> dict:
    bodies = Bodies()
    session = make_session(
        ScriptedModel(asyncio.Event()),
        Open(),
        bodies,
        10,
        Memory(":memory:"),
        extra_tools=brain_status_tools(lambda: {}, lambda: bodies.is_local(CALLER.get())),
    )
    server = await start_server(
        "127.0.0.1",
        0,
        bodies,
        "s1",
        session,
        auth=Authenticator(None, OneDevice(), loopback=loopback),
    )
    try:
        async with connect(f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}") as ws:
            await ws.send(frame(TOKEN))
            await ws.recv()
            await ws.send(json.dumps(request("call", {"tool": "brain_status", "input": {}}, 9)))
            while (reply := json.loads(await ws.recv())).get("id") != 9:
                pass
        return json.loads(reply["result"]["output"][0]["text"])
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.parametrize("loopback", [True, False])
async def test_the_asking_body_is_local_only_on_the_loopback_listener(loopback):
    status = await status_from(loopback)
    assert status["local"] is loopback
    assert status["host"] == socket.gethostname()
