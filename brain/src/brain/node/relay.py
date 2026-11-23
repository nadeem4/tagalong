"""A node's relay to an HTTP MCP server: the brain's newline-delimited JSON-RPC bytes become
streamable-HTTP requests from this machine, and the server's messages come back as lines. It
looks like a child process to the pipes, so the brain's end is the same for a command and a URL.
"""

import asyncio
import json
import logging
from collections.abc import Callable
from urllib.parse import quote, quote_plus

import anyio
import httpx2
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client
from mcp.shared.message import SessionMessage
from mcp.types import jsonrpc_message_adapter

log = logging.getLogger("node")

MAX_LINE = 8 * 1024 * 1024
INVALID_REQUEST = -32600


class HttpRelay:
    def __init__(
        self,
        url: str,
        secrets: Callable[[], list[str]],
        auth: httpx2.Auth | None = None,
        bearer: str | None = None,
    ) -> None:
        self.stdout = asyncio.StreamReader()
        self._url = url
        self._auth = auth
        self._headers = {"Authorization": f"Bearer {bearer}"} if bearer else None
        self._secrets = secrets
        self._seen: tuple[str, ...] = ()
        self._forms: list[str] = []
        self._lines: asyncio.Queue[SessionMessage] = asyncio.Queue()
        self._partial = b""
        self._task = asyncio.create_task(self._run())

    def write(self, data: bytes) -> None:
        *lines, self._partial = (self._partial + data).split(b"\n")
        if any(len(line) > MAX_LINE for line in (*lines, self._partial)):
            self.kill()
            self.stdout.feed_eof()
            return
        for line in lines:
            try:
                message = jsonrpc_message_adapter.validate_json(line, by_name=False)
            except ValueError:
                self._reject(line)
                continue
            self._lines.put_nowait(SessionMessage(message))

    def _reject(self, line: bytes) -> None:
        try:
            request = json.loads(line)
        except ValueError:
            return
        if isinstance(request, dict) and isinstance(request.get("id"), (str, int)):
            error = {"code": INVALID_REQUEST, "message": "That is not a JSON-RPC message."}
            self._emit(json.dumps({"jsonrpc": "2.0", "id": request["id"], "error": error}))

    def _emit(self, text: str) -> None:
        # Read on every line: the SDK refreshes the sign-in's tokens while the pipe is open.
        secrets = tuple(self._secrets())
        if secrets != self._seen:
            self._seen = secrets
            forms = {
                form
                for value in secrets
                for form in (value, quote(value, safe=""), quote_plus(value))
            }
            self._forms = sorted(forms, key=len, reverse=True)
        for form in self._forms:
            text = text.replace(form, "[secret]")
        self.stdout.feed_data(text.encode() + b"\n")

    def kill(self) -> None:
        self._task.cancel()

    async def wait(self) -> int:
        await asyncio.gather(self._task, return_exceptions=True)
        return 0

    async def _run(self) -> None:
        try:
            async with (
                create_mcp_http_client(headers=self._headers, auth=self._auth) as client,
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
                        self._emit(text)
                tasks.cancel_scope.cancel()
        except Exception:
            log.warning("the relay to the app ended with an error", exc_info=False)
        finally:
            self.stdout.feed_eof()
