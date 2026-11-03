"""The bridge that lets an expert reach chosen connected apps through the brain.

One MCP server on 127.0.0.1 (random port); each job part gets its own bearer token and sees only
the apps it was granted. Every call runs through `Toolbox.run(caller="expert")`, so asks,
preferences and the approvals log apply, and the answer is masked before it leaves. The app's
own sign-in and secrets stay here: the expert holds only a token that dies with its job part.
"""

import asyncio
import contextlib
import hmac
import logging
import secrets
import socket
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import uvicorn
from acp.schema import HttpHeader, HttpMcpServer
from mcp import types
from mcp.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.responses import PlainTextResponse

from brain.app_tools import specs_for
from brain.guards import Guards
from brain.masking import mask_json
from brain.mind.turn import Call
from brain.protocol import RpcError
from brain.toolbox import Toolbox

log = logging.getLogger("brain")


class _Server(uvicorn.Server):
    def capture_signals(self):
        # The brain owns Ctrl+C; uvicorn must not take its signal handlers over.
        return contextlib.nullcontext()


@dataclass
class Grant:
    """One job part's access: a token, the apps it may reach, and the descriptor for ACP."""

    job_id: str
    apps: tuple[str, ...]
    token: str
    descriptor: HttpMcpServer
    manager: StreamableHTTPSessionManager | None = None
    _stop: asyncio.Event = field(default_factory=asyncio.Event)
    _task: asyncio.Task | None = None


class ExpertApps:
    def __init__(self, apps, toolbox: Callable[[], Toolbox], guards: Guards) -> None:
        self._apps = apps
        self._toolbox = toolbox
        self._guards = guards
        self._grants: dict[str, Grant] = {}  # token -> grant
        self._server: _Server | None = None
        self._serving: asyncio.Task | None = None
        self._url = ""

    async def grant(self, job_id: str, app_ids: Sequence[str]) -> Grant:
        await self._ensure_server()
        token = secrets.token_urlsafe(32)
        descriptor = HttpMcpServer(
            type="http",
            name="tagalong",
            url=self._url,
            headers=[HttpHeader(name="Authorization", value=f"Bearer {token}")],
        )
        grant = Grant(job_id, tuple(app_ids), token, descriptor)
        server = Server(
            "tagalong",
            on_list_tools=lambda ctx, params: self._list(grant),
            on_call_tool=lambda ctx, params: self._call(grant, params),
        )
        grant.manager = StreamableHTTPSessionManager(server, json_response=True, stateless=True)
        ready = asyncio.Event()
        # The manager's task group must start and end in one task, so a task owns it.
        grant._task = asyncio.create_task(self._hold(grant, ready))
        await ready.wait()
        self._grants[token] = grant
        return grant

    async def revoke(self, grant: Grant) -> None:
        self._grants.pop(grant.token, None)
        grant._stop.set()
        if grant._task is not None:
            await grant._task

    async def shutdown(self) -> None:
        for grant in list(self._grants.values()):
            await self.revoke(grant)
        if self._server is not None:
            self._server.should_exit = True
            await self._serving
            self._server = self._serving = None

    async def _hold(self, grant: Grant, ready: asyncio.Event) -> None:
        async with grant.manager.run():
            ready.set()
            await grant._stop.wait()

    async def _ensure_server(self) -> None:
        if self._server is not None:
            return
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))  # loopback only, a port the system picks
        config = uvicorn.Config(
            self._asgi, interface="asgi3", log_level="warning", lifespan="off", access_log=False
        )
        self._server = _Server(config)
        self._url = f"http://127.0.0.1:{sock.getsockname()[1]}/mcp"
        self._serving = asyncio.create_task(self._server.serve(sockets=[sock]))
        while not self._server.started:
            if self._serving.done():
                self._serving.result()
            await asyncio.sleep(0.01)

    async def _asgi(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            return
        sent = dict(scope["headers"]).get(b"authorization", b"").decode("latin-1")
        grant = next(
            (g for t, g in self._grants.items() if hmac.compare_digest(f"Bearer {t}", sent)), None
        )
        if grant is None:
            await PlainTextResponse("unauthorized", status_code=401)(scope, receive, send)
            return
        await grant.manager.handle_request(scope, receive, send)

    def _specs(self, grant: Grant):
        """The granted apps' tools that are connected and not turned Off."""
        toolbox = self._toolbox()
        out = []
        for app_id in grant.apps:
            if app_id in self._apps.ids() and self._apps.status(app_id).state == "connected":
                out += [
                    s for s in specs_for(app_id, self._apps.tools(app_id))
                    if toolbox.mode(s) != "off"
                ]  # fmt: skip
        return out

    async def _list(self, grant: Grant) -> types.ListToolsResult:
        return types.ListToolsResult(
            tools=[
                types.Tool(name=s.name, description=s.description, input_schema=s.input_schema)
                for s in self._specs(grant)
            ]
        )

    async def _call(
        self, grant: Grant, params: types.CallToolRequestParams
    ) -> types.CallToolResult:
        def reply(text: str, is_error: bool = False) -> types.CallToolResult:
            # Masked on the way out: an app's answer may quote a secret the brain knows.
            text = mask_json(self._guards, "job_result", text)
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=text)], is_error=is_error
            )

        # A name outside the grant is simply not there, whatever app it belongs to.
        if params.name not in {s.name for s in self._specs(grant)}:
            return reply(f"No tool named {params.name}.", True)
        call = Call(uuid.uuid4().hex, params.name, params.arguments or {}, "", "")
        try:
            out = await self._toolbox().run(call, caller="expert", job_id=grant.job_id)
        except RpcError as exc:
            return reply(exc.message, True)
        except Exception:
            log.exception("expert app call failed: %s", params.name)
            return reply(f"{params.name} could not be run.", True)
        return reply(out if isinstance(out, str) else "")
