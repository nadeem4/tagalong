"""The node's pipes against a fake child: spec checked first, bytes relayed both ways, a
close from the brain kills the child. No real process is started.
"""

import asyncio
import base64
from pathlib import Path

import pytest

from brain.node.allowlist import Allowlist
from brain.node.pipes import Pipes
from brain.protocol import ErrorCode, PipeSpec, RpcError


class FakeChild:
    def __init__(self) -> None:
        self.stdout = asyncio.StreamReader()
        self.written: list[bytes] = []
        self.killed = False
        self.returncode: int | None = None
        self._done = asyncio.Event()

    def write(self, data: bytes) -> None:
        self.written.append(data)

    def kill(self) -> None:
        self.killed = True
        self.exit(-9)

    def exit(self, code: int) -> None:
        self.returncode = code
        self.stdout.feed_eof()
        self._done.set()

    async def wait(self) -> int:
        await self._done.wait()
        assert self.returncode is not None
        return self.returncode


class Setup:
    def __init__(self, tmp_path: Path) -> None:
        self.exe = tmp_path / "expert.exe"
        self.exe.write_bytes(b"binary")
        self.allowlist = Allowlist(tmp_path / "allowlist.json")
        self.sent: list[tuple[str, dict]] = []
        self.children: list[FakeChild] = []
        self.started: list[tuple[str, list[str]]] = []

        async def spawn(path: str, args: list[str]) -> FakeChild:
            self.started.append((path, args))
            child = FakeChild()
            self.children.append(child)
            return child

        self.pipes = Pipes(self.allowlist, lambda m, p: self.sent.append((m, p)), spawn)

    def spec(self, *args: str) -> PipeSpec:
        return PipeSpec(command=str(self.exe), args=list(args))


@pytest.fixture
def node(tmp_path: Path) -> Setup:
    return Setup(tmp_path)


async def settle() -> None:
    for _ in range(5):
        await asyncio.sleep(0)


async def test_an_approved_spec_starts_the_child_with_its_args(node):
    node.allowlist.allow(node.spec("--stdio"))
    await node.pipes.open("k1", node.spec("--stdio"))
    assert node.started == [(str(node.exe), ["--stdio"])]


async def test_a_spec_off_the_list_is_denied_and_nothing_starts(node):
    with pytest.raises(RpcError) as caught:
        await node.pipes.open("k1", node.spec("--stdio"))
    assert caught.value.code == ErrorCode.denied
    assert node.started == []


async def test_child_output_reaches_the_brain_as_base64_data(node):
    node.allowlist.allow(node.spec())
    await node.pipes.open("k1", node.spec())
    node.children[0].stdout.feed_data(b'{"a":1}\n')
    await settle()
    assert node.sent == [
        ("pipe_data", {"pipe": "k1", "data": base64.b64encode(b'{"a":1}\n').decode()})
    ]


async def test_the_brains_bytes_reach_the_childs_stdin(node):
    node.allowlist.allow(node.spec())
    await node.pipes.open("k1", node.spec())
    node.pipes.write("k1", base64.b64encode(b"hello").decode())
    assert node.children[0].written == [b"hello"]


async def test_a_child_that_exits_closes_the_pipe_with_its_code(node):
    node.allowlist.allow(node.spec())
    await node.pipes.open("k1", node.spec())
    node.children[0].exit(3)
    await settle()
    assert node.sent == [("pipe_close", {"pipe": "k1", "code": 3})]


async def test_a_close_from_the_brain_kills_the_child_without_echoing(node):
    node.allowlist.allow(node.spec())
    await node.pipes.open("k1", node.spec())
    await node.pipes.close("k1")
    await settle()
    assert node.children[0].killed
    assert node.sent == []


async def test_an_open_pipe_id_cannot_be_opened_twice(node):
    node.allowlist.allow(node.spec())
    await node.pipes.open("k1", node.spec())
    with pytest.raises(RpcError) as caught:
        await node.pipes.open("k1", node.spec())
    assert caught.value.code == ErrorCode.invalid_params
    assert len(node.children) == 1


async def test_close_all_kills_every_child(node):
    node.allowlist.allow(node.spec())
    await node.pipes.open("k1", node.spec())
    await node.pipes.open("k2", node.spec())
    await node.pipes.close_all()
    assert all(c.killed for c in node.children)
