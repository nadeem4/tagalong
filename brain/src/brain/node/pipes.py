"""The node's pipes: one allowed command (or HTTP MCP relay) per pipe, its stdin and stdout
relayed to the brain as base64 `pipe_data`. The spec is checked against the allow-list before
anything starts; the secrets the person entered here are added to the child or the URL on this
machine only. The brain keeps all the protocol logic (ACP, MCP) and the node only moves bytes.
"""

import asyncio
import base64
import contextlib
import os
import signal
import subprocess
import sys
from collections.abc import Awaitable, Callable
from typing import Protocol

from brain.apps import merge_url_secret
from brain.node.allowlist import Allowlist
from brain.node.relay import HttpRelay
from brain.protocol import ErrorCode, PipeSpec, RpcError

CHUNK = 65_536


class Child(Protocol):
    stdout: asyncio.StreamReader

    def write(self, data: bytes) -> None: ...

    def kill(self) -> None: ...

    async def wait(self) -> int: ...


Spawn = Callable[[str, list[str], dict[str, str]], Awaitable[Child]]
ConnectUrl = Callable[[str], Child]
Send = Callable[[str, dict], None]


class _Process:
    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self._proc = proc
        assert proc.stdout is not None
        self.stdout = proc.stdout

    def write(self, data: bytes) -> None:
        self._proc.stdin.write(data)

    def kill(self) -> None:
        # A .cmd shim or wrapper leaves a grandchild holding stdout, so the whole tree goes.
        with contextlib.suppress(ProcessLookupError):
            if sys.platform == "win32":
                subprocess.Popen(
                    ["taskkill", "/pid", str(self._proc.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            else:
                os.killpg(self._proc.pid, signal.SIGKILL)

    async def wait(self) -> int:
        return await self._proc.wait()


async def spawn_process(path: str, args: list[str], env: dict[str, str]) -> Child:
    proc = await asyncio.create_subprocess_exec(
        path,
        *args,
        env={**os.environ, **env},
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        start_new_session=sys.platform != "win32",
    )
    return _Process(proc)


class Pipes:
    def __init__(
        self,
        allowlist: Allowlist,
        send: Send,
        spawn: Spawn = spawn_process,
        connect_url: ConnectUrl = HttpRelay,
    ) -> None:
        self._allowlist = allowlist
        self._send = send
        self._spawn = spawn
        self._connect_url = connect_url
        self._open: dict[str, tuple[Child, asyncio.Task]] = {}

    async def open(self, pipe: str, spec: PipeSpec) -> None:
        if pipe in self._open:
            raise RpcError(ErrorCode.invalid_params, "That pipe is already open.")
        path = self._allowlist.permits(spec)
        if path is None:
            raise RpcError(ErrorCode.denied, "That is not on this node's list.")
        secrets = self._allowlist.secrets(spec)
        try:
            if spec.url is not None:
                query = secrets.url_query
                child = self._connect_url(merge_url_secret(path, query) if query else path)
            else:
                child = await self._spawn(path, spec.args, secrets.env)
        except OSError as err:
            raise RpcError(ErrorCode.tool_failed, f"Could not start it: {err}") from None
        self._open[pipe] = (child, asyncio.create_task(self._relay(pipe, child)))

    def write(self, pipe: str, data: str) -> None:
        entry = self._open.get(pipe)
        if entry is None:
            return
        try:
            entry[0].write(base64.b64decode(data, validate=True))
        except ValueError:
            return

    async def close(self, pipe: str) -> None:
        entry = self._open.pop(pipe, None)
        if entry is None:
            return
        entry[0].kill()
        entry[1].cancel()
        await asyncio.gather(entry[1], return_exceptions=True)

    async def close_all(self) -> None:
        for pipe in list(self._open):
            await self.close(pipe)

    async def _relay(self, pipe: str, child: Child) -> None:
        while chunk := await child.stdout.read(CHUNK):
            self._send("pipe_data", {"pipe": pipe, "data": base64.b64encode(chunk).decode()})
        code = await child.wait()
        if self._open.pop(pipe, None) is not None:  # not already closed by the brain
            self._send("pipe_close", {"pipe": pipe, "code": code})
