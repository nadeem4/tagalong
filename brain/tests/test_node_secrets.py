"""A secret typed on a node stays on that node: an app placed on it runs with the secret, yet the
secret is in no frame the brain sends or receives, no spec, and nothing the brain stores. Fake
node over real node pipes; the MCP servers are the real fake one, over stdio and over http.
"""

import subprocess
import sys

import pytest

from brain.apps import AppRow, Apps
from brain.bodies import Bodies
from brain.memory import Memory
from brain.placements import Placement, Placements
from brain.protocol import PipeSpec
from tests.fake_node import FAKE, FakeNode
from tests.test_apps import free_port, wait_for_port

SECRET = "sk-live-not-a-real-key-123"


@pytest.fixture
async def rig(tmp_path):
    memory = Memory(tmp_path / "t.db")
    bodies = Bodies()
    node = FakeNode(bodies, tmp_path)
    node.connect()
    placements = Placements(memory.db)
    placements.set("app", "fake", Placement("body", "pc"))
    apps = Apps(memory, lambda *_: None, {}, placements=placements, bodies=bodies)

    async def run(row: AppRow) -> Apps:
        memory.add_app(row)
        await apps.start()
        await apps.wait_settled("fake", 30)
        return apps

    yield run, node, memory
    await apps.shutdown()
    await node.aclose()
    memory.close()


def nothing_secret_left_the_node(node: FakeNode, memory: Memory) -> bool:
    kept = "".join(memory.db.iterdump())
    return SECRET not in "".join(node.frames) and SECRET not in kept


async def test_a_command_apps_secret_runs_the_tool_on_the_node_and_crosses_no_frame(rig):
    run, node, memory = rig
    spec = PipeSpec(command=sys.executable, args=[FAKE])
    node.allowlist.allow(spec, secret_env={"FAKE_API_KEY": SECRET})
    row = AppRow(
        "fake",
        "Fake",
        "stdio",
        {"command": sys.executable, "args": [FAKE], "secret_env": ["FAKE_API_KEY"]},
        "none",
        True,
    )
    apps = await run(row)
    result = await apps.call("fake", "key_is_set", {})
    assert result.content[0].text == "yes"
    assert nothing_secret_left_the_node(node, memory)


async def test_a_url_apps_secret_query_is_added_on_the_node_and_crosses_no_frame(rig):
    run, node, memory = rig
    port = free_port()
    server = subprocess.Popen([sys.executable, FAKE, "--http", str(port)])
    try:
        await wait_for_port(port)
        url = f"http://127.0.0.1:{port}/mcp"
        node.allowlist.allow(PipeSpec(url=url), url_query=f"api_key={SECRET}")
        row = AppRow("fake", "Fake", "http", {"url": url, "url_secret": True}, "none", True)
        apps = await run(row)
        result = await apps.call("fake", "echo", {"text": "hi"})
        assert result.content[0].text == "hi"
        assert node.opened == [PipeSpec(url=url)]
        assert nothing_secret_left_the_node(node, memory)
    finally:
        server.kill()
        server.wait()
