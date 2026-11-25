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
from brain.protocol import Body, ErrorCode, PipeSpec, RpcError
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
    needs.answered("desk", {"id": desk.needs()[0]["id"], "outcome": "done"})
    pipe = await asyncio.wait_for(task, 5)
    assert node.opened == [SPEC, SPEC]
    assert desk.needs()[-1]["state"] == "closed" and desk.needs()[-1]["reason"] == "answered"
    pipe.close()


async def test_not_now_fails_the_job_with_the_refusal_and_keeps_the_request_open(rig):
    bodies, node, desk, _, needs = rig
    task = asyncio.create_task(needs.open_pipe("pc", SPEC))
    await settle()
    needs.answered("desk", {"id": desk.needs()[0]["id"], "outcome": "not_now"})
    with pytest.raises(RpcError) as err:
        await task
    assert err.value.code == ErrorCode.denied
    assert [n["state"] for n in desk.needs()] == ["open"]
    assert node.opened == [SPEC]


async def test_another_body_cannot_answer_for_the_desktop(rig):
    bodies, node, desk, elsewhere, needs = rig
    task = asyncio.create_task(needs.open_pipe("pc", SPEC))
    await settle()
    needs.answered("other-desk", {"id": desk.needs()[0]["id"], "outcome": "done"})
    await settle()
    assert not task.done()
    task.cancel()


async def test_a_missing_tool_asks_for_an_install_and_a_node_with_no_desktop_just_fails(
    rig, tmp_path
):
    bodies, node, desk, _, needs = rig
    missing = PipeSpec(command="no-such-tool-xyz")
    task = asyncio.create_task(needs.open_pipe("pc", missing, expert="codex-acp"))
    await settle()
    assert desk.needs()[0]["need"] == "install"
    task.cancel()

    lonely = FakeNode(bodies, tmp_path / "solo", body_id="solo")
    lonely.connect()
    with pytest.raises(RpcError):
        await needs.open_pipe("solo", missing)
    await lonely.aclose()


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
