"""Checks the bridge supervisor: settings, the child's environment, restarts, stop and logging.

The process spawner, Node and sleep are fakes; nothing real is started.
"""

import asyncio
import io
import logging
from pathlib import Path

from brain.bridges import DEFAULT_PORT, BridgeSupervisor, WhatsAppSettings
from brain.masking import Masker, SecretLogFilter

SECRETS = {
    "TAGALONG_WHATSAPP_ACCESS_TOKEN": "tok-secret-123456",
    "TAGALONG_WHATSAPP_APP_SECRET": "app-secret-123456",
    "TAGALONG_WHATSAPP_VERIFY_TOKEN": "verify-123456",
    "TAGALONG_WHATSAPP_PHONE_NUMBER_ID": "1234567890",
    "TAGALONG_WHATSAPP_ALLOWED_NUMBER": "15551234567",
}
ON = {"TAGALONG_WHATSAPP_ENABLED": "1", **SECRETS}


class FakeChild:
    def __init__(self, lines: list[bytes] | None = None) -> None:
        self.done = asyncio.Event()
        self.code = 0
        self.terminated = False
        self._lines = lines or []
        self.stdout = self._read()

    async def _read(self):
        for line in self._lines:
            yield line
        await self.done.wait()

    async def wait(self) -> int:
        await self.done.wait()
        return self.code

    def terminate(self) -> None:
        self.terminated = True
        self.done.set()

    def exit(self, code: int = 1) -> None:
        self.code = code
        self.done.set()


class Rig:
    def __init__(self, tmp_path: Path, env: dict | None = None, built: bool = True) -> None:
        self.env = dict(ON if env is None else env)
        self.entry = tmp_path / "index.js"
        if built:
            self.entry.write_text("// bridge")
        self.spawned: list[tuple[list[str], dict[str, str]]] = []
        self.children: list[FakeChild] = []
        self.lines: list[bytes] = []
        self.sleeps: list[float] = []
        self.node_error: Exception | None = None
        self.supervisor = BridgeSupervisor(
            env=self.env,
            brain_addr="127.0.0.1:47321",
            entry=self.entry,
            ensure_node=self._node,
            spawn=self._spawn,
            sleep=self._sleep,
        )

    async def _node(self) -> Path:
        if self.node_error:
            raise self.node_error
        return Path("node-private")

    async def _spawn(self, argv, env):
        self.spawned.append((argv, env))
        child = FakeChild(self.lines)
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


async def test_child_output_is_logged_through_the_filter(tmp_path):
    rig = Rig(tmp_path)
    token = SECRETS["TAGALONG_WHATSAPP_ACCESS_TOKEN"]
    rig.lines = [f"sent with {token}\n".encode(), b"listening\n"]
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(SecretLogFilter(Masker(lambda: [token])))
    log = logging.getLogger("brain.bridge")
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    try:
        await rig.supervisor.start()
        await settle()
        await rig.supervisor.stop()
    finally:
        log.removeHandler(handler)
    out = stream.getvalue()
    assert token not in out and "sent with [secret]" in out and "listening" in out
