"""Checks the bridge supervisor: settings, the child's environment, restarts, stop and logging.

The process spawner, Node and sleep are fakes; nothing real is started.
"""

import asyncio
import io
import logging
import os
import sys
from pathlib import Path

from brain import bridges
from brain.bridges import DEFAULT_PORT, BridgeSupervisor, WhatsAppSettings, real_spawn
from brain.masking import Masker, SecretLogFilter
from brain.setup.facts import NodePaths

SECRETS = {
    "TAGALONG_WHATSAPP_ACCESS_TOKEN": "tok-secret-123456",
    "TAGALONG_WHATSAPP_APP_SECRET": "app-secret-123456",
    "TAGALONG_WHATSAPP_VERIFY_TOKEN": "verify-123456",
    "TAGALONG_WHATSAPP_PHONE_NUMBER_ID": "1234567890",
    "TAGALONG_WHATSAPP_ALLOWED_NUMBER": "15551234567",
}
ON = {"TAGALONG_WHATSAPP_ENABLED": "1", **SECRETS}


class FakeChild:
    def __init__(
        self, lines: list[bytes] | None = None, *, broken=False, stubborn=False, slow=False
    ) -> None:
        self.done = asyncio.Event()
        self.code = 0
        self.terminated = False
        self.killed = False
        self.slow = slow  # exits a moment after terminate, like a real process
        self.stubborn = stubborn  # ignores terminate, like a child stuck in cleanup
        self._broken = broken
        self._lines = lines or []
        self.stdout = self._read()

    async def _read(self):
        for line in self._lines:
            yield line
        if self._broken:
            raise ValueError("Separator is not found, and chunk exceed the limit")
        await self.done.wait()

    async def wait(self) -> int:
        await self.done.wait()
        return self.code

    def terminate(self) -> None:
        self.terminated = True
        if self.slow:
            asyncio.get_running_loop().call_later(0.02, self.done.set)
        elif not self.stubborn:
            self.done.set()

    def kill(self) -> None:
        self.killed = True
        self.done.set()

    def exit(self, code: int = 1) -> None:
        self.code = code
        self.done.set()


class Rig:
    def __init__(
        self, tmp_path: Path, env: dict | None = None, built: bool = True, grace: float = 5.0
    ) -> None:
        self.env = dict(ON if env is None else env)
        self.entry = tmp_path / "index.js"
        if built:
            self.entry.write_text("// bridge")
        self.spawned: list[tuple[list[str], dict[str, str]]] = []
        self.children: list[FakeChild] = []
        self.lines: list[bytes] = []
        self.sleeps: list[float] = []
        self.node_error: Exception | None = None
        self.events: list[str] = []
        self.now = 0.0
        self.broken_first = False
        self.stubborn = False
        self.slow = False
        self.supervisor = BridgeSupervisor(
            env=self.env,
            brain_addr="127.0.0.1:47321",
            entry=self.entry,
            ensure_node=self._node,
            spawn=self._spawn,
            sleep=self._sleep,
            clock=lambda: self.now,
            grace=grace,
        )

    async def _node(self) -> Path:
        self.events.append("node")
        if self.node_error:
            raise self.node_error
        return Path("node-private")

    async def _spawn(self, argv, env):
        self.events.append("spawn")
        self.spawned.append((argv, env))
        child = FakeChild(
            self.lines,
            broken=self.broken_first and not self.children,
            stubborn=self.stubborn,
            slow=self.slow,
        )
        self.children.append(child)
        return child

    async def _sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        await asyncio.sleep(0)


async def settle() -> None:
    for _ in range(20):
        await asyncio.sleep(0)


def test_settings_complete_only_with_the_five_values():
    assert WhatsAppSettings.from_env(ON).complete
    for name in SECRETS:
        assert not WhatsAppSettings.from_env({**ON, name: ""}).complete
    assert not WhatsAppSettings.from_env({}).enabled


def test_child_env_has_only_the_bridge_values(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-should-not-leak-0000")
    monkeypatch.setenv("PATH", "p")
    env = WhatsAppSettings.from_env({**ON, "SOMETHING_ELSE": "x"}).child_env("127.0.0.1:47321")
    assert env["TAGALONG_BRAIN_ADDR"] == "127.0.0.1:47321"
    assert env["TAGALONG_WHATSAPP_PORT"] == str(DEFAULT_PORT)
    assert env["TAGALONG_WHATSAPP_ACCESS_TOKEN"] == SECRETS["TAGALONG_WHATSAPP_ACCESS_TOKEN"]
    allowed = {*SECRETS, "TAGALONG_BRAIN_ADDR", "TAGALONG_WHATSAPP_PORT", "PATH", "SystemRoot"}
    assert set(env) <= allowed
    assert "ANTHROPIC_API_KEY" not in env and "SOMETHING_ELSE" not in env


async def test_off_or_incomplete_runs_nothing(tmp_path):
    for env, state in (({}, "off"), ({**ON, "TAGALONG_WHATSAPP_APP_SECRET": ""}, "incomplete")):
        rig = Rig(tmp_path, env)
        await rig.supervisor.start()
        await settle()
        assert rig.spawned == [] and not rig.supervisor.running
        assert rig.supervisor.state == state


async def test_start_spawns_the_bridge_on_the_private_node(tmp_path):
    rig = Rig(tmp_path)
    await rig.supervisor.start()
    await settle()
    argv, env = rig.spawned[0]
    assert argv == ["node-private", str(rig.entry)]
    assert env["TAGALONG_WHATSAPP_APP_SECRET"] == SECRETS["TAGALONG_WHATSAPP_APP_SECRET"]
    assert rig.supervisor.running and rig.supervisor.state == "running"
    await rig.supervisor.stop()


async def test_exit_restarts_with_growing_waits(tmp_path):
    rig = Rig(tmp_path)
    await rig.supervisor.start()
    for n in range(8):
        await settle()
        assert len(rig.spawned) == n + 1
        rig.children[-1].exit(1)
    await settle()
    assert rig.sleeps == [1, 2, 4, 8, 16, 30, 30, 30]
    await rig.supervisor.stop()


async def test_stop_ends_the_child(tmp_path):
    rig = Rig(tmp_path)
    await rig.supervisor.start()
    await settle()
    await rig.supervisor.stop()
    assert rig.children[0].terminated
    assert not rig.supervisor.running
    await settle()
    assert len(rig.spawned) == 1  # no restart after a stop


async def test_apply_restarts_with_the_new_settings(tmp_path):
    rig = Rig(tmp_path)
    await rig.supervisor.start()
    await settle()
    rig.env["TAGALONG_WHATSAPP_ALLOWED_NUMBER"] = "15559999999"
    await rig.supervisor.apply()
    await settle()
    assert rig.children[0].terminated and len(rig.spawned) == 2
    assert rig.spawned[1][1]["TAGALONG_WHATSAPP_ALLOWED_NUMBER"] == "15559999999"
    rig.env["TAGALONG_WHATSAPP_ENABLED"] = "0"
    await rig.supervisor.apply()
    await settle()
    assert rig.children[1].terminated and len(rig.spawned) == 2
    assert rig.supervisor.state == "off"


async def test_a_bridge_that_is_not_built_logs_one_line_and_runs_nothing(tmp_path, caplog):
    rig = Rig(tmp_path, built=False)
    with caplog.at_level(logging.INFO, logger="brain.bridge"):
        await rig.supervisor.start()
        await settle()
    assert rig.spawned == [] and rig.supervisor.state == "not_built"
    lines = [r.getMessage() for r in caplog.records]
    assert len(lines) == 1 and "pnpm --filter @tagalong/whatsapp build" in lines[0]


async def test_a_node_that_cannot_be_made_runs_nothing(tmp_path, caplog):
    rig = Rig(tmp_path)
    rig.node_error = OSError("disk full")
    with caplog.at_level(logging.INFO, logger="brain.bridge"):
        await rig.supervisor.start()
        await settle()
    assert rig.spawned == [] and rig.supervisor.state == "node_failed"
    assert len(caplog.records) == 1


async def test_child_output_is_logged_through_the_filter(tmp_path, caplog):
    rig = Rig(tmp_path)
    token = SECRETS["TAGALONG_WHATSAPP_ACCESS_TOKEN"]
    rig.lines = [f"sent with {token}\n".encode(), b"listening\n"]
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(SecretLogFilter(Masker(lambda: [token])))
    log = logging.getLogger("brain.bridge")
    log.addHandler(handler)
    try:
        with caplog.at_level(logging.INFO, logger="brain.bridge"):  # restores the level after
            await rig.supervisor.start()
            await settle()
            await rig.supervisor.stop()
    finally:
        log.removeHandler(handler)
    out = stream.getvalue()
    assert token not in out and "sent with [secret]" in out and "listening" in out


async def test_a_failing_output_stream_does_not_end_the_watch(tmp_path, caplog):
    rig = Rig(tmp_path)
    rig.broken_first = True
    with caplog.at_level(logging.INFO, logger="brain.bridge"):
        await rig.supervisor.start()
        await settle()
    assert len(rig.spawned) == 2 and rig.sleeps == [1]
    assert rig.supervisor.state == "running"
    assert any("ValueError" in r.getMessage() for r in caplog.records)
    await rig.supervisor.stop()


async def test_stop_waits_for_the_child_and_kills_one_that_will_not_go(tmp_path):
    rig = Rig(tmp_path, grace=0.01)
    rig.stubborn = True
    await rig.supervisor.start()
    await settle()
    await rig.supervisor.stop()
    child = rig.children[0]
    assert child.terminated and child.killed and child.done.is_set()


async def test_stop_returns_after_the_child_has_exited(tmp_path):
    rig = Rig(tmp_path)
    rig.slow = True  # without the wait in stop, the child would still be running here
    await rig.supervisor.start()
    await settle()
    await rig.supervisor.stop()
    assert rig.children[0].done.is_set() and not rig.children[0].killed


async def test_stop_twice_is_fine(tmp_path):
    rig = Rig(tmp_path)
    await rig.supervisor.start()
    await settle()
    await rig.supervisor.stop()
    await rig.supervisor.stop()
    assert rig.supervisor.state == "off" and len(rig.spawned) == 1


async def test_apply_starts_the_waits_over_at_one_second(tmp_path):
    rig = Rig(tmp_path)
    await rig.supervisor.start()
    for _ in range(3):
        await settle()
        rig.children[-1].exit(1)
    await settle()
    assert rig.sleeps == [1, 2, 4]
    await rig.supervisor.apply()
    await settle()
    rig.children[-1].exit(1)
    await settle()
    assert rig.sleeps == [1, 2, 4, 1]
    await rig.supervisor.stop()


async def test_a_long_healthy_run_resets_the_wait(tmp_path):
    rig = Rig(tmp_path)
    await rig.supervisor.start()
    for _ in range(3):
        await settle()
        rig.children[-1].exit(1)
    await settle()
    rig.now = 120.0  # the fourth bridge ran two minutes
    rig.children[-1].exit(1)
    await settle()
    assert rig.sleeps == [1, 2, 4, 1]
    await rig.supervisor.stop()


async def test_the_runtime_is_installed_first_when_missing(tmp_path):
    rig = Rig(tmp_path)
    await rig.supervisor.start()
    await settle()
    assert rig.events[:2] == ["node", "spawn"]
    await rig.supervisor.stop()


async def test_private_node_asks_for_tagalongs_own_node(monkeypatch, tmp_path):
    seen = {}

    async def fake_ensure(home, floor, fetch, get_json, os_name, arch, progress):
        seen["args"] = (home, floor, os_name, arch)
        return NodePaths(Path("own-node"), Path("npm"))

    class Machine:
        os, arch = "windows", "x64"

    async def inspect_machine():
        return Machine()

    monkeypatch.setattr(bridges, "ensure_node", fake_ensure)
    node = await bridges.private_node(tmp_path, inspect_machine)()
    assert node == Path("own-node")
    assert seen["args"] == (tmp_path, bridges.NODE_FLOOR, "windows", "x64")


async def test_real_spawn_pipes_stdin_and_merges_stderr():
    code = (
        "import sys; print('out', flush=True); "
        "print('err', file=sys.stderr, flush=True); sys.stdin.read()"
    )
    child = await real_spawn([sys.executable, "-c", code], dict(os.environ))

    async def read_two() -> list[bytes]:
        lines = []
        async for line in child.stdout:
            lines.append(line.strip())
            if len(lines) == 2:
                break
        return lines

    try:
        lines = await asyncio.wait_for(read_two(), 10)
        assert sorted(lines) == [b"err", b"out"]
        child._proc.stdin.close()  # the bridge's signal to exit
        assert await asyncio.wait_for(child.wait(), 10) == 0
    finally:  # a failing assert must not leave the child running
        child.kill()
        await asyncio.wait_for(child.wait(), 10)
