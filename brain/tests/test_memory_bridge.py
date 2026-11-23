"""`tagalong memory-mcp`: the stdio MCP server another AI tool starts, bridging to the brain over
its websocket. Driven by a real MCP client over in-memory streams against a real listener (ws
on loopback, wss pinned to a fingerprint), with fake model and fake asks; no real API.
"""

import asyncio
import contextlib
import json

import pytest
from event_log import make_session
from mcp import ClientSession
from mcp.shared.memory import create_client_server_memory_streams
from test_server import Open, ScriptedModel

from brain.auth import Authenticator
from brain.bodies import Bodies
from brain.devices import Devices
from brain.identity import load_or_create_identity, server_ssl_context
from brain.memory import Memory
from brain.memory_bridge import BridgeLink, build_server, load_link, pair_with_link
from brain.memory_mcp import memory_client_tools
from brain.pairing import NETWORK_KINDS, Pairing
from brain.server import start_server
from brain.store import rules
from brain.store.db import utc_now_text

NOW = "2026-11-22T00:00:00Z"


@contextlib.asynccontextmanager
async def mcp(server):
    async with create_client_server_memory_streams() as (client, served):
        task = asyncio.create_task(server.run(*served, server.create_initialization_options()))
        try:
            async with ClientSession(*client) as session:
                await session.initialize()
                yield session
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.fixture
def memory(tmp_path):
    memory = Memory(tmp_path / "t.db")
    rules.set_permission_mode(memory.db, "memory_remember", "auto")
    yield memory
    memory.close()


@pytest.fixture
async def brain(memory, tmp_path):
    """A listener on loopback (ws) and one with a certificate (wss), as the brain runs both."""
    devices = Devices(memory.db, lambda: NOW)
    bodies = Bodies()
    session = make_session(
        ScriptedModel(asyncio.Event()),
        Open(),
        bodies,
        10,
        memory,
        extra_tools=memory_client_tools(memory, bodies.notify),
    )
    identity = load_or_create_identity(tmp_path)
    pairing = Pairing(memory.db, devices, identity, utc_now_text, lambda: "127.0.0.1:0")
    plain = await start_server(
        "127.0.0.1", 0, bodies, "s1", session, auth=Authenticator("good", devices, loopback=True)
    )
    secure = await start_server(
        "127.0.0.1",
        0,
        bodies,
        "s1",
        session,
        auth=Authenticator(None, devices),
        ssl_context=server_ssl_context(identity),
        redeem=lambda code, name, kind: pairing.redeem(code, name, kind, kinds=NETWORK_KINDS),
    )

    class Brain:
        pass

    b = Brain()
    b.devices, b.pairing, b.identity = devices, pairing, identity
    b.plain = f"127.0.0.1:{plain.sockets[0].getsockname()[1]}"
    b.secure = f"127.0.0.1:{secure.sockets[0].getsockname()[1]}"
    yield b
    for server in (plain, secure):
        server.close()
        await server.wait_closed()


async def test_the_bridge_lists_the_three_memory_tools_even_with_the_brain_down():
    server = build_server(BridgeLink("127.0.0.1:1", None, "t"))
    async with mcp(server) as s:
        names = sorted(t.name for t in (await s.list_tools()).tools)
    assert names == ["list_memories", "recall", "remember"]


async def test_a_brain_that_is_down_is_a_tool_error_not_a_crash():
    server = build_server(BridgeLink("127.0.0.1:1", None, "t"))
    async with mcp(server) as s:
        out = await s.call_tool("recall", {"query": "x"})
    assert out.is_error and "not reachable" in out.content[0].text


async def test_remember_saves_a_memory_labelled_with_the_client_and_recall_finds_it(brain, memory):
    _, token = brain.devices.create("claude-code", "mcp_client")
    server = build_server(BridgeLink(brain.plain, None, token))
    async with mcp(server) as s:
        saved = await s.call_tool("remember", {"text": "Prefers tabs"})
        found = await s.call_tool("recall", {"query": "tabs"})
    assert not saved.is_error and "Prefers tabs" in found.content[0].text
    assert [r[0] for r in memory.db.execute("SELECT source FROM memories")] == ["mcp:claude-code"]


async def test_a_revoked_client_is_told_so_on_its_next_call(brain):
    device_id, token = brain.devices.create("claude-code", "mcp_client")
    server = build_server(BridgeLink(brain.plain, None, token))
    async with mcp(server) as s:
        assert not (await s.call_tool("list_memories", {})).is_error
        brain.devices.revoke(device_id)
        out = await s.call_tool("list_memories", {})
    assert out.is_error and "refused" in out.content[0].text


async def test_pairing_with_a_link_makes_a_file_the_bridge_uses_over_a_pinned_wss(
    brain, memory, tmp_path
):
    memory.remember("about_you", "Likes oat milk")
    offer = brain.pairing.make_code("mcp_client")
    link = offer.link.replace("127.0.0.1:0", brain.secure)
    await pair_with_link(tmp_path, "cursor", link)
    saved = json.loads((tmp_path / "memory-clients" / "cursor.json").read_text())
    assert saved["fingerprint"] == brain.identity.fingerprint
    async with mcp(build_server(load_link(tmp_path, "cursor"))) as s:
        out = await s.call_tool("recall", {"query": "oat"})
    assert "oat milk" in out.content[0].text


async def test_a_pinned_link_refuses_a_brain_with_another_certificate(brain, tmp_path):
    _, token = brain.devices.create("cursor", "mcp_client")
    server = build_server(BridgeLink(brain.secure, "0" * 64, token))
    async with mcp(server) as s:
        out = await s.call_tool("recall", {"query": "x"})
    assert out.is_error and "certificate" in out.content[0].text
