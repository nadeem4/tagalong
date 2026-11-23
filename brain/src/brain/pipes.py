"""The brain's end of a node pipe: bytes to and from a command on a body's machine, and an MCP
client transport over them. The node only moves bytes; every MCP message is made and read here.
"""

import asyncio
import base64
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager

import anyio
from mcp.shared.message import SessionMessage
from mcp.types import jsonrpc_message_adapter


class Pipe:
    def __init__(self, send: Callable[[bytes], None], close: Callable[[], None]) -> None:
        self._send = send
        self._close = close
        self._incoming: asyncio.Queue[bytes | None] = asyncio.Queue()
        self.ended = False

    def write(self, data: bytes) -> None:
        if not self.ended:
            self._send(data)

    async def read(self) -> bytes | None:
        """The next bytes the command wrote; None once the pipe has ended."""
        return await self._incoming.get()

    def feed(self, data: str) -> None:
        try:
            self._incoming.put_nowait(base64.b64decode(data, validate=True))
        except ValueError:
            return

    def end(self) -> None:
        """The command ended or the node went away: readers see the end."""
        if not self.ended:
            self.ended = True
            self._incoming.put_nowait(None)

    def close(self) -> None:
        if not self.ended:
            self.end()
            self._close()


def _parse(line: bytes) -> SessionMessage | Exception:
    try:
        return SessionMessage(jsonrpc_message_adapter.validate_json(line, by_name=False))
    except ValueError as err:
        return err


@asynccontextmanager
async def mcp_streams(pipe: Pipe) -> AsyncGenerator[tuple, None]:
    """The (read, write) streams a ClientSession takes, over one pipe; leaving closes the pipe."""
    read_out, read = anyio.create_memory_object_stream[SessionMessage | Exception](0)
    write, write_in = anyio.create_memory_object_stream[SessionMessage](0)

    async def reader() -> None:
        buffer = b""
        async with read_out:
            while (chunk := await pipe.read()) is not None:
                *lines, buffer = (buffer + chunk).split(b"\n")
                for line in lines:
                    if line.strip():
                        await read_out.send(_parse(line))

    async def writer() -> None:
        async with write_in:
            async for message in write_in:
                text = message.message.model_dump_json(by_alias=True, exclude_unset=True)
                pipe.write(text.encode() + b"\n")

    async with anyio.create_task_group() as tasks:
        tasks.start_soon(reader)
        tasks.start_soon(writer)
        try:
            yield read, write
        finally:
            pipe.close()
            tasks.cancel_scope.cancel()
