"""A node's relay to an HTTP MCP server: the brain's newline-delimited JSON-RPC bytes become
streamable-HTTP requests from this machine, and the server's messages come back as lines. It
looks like a child process to the pipes, so the brain's end is the same for a command and a URL.
"""

import asyncio
import logging

import anyio
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client
from mcp.shared.message import SessionMessage
from mcp.types import jsonrpc_message_adapter

log = logging.getLogger("node")


class HttpRelay:
    def __init__(self, url: str) -> None:
        self.stdout = asyncio.StreamReader()
        self._url = url
        self._lines: asyncio.Queue[SessionMessage] = asyncio.Queue()
        self._partial = b""
        self._task = asyncio.create_task(self._run())

    def write(self, data: bytes) -> None:
        *lines, self._partial = (self._partial + data).split(b"\n")
        for line in lines:
            try:
                message = jsonrpc_message_adapter.validate_json(line, by_name=False)
            except ValueError:
                continue
            self._lines.put_nowait(SessionMessage(message))

    def kill(self) -> None:
        self._task.cancel()

    async def wait(self) -> int:
        await asyncio.gather(self._task, return_exceptions=True)
        return 0

    async def _run(self) -> None:
        try:
            async with (
                create_mcp_http_client() as client,
                streamable_http_client(self._url, http_client=client) as (read, write),
                anyio.create_task_group() as tasks,
            ):

                async def send() -> None:
                    while True:
                        await write.send(await self._lines.get())

                tasks.start_soon(send)
                async for item in read:
                    if isinstance(item, SessionMessage):
                        text = item.message.model_dump_json(by_alias=True, exclude_unset=True)
                        self.stdout.feed_data(text.encode() + b"\n")
                tasks.cancel_scope.cancel()
        except Exception:
            log.warning("the relay to the app ended with an error", exc_info=False)
        finally:
            self.stdout.feed_eof()
