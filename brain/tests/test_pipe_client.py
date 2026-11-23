"""The brain's pipe client against a fake node that really runs the allowed command: a refused spec
comes back as denied, a node that drops ends the pipe, and a slow open is closed on the node.
"""

import asyncio
import sys

import pytest

from brain.bodies import Bodies
from brain.protocol import ErrorCode, PipeSpec, RpcError
from tests.fake_node import FAKE, FakeNode


@pytest.fixture
async def rig(tmp_path):
    bodies = Bodies()
    node = FakeNode(bodies, tmp_path)
    node.connect()
    yield bodies, node
    await node.aclose()


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


async def test_an_open_that_times_out_is_closed_on_the_node(rig):
    bodies, node = rig
    node.hold_open = True
    with pytest.raises(RpcError) as err:
        await bodies.open_pipe("pc", PipeSpec(command=sys.executable, args=[FAKE]), timeout=0.05)
    assert err.value.code == ErrorCode.timeout
    await asyncio.sleep(0.05)
    assert node.closed_pipes == node.opened_ids
