"""The node's pipes: one allowed command per pipe, its stdin and stdout relayed to the brain as
base64 `pipe_data`. The spec is checked against the allow-list before anything starts; the
brain keeps all the protocol logic (ACP, MCP) and the node only moves bytes.
"""

import asyncio
import base64
import contextlib
from collections.abc import Awaitable, Callable
from typing import Protocol

from brain.node.allowlist import Allowlist
from brain.protocol import ErrorCode, PipeSpec, RpcError

CHUNK = 65_536


class Child(Protocol):
    stdout: asyncio.StreamReader

    def write(self, data: bytes) -> None: ...

    def kill(self) -> None: ...

    async def wait(self) -> int: ...


Spawn = Callable[[str, list[str]], Awaitable[Child]]
Send = Callable[[str, dict], None]


class _Process:
    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self._proc = proc
        assert proc.stdout is not None
        self.stdout = proc.stdout

    def write(self, data: bytes) -> None:
        if self._proc.stdin is not None:
            self._proc.stdin.write(data)

    def kill(self) -> None:
        with contextlib.suppress(ProcessLookupError):
            self._proc.kill()

    async def wait(self) -> int:
        return await self._proc.wait()


async def spawn_process(path: str, args: list[str]) -> Child:
    proc = await asyncio.create_subprocess_exec(
        path,
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    return _Process(proc)


class Pipes:
    def __init__(self, allowlist: Allowlist, send: Send, spawn: Spawn = spawn_process) -> None:
        self._allowlist = allowlist
        self._send = send
        self._spawn = spawn
        self._open: dict[str, tuple[Child, asyncio.Task]] = {}

    async def open(self, pipe: str, spec: PipeSpec) -> None:
        if pipe in self._open:
            raise RpcError(ErrorCode.invalid_params, "That pipe is already open.")
        path = self._allowlist.permits(spec)
        if path is None:
            raise RpcError(ErrorCode.denied, "That command is not on this node's list.")
        try:
            child = await self._spawn(path, spec.args)
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
