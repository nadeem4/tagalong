"""The brain's pipe client against a fake node that really runs the allowed command: an MCP
session works over the pipe, a refused spec comes back as denied, and a node that drops ends it.
"""

import sys

import pytest
from mcp import ClientSession

from brain.bodies import Bodies
from brain.pipes import mcp_streams
from brain.protocol import ErrorCode, PipeSpec, RpcError
from tests.fake_node import FAKE, FakeNode


@pytest.fixture
def rig(tmp_path):
    bodies = Bodies()
    node = FakeNode(bodies, tmp_path)
    node.connect()
    return bodies, node


async def test_an_mcp_session_runs_over_a_node_pipe(rig):
    bodies, _ = rig
    pipe = await bodies.open_pipe("pc", PipeSpec(command=sys.executable, args=[FAKE]))
    async with mcp_streams(pipe) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        names = {tool.name for tool in (await session.list_tools()).tools}
        assert "echo" in names
        result = await session.call_tool("echo", {"text": "hi"})
        assert result.content[0].text == "hi"


async def test_a_command_the_node_does_not_list_is_denied(rig):
    bodies, _ = rig
    with pytest.raises(RpcError) as err:
        await bodies.open_pipe("pc", PipeSpec(command=sys.executable, args=["other.py"]))
    assert err.value.code == ErrorCode.denied


async def test_a_node_that_drops_ends_the_pipe(rig):
    bodies, node = rig
    pipe = await bodies.open_pipe("pc", PipeSpec(command=sys.executable, args=[FAKE]))
    bodies.disconnect("pc", node)
    assert await pipe.read() is None


async def test_another_body_cannot_speak_for_a_pipe(rig, tmp_path):
    bodies, _ = rig
    other = FakeNode(bodies, tmp_path, body_id="evil")
    other.connect()
    pipe = await bodies.open_pipe("pc", PipeSpec(command=sys.executable, args=[FAKE]))
    pipe_id = next(iter(bodies._pipes))
    bodies.pipe_event("evil", other, "pipe_close", {"pipe": pipe_id})
    assert not pipe.ended
    pipe.close()
