"""Starts and watches the WhatsApp bridge, a child process on Tagalong's own Node.

The brain owns the bridge's life: it runs only when WhatsApp is on and set up, restarts it with
growing waits, and ends it when the brain stops. The child gets a stdin pipe it exits on when
closed, because a hard kill of the brain (`tagalong stop` on Windows) runs no cleanup. Its
output goes through the brain's logger, so the secret filter masks it. Process, Node and sleep
are passed in, so tests use fakes.
"""

import asyncio
import contextlib
import logging
import os
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, MutableMapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from brain.setup.facts import Machine
from brain.setup.install import NODE_FLOOR
from brain.setup.net import http_fetch, real_get_json
from brain.setup.node_runtime import ensure_node

log = logging.getLogger("brain.bridge")

DEFAULT_PORT = 47322
_SECRETS = (
    "TAGALONG_WHATSAPP_ACCESS_TOKEN",
    "TAGALONG_WHATSAPP_APP_SECRET",
    "TAGALONG_WHATSAPP_VERIFY_TOKEN",
    "TAGALONG_WHATSAPP_PHONE_NUMBER_ID",
    "TAGALONG_WHATSAPP_ALLOWED_NUMBER",
)
WHATSAPP_VARS = ("TAGALONG_WHATSAPP_ENABLED", *_SECRETS, "TAGALONG_WHATSAPP_PORT")
_OS_BASICS = ("PATH", "SystemRoot")  # enough for Node to start on Windows and elsewhere
_MAX_WAIT = 30.0
ENTRY = Path(__file__).parents[3] / "bodies" / "whatsapp" / "dist" / "index.js"

State = Literal["off", "incomplete", "starting", "running", "not_built", "node_failed"]


@dataclass(frozen=True)
class WhatsAppSettings:
    enabled: bool
    values: Mapping[str, str]

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "WhatsAppSettings":
        enabled = env.get("TAGALONG_WHATSAPP_ENABLED", "").strip().lower() in ("1", "true", "yes")
        return cls(enabled, {k: env[k] for k in WHATSAPP_VARS if env.get(k)})

    @property
    def complete(self) -> bool:
        return all(self.values.get(k) for k in _SECRETS)

    def child_env(self, brain_addr: str) -> dict[str, str]:
        # Never the brain's own environment: the bridge must not see the Anthropic key.
        env = {k: self.values[k] for k in _SECRETS}
        env["TAGALONG_BRAIN_ADDR"] = brain_addr
        env["TAGALONG_WHATSAPP_PORT"] = self.values.get("TAGALONG_WHATSAPP_PORT") or str(
            DEFAULT_PORT
        )
        env.update({k: os.environ[k] for k in _OS_BASICS if k in os.environ})
        return env


class Child(Protocol):
    stdout: AsyncIterator[bytes] | None

    async def wait(self) -> int: ...

    def terminate(self) -> None: ...


Spawn = Callable[[list[str], dict[str, str]], Awaitable[Child]]


class _Process:
    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self._proc = proc
        self.stdout = proc.stdout  # stdout and stderr arrive merged

    async def wait(self) -> int:
        return await self._proc.wait()

    def terminate(self) -> None:
        with contextlib.suppress(ProcessLookupError):  # already gone
            self._proc.terminate()


async def real_spawn(argv: list[str], env: dict[str, str]) -> Child:
    proc = await asyncio.create_subprocess_exec(
        *argv,
        env=env,
        stdin=asyncio.subprocess.PIPE,  # held open here; the bridge exits when it closes
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    return _Process(proc)


def private_node(
    home: Path, inspect_machine: Callable[[], Awaitable[Machine]]
) -> Callable[[], Awaitable[Path]]:
    """Tagalong's own Node, downloaded checked if missing. The system Node is never used."""

    async def get() -> Path:
        machine = await inspect_machine()
        paths = await ensure_node(
            home, NODE_FLOOR, http_fetch, real_get_json, machine.os, machine.arch, lambda f: None
        )
        return paths.node

    return get


class BridgeSupervisor:
    def __init__(
        self,
        *,
        env: MutableMapping[str, str],
        brain_addr: str,
        entry: Path,
        ensure_node: Callable[[], Awaitable[Path]],
        spawn: Spawn,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._env = env
        self._addr = brain_addr
        self._entry = entry
        self._ensure_node = ensure_node
        self._spawn = spawn
        self._sleep = sleep
        self._task: asyncio.Task | None = None
        self.state: State = "off"

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        if self.running:
            return
        settings = WhatsAppSettings.from_env(self._env)
        if not settings.enabled:
            self.state = "off"
        elif not settings.complete:
            self.state = "incomplete"
        else:
            self.state = "starting"
            self._task = asyncio.create_task(self._watch(settings))

    async def apply(self) -> None:
        # Settings changed: the child's environment is fixed at spawn, so begin again.
        await self.stop()
        await self.start()

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self.state = "off"

    async def _watch(self, settings: WhatsAppSettings) -> None:
        if not self._entry.is_file():
            log.warning(
                "the WhatsApp bridge is not built: run pnpm --filter @tagalong/whatsapp build"
            )
            self.state = "not_built"
            return
        try:
            node = await self._ensure_node()
        except Exception as err:
            log.warning("no Node for the WhatsApp bridge: %s", err)
            self.state = "node_failed"
            return
        env = settings.child_env(self._addr)
        wait = 1.0
        while True:
            await self._run_once([str(node), str(self._entry)], env)
            self.state = "starting"
            await self._sleep(wait)
            wait = min(wait * 2, _MAX_WAIT)

    async def _run_once(self, argv: list[str], env: dict[str, str]) -> None:
        try:
            child = await self._spawn(argv, env)
        except OSError as err:
            log.warning("the WhatsApp bridge would not start: %s", err)
            return
        self.state = "running"
        try:
            if child.stdout is not None:
                async for line in child.stdout:
                    log.info("%s", line.decode("utf-8", "replace").rstrip())
            code = await child.wait()
            log.warning("the WhatsApp bridge exited (%s); starting it again", code)
        finally:
            child.terminate()  # on cancel this ends it; after an exit it does nothing
