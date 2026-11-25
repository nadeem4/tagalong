"""A node that is refused, or lacks the tool, asks the desktop beside it for a yes. Only that
desktop's answer counts, a yes makes the brain try the pipe once more, and nothing here can add
to the node's list: the person's own CLI on that machine does that.
"""

import asyncio
import json
import sys

import pytest

from brain.auth import Principal
from brain.bodies import Bodies
from brain.node_needs import NodeNeeds
from brain.protocol import Body, ErrorCode, NodeAnsweredParams, PipeSpec, RpcError
from tests.fake_node import FakeNode


class Desk:
    def __init__(self, bodies: Bodies, body_id: str, device_id: str) -> None:
        self.frames: list[dict] = []
        self.id = body_id
        bodies.connect(
            Body(id=body_id, kind="desktop", name=body_id),
            [],
            self,
            None,
            Principal(f"device:{device_id}", body_id, "desktop", False, device_id),
        )

    def send(self, frame: str) -> None:
        self.frames.append(json.loads(frame))

    def close(self) -> None: ...

    def needs(self) -> list[dict]:
        return [f["params"] for f in self.frames if f.get("method") == "node_needs"]


@pytest.fixture
async def rig(tmp_path):
    bodies = Bodies()
    node = FakeNode(bodies, tmp_path, device_id="d1")
    node.connect()
    desk = Desk(bodies, "desk", "d1")
    elsewhere = Desk(bodies, "other-desk", "d2")
    yield bodies, node, desk, elsewhere, NodeNeeds(bodies)
    await node.aclose()


async def settle() -> None:
    for _ in range(20):
        await asyncio.sleep(0)


SPEC = PipeSpec(command=sys.executable, args=["--version"])


async def test_a_refused_pipe_asks_the_desktop_beside_the_node_and_no_other(rig):
    bodies, node, desk, elsewhere, needs = rig
    task = asyncio.create_task(needs.open_pipe("pc", SPEC, expert="claude-acp"))
    await settle()
    (frame,) = desk.needs()
    assert frame["state"] == "open" and frame["need"] == "approve"
    assert frame["node"] == "pc" and frame["expert"] == "claude-acp"
    assert PipeSpec.model_validate(frame["spec"]) == SPEC
    assert elsewhere.needs() == []
    task.cancel()


async def test_a_yes_makes_the_brain_try_the_pipe_once_more(rig):
    bodies, node, desk, _, needs = rig
    task = asyncio.create_task(needs.open_pipe("pc", SPEC))
    await settle()
    node.allowlist.allow(SPEC)  # what the person's click on the desktop does, on that machine
    await needs.answered("desk", NodeAnsweredParams(id=desk.needs()[0]["id"], outcome="done"))
    pipe = await asyncio.wait_for(task, 5)
    assert node.opened == [SPEC, SPEC]
    assert desk.needs()[-1]["state"] == "closed" and desk.needs()[-1]["reason"] == "answered"
    pipe.close()


async def test_not_now_fails_the_job_with_the_refusal_and_keeps_the_request_open(rig):
    bodies, node, desk, _, needs = rig
    task = asyncio.create_task(needs.open_pipe("pc", SPEC))
    await settle()
    await needs.answered("desk", NodeAnsweredParams(id=desk.needs()[0]["id"], outcome="not_now"))
    with pytest.raises(RpcError) as err:
        await task
    assert err.value.code == ErrorCode.denied
    assert [n["state"] for n in desk.needs()] == ["open"]
    assert node.opened == [SPEC]


async def test_another_body_cannot_answer_for_the_desktop(rig):
    bodies, node, desk, elsewhere, needs = rig
    task = asyncio.create_task(needs.open_pipe("pc", SPEC))
    await settle()
    with pytest.raises(RpcError):
        await needs.answered(
            "other-desk", NodeAnsweredParams(id=desk.needs()[0]["id"], outcome="done")
        )
    await settle()
    assert not task.done()
    task.cancel()


async def test_a_missing_tool_fails_the_job_with_the_line_to_run_there(rig):
    _, _, desk, _, needs = rig
    missing = PipeSpec(command="no-such-tool-xyz")
    with pytest.raises(RpcError, match="codex-acp is not installed on pc; run tagalong install"):
        await needs.open_pipe("pc", missing, expert="codex-acp")
    assert desk.needs() == []


async def test_the_node_ignores_frames_that_would_edit_its_list(tmp_path):
    from tests.test_node_session import Rig

    rig = Rig(tmp_path)
    rig.start()
    before = rig.allowlist._entries()
    for method in ("node_needs", "node_answered", "allow"):
        rig.ws.feed({"method": method, "params": {"id": "n1", "outcome": "done"}})
    rig.ws.feed({"id": "r1", "method": "node_answered", "params": {"id": "n1", "outcome": "done"}})
    await rig.settle()
    assert rig.allowlist._entries() == before
    assert rig.replies("r1")["error"]["code"] == ErrorCode.method_not_found
    await rig.finish()


def closed_reasons(desk: Desk) -> list[str]:
    return [f["reason"] for f in desk.needs() if f["state"] == "closed"]


async def test_a_node_that_goes_offline_closes_its_request(rig):
    bodies, node, desk, _, needs = rig
    task = asyncio.create_task(needs.open_pipe("pc", SPEC))
    await settle()
    needs.node_gone("pc")
    with pytest.raises(RpcError):
        await task
    assert closed_reasons(desk) == ["gone"]


async def test_an_unanswered_request_times_out_and_the_job_fails(rig):
    bodies, node, desk, _, _ = rig
    needs = NodeNeeds(bodies, wait_s=0.05)
    with pytest.raises(RpcError) as err:
        await needs.open_pipe("pc", SPEC)
    assert err.value.code == ErrorCode.denied
    assert closed_reasons(desk) == ["timeout"]


async def test_the_same_ask_again_replaces_the_older_one(rig):
    bodies, node, desk, _, needs = rig
    first = asyncio.create_task(needs.open_pipe("pc", SPEC))
    await settle()
    second = asyncio.create_task(needs.open_pipe("pc", SPEC))
    await settle()
    assert closed_reasons(desk) == ["replaced"]
    assert len(desk.needs()) == 3
    first.cancel()
    second.cancel()


async def test_a_pipe_asks_at_most_twice_then_the_refusal_stands(rig):
    bodies, node, desk, _, needs = rig
    task = asyncio.create_task(needs.open_pipe("pc", SPEC))
    for _ in range(2):
        await settle()
        opened = [f for f in desk.needs() if f["state"] == "open"]
        await needs.answered("desk", NodeAnsweredParams(id=opened[-1]["id"], outcome="done"))
    with pytest.raises(RpcError) as err:
        await asyncio.wait_for(task, 5)
    assert err.value.code == ErrorCode.denied
    assert len([f for f in desk.needs() if f["state"] == "open"]) == 2
    assert node.opened == [SPEC, SPEC, SPEC]
