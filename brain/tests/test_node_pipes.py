"""The node's pipes against a fake child: spec checked first, bytes relayed both ways, a
close from the brain kills the child. No real process is started.
"""

import asyncio
import os
import sys
from pathlib import Path

import pytest

from brain.node.allowlist import Allowlist
from brain.node.main import HelloRefused, run_node
from brain.node.pipes import Pipes, spawn_process
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


class LingeringChild(FakeChild):
    """A child whose stdout stays open after kill, as a grandchild holding the pipe does."""

    def kill(self) -> None:
        self.killed = True


class Setup:
    def __init__(self, tmp_path: Path, child_type: type[FakeChild] = FakeChild) -> None:
        self.exe = tmp_path / "expert.exe"
        self.exe.write_bytes(b"binary")
        self.exe.chmod(0o755)
        self.allowlist = Allowlist(tmp_path / "allowlist.json")
        self.sent: list[tuple[str, dict]] = []
        self.children: list[FakeChild] = []
        self.started: list[tuple[str, list[str]]] = []
        self.envs: list[dict[str, str]] = []
        self.relayed: list[str] = []

        async def spawn(path: str, args: list[str], env: dict[str, str]) -> FakeChild:
            self.started.append((path, args))
            self.envs.append(env)
            child = child_type()
            self.children.append(child)
            return child

        def relay(url, secrets, auth, bearer) -> FakeChild:
            self.relayed.append(url)
            child = child_type()
            self.children.append(child)
            return child

        self.pipes = Pipes(self.allowlist, lambda m, p: self.sent.append((m, p)), spawn, relay)

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


async def test_close_returns_though_the_childs_stdout_stays_open(tmp_path):
    node = Setup(tmp_path, LingeringChild)
    node.allowlist.allow(node.spec())
    await node.pipes.open("k1", node.spec())
    await asyncio.wait_for(node.pipes.close("k1"), timeout=2)
    assert node.children[0].killed


async def test_a_spawned_child_does_not_inherit_the_nodes_link_token(monkeypatch):
    env = {
        "TAGALONG_NODE_ADDR": "a:1",
        "TAGALONG_NODE_FP": "f",
        "TAGALONG_NODE_TOKEN": "secret-token",
        "TAGALONG_NODE_ID": "node-1",
    }
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    async def refused(addr, fp):
        raise HelloRefused("revoked")

    with pytest.raises(HelloRefused):
        await run_node(os.environ, Allowlist(Path("unused.json")), dial=refused)
    child = await spawn_process(
        sys.executable, ["-c", "import os; print(sorted(k for k in os.environ if 'NODE' in k))"], {}
    )
    out = await child.stdout.read()
    assert b"TAGALONG_NODE" not in out


async def test_the_secrets_entered_on_the_node_reach_the_child_and_no_one_else(node):
    node.allowlist.allow(node.spec(), secret_env={"API_KEY": "s3cret"})
    await node.pipes.open("k1", node.spec())
    assert node.envs == [{"API_KEY": "s3cret"}]
    assert node.sent == []


async def test_an_approved_url_is_relayed_with_its_secret_query_added_on_the_node(node):
    url = "https://mcp.example.com/mcp"
    node.allowlist.allow(PipeSpec(url=url), url_query="key=abc")
    await node.pipes.open("k1", PipeSpec(url=url))
    assert node.relayed == [url + "?key=abc"]


async def test_a_url_the_person_did_not_approve_is_denied_and_never_contacted(node):
    node.allowlist.allow(PipeSpec(url="https://mcp.example.com/mcp"))
    with pytest.raises(RpcError) as caught:
        await node.pipes.open("k1", PipeSpec(url="https://evil.example.com/mcp"))
    assert caught.value.code == ErrorCode.denied
    assert node.relayed == []
