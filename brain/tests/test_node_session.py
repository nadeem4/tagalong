"""The node's side of the contract on a fake socket: hello first, then the brain's requests
answered by the allow-list and the pipes. The fake child and socket never touch the network.
"""

import asyncio
import base64
import json
from pathlib import Path

import pytest

from brain.node.allowlist import Allowlist
from brain.node.main import HelloRefused, NodeSession
from brain.protocol import ErrorCode, PipeSpec
from tests.test_node_pipes import FakeChild, LingeringChild


class FakeSocket:
    """Frames queued by the test come out of iteration; frames the node sends are kept."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self._incoming: asyncio.Queue[str | None] = asyncio.Queue()

    async def send(self, frame: str) -> None:
        self.sent.append(json.loads(frame))

    def feed(self, message: dict) -> None:
        self._incoming.put_nowait(json.dumps({"jsonrpc": "2.0", **message}))

    def hang_up(self) -> None:
        self._incoming.put_nowait(None)

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        frame = await self._incoming.get()
        if frame is None:
            raise StopAsyncIteration
        return frame


class Rig:
    def __init__(self, tmp_path: Path, child_type: type[FakeChild] = FakeChild) -> None:
        self.exe = tmp_path / "expert.exe"
        self.exe.write_bytes(b"binary")
        self.exe.chmod(0o755)
        self.allowlist = Allowlist(tmp_path / "allowlist.json")
        self.ws = FakeSocket()
        self.children: list[FakeChild] = []

        async def spawn(path: str, args: list[str], env: dict[str, str]) -> FakeChild:
            child = child_type()
            self.children.append(child)
            return child

        self.session = NodeSession(self.allowlist, spawn)
        self.task: asyncio.Task | None = None

    def start(self) -> None:
        self.task = asyncio.create_task(self.session.run(self.ws, "tok", "node-1", "Laptop"))

    async def settle(self) -> None:
        for _ in range(10):
            await asyncio.sleep(0)

    async def finish(self) -> None:
        self.ws.hang_up()
        assert self.task is not None
        await self.task

    def replies(self, req_id: str) -> dict:
        return next(m for m in self.ws.sent if m.get("id") == req_id)


@pytest.fixture
async def rig(tmp_path):
    rig = Rig(tmp_path)
    rig.start()
    await rig.settle()
    yield rig
    if not rig.task.done():
        await rig.finish()


async def test_the_first_frame_is_a_hello_as_a_node_body_with_the_token(rig):
    hello = rig.ws.sent[0]
    assert hello["method"] == "hello"
    assert hello["params"]["token"] == "tok"
    assert hello["params"]["body"] == {
        "id": "node-1",
        "kind": "node",
        "name": "Laptop",
        "display": False,
    }
    assert hello["params"]["tools"] == []


async def test_an_allowed_pipe_open_is_answered_and_its_output_relayed(rig):
    spec = PipeSpec(command=str(rig.exe), args=["--stdio"])
    rig.allowlist.allow(spec)
    rig.ws.feed(
        {
            "id": "p1",
            "method": "pipe_open",
            "params": {"pipe": "k1", "spec": spec.model_dump(exclude_none=True)},
        }
    )
    await rig.settle()
    assert rig.replies("p1")["result"] == {}
    rig.children[0].stdout.feed_data(b"out")
    await rig.settle()
    assert rig.ws.sent[-1] == {
        "jsonrpc": "2.0",
        "method": "pipe_data",
        "params": {"pipe": "k1", "data": base64.b64encode(b"out").decode()},
    }


async def test_a_pipe_open_off_the_list_gets_denied_from_a_genuine_brain(rig):
    spec = {"command": str(rig.exe), "args": []}
    rig.ws.feed({"id": "p1", "method": "pipe_open", "params": {"pipe": "k1", "spec": spec}})
    await rig.settle()
    assert rig.replies("p1")["error"]["code"] == ErrorCode.denied
    assert rig.children == []


async def test_a_malformed_pipe_open_is_invalid_params(rig):
    rig.ws.feed({"id": "p1", "method": "pipe_open", "params": {"pipe": "k1"}})
    await rig.settle()
    assert rig.replies("p1")["error"]["code"] == ErrorCode.invalid_params


async def test_the_brains_data_and_close_reach_the_child(rig):
    spec = PipeSpec(command=str(rig.exe))
    rig.allowlist.allow(spec)
    rig.ws.feed(
        {
            "id": "p1",
            "method": "pipe_open",
            "params": {"pipe": "k1", "spec": spec.model_dump(exclude_none=True)},
        }
    )
    rig.ws.feed(
        {"method": "pipe_data", "params": {"pipe": "k1", "data": base64.b64encode(b"in").decode()}}
    )
    await rig.settle()
    assert rig.children[0].written == [b"in"]
    rig.ws.feed({"method": "pipe_close", "params": {"pipe": "k1"}})
    await rig.settle()
    assert rig.children[0].killed


async def test_folder_check_says_whether_a_folder_is_here(rig, tmp_path):
    rig.ws.feed({"id": "f1", "method": "folder_check", "params": {"path": str(tmp_path)}})
    rig.ws.feed({"id": "f2", "method": "folder_check", "params": {"path": str(tmp_path / "nope")}})
    await rig.settle()
    assert rig.replies("f1")["result"] == {"exists": True}
    assert rig.replies("f2")["result"] == {"exists": False}


async def test_a_close_of_a_stuck_child_does_not_stall_the_session(tmp_path):
    rig = Rig(tmp_path, LingeringChild)
    rig.start()
    spec = PipeSpec(command=str(rig.exe))
    rig.allowlist.allow(spec)
    rig.ws.feed(
        {
            "id": "p1",
            "method": "pipe_open",
            "params": {"pipe": "k1", "spec": spec.model_dump(exclude_none=True)},
        }
    )
    rig.ws.feed({"method": "pipe_close", "params": {"pipe": "k1"}})
    rig.ws.feed({"id": "f1", "method": "folder_check", "params": {"path": str(tmp_path)}})
    await asyncio.sleep(0.2)
    assert rig.replies("f1")["result"] == {"exists": True}
    await asyncio.wait_for(rig.finish(), timeout=2)


async def test_a_notification_without_an_id_gets_no_reply_and_does_not_end_the_node(rig):
    spec = PipeSpec(command=str(rig.exe))
    rig.allowlist.allow(spec)
    rig.ws.feed(
        {
            "method": "pipe_open",
            "params": {"pipe": "k1", "spec": spec.model_dump(exclude_none=True)},
        }
    )
    rig.ws.feed({"id": "f1", "method": "folder_check", "params": {"path": str(rig.exe.parent)}})
    await rig.settle()
    assert not rig.task.done()
    assert rig.replies("f1")["result"] == {"exists": True}


async def test_losing_the_brain_kills_every_child(rig):
    spec = PipeSpec(command=str(rig.exe))
    rig.allowlist.allow(spec)
    rig.ws.feed(
        {
            "id": "p1",
            "method": "pipe_open",
            "params": {"pipe": "k1", "spec": spec.model_dump(exclude_none=True)},
        }
    )
    await rig.settle()
    await rig.finish()
    assert rig.children[0].killed


async def test_a_refused_hello_ends_the_session(tmp_path):
    rig = Rig(tmp_path)
    rig.start()
    await rig.settle()
    rig.ws.feed(
        {
            "id": "h1",
            "error": {"code": ErrorCode.unauthorized, "message": "Unknown or revoked token"},
        }
    )
    with pytest.raises(HelloRefused):
        await rig.task
