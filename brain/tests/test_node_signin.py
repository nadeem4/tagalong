"""Signing in to an app on the node that runs it: the browser opens on that machine, the token is
kept under the node's folder, the relay uses it, and no token is in any frame to the brain.
Fake node over real pipes; the OAuth-protected MCP server is the fake one, on localhost.
"""

import asyncio
import subprocess
import sys
import urllib.request

import pytest

from brain.apps import AppRow, Apps
from brain.bodies import Bodies
from brain.memory import Memory
from brain.node.signin import sign_in
from brain.placements import Placement, Placements
from brain.protocol import PipeSpec
from tests.fake_node import FakeNode
from tests.test_app_oauth import FAKE_OAUTH
from tests.test_apps import free_port, wait_for_port

TOKENS = ("good-token", "r1")


@pytest.fixture
async def oauth_url():
    port = free_port()
    proc = subprocess.Popen([sys.executable, FAKE_OAUTH, str(port)])
    try:
        await wait_for_port(port)
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        proc.kill()
        proc.wait()


@pytest.fixture
async def rig(tmp_path):
    memory = Memory(tmp_path / "t.db")
    bodies = Bodies()
    (tmp_path / "node").mkdir()
    node = FakeNode(bodies, tmp_path / "node")
    node.connect()
    placements = Placements(memory.db)
    placements.set("app", "notes", Placement("body", "pc"))
    apps = Apps(memory, lambda *_: None, {}, placements=placements, bodies=bodies)
    yield apps, node, memory, tmp_path / "node"
    await apps.shutdown()
    await node.aclose()
    memory.close()


async def browser(url: str) -> None:
    await asyncio.to_thread(lambda: urllib.request.urlopen(url, timeout=10).read())


def leaked(node: FakeNode, memory: Memory) -> bool:
    frames = "".join(node.frames) + "".join(memory.db.iterdump())
    return any(token in frames for token in TOKENS)


async def run_app(apps, memory, row):
    memory.add_app(row)
    await apps.start()
    await apps.wait_settled("notes", 30)


async def test_an_oauth_app_signed_in_on_the_node_runs_there_and_no_token_crosses_a_frame(
    rig, oauth_url
):
    apps, node, memory, node_dir = rig
    node.allowlist.allow(PipeSpec(url=oauth_url))
    await sign_in(oauth_url, node_dir, browser, timeout=15)
    assert list((node_dir / "app-oauth").glob("*.json"))
    row = AppRow("notes", "Notes", "http", {"url": oauth_url}, "oauth", True)
    await run_app(apps, memory, row)
    result = await apps.call("notes", "echo", {"text": "hi"})
    assert result.content[0].text == "hi"
    assert not leaked(node, memory)


async def test_a_bearer_token_typed_on_the_node_is_used_there_and_crosses_no_frame(rig, oauth_url):
    apps, node, memory, _ = rig
    node.allowlist.allow(PipeSpec(url=oauth_url), bearer="good-token")
    row = AppRow("notes", "Notes", "http", {"url": oauth_url}, "token", True)
    await run_app(apps, memory, row)
    result = await apps.call("notes", "echo", {"text": "hi"})
    assert result.content[0].text == "hi"
    assert not leaked(node, memory)
