"""The bridge that lets an expert reach chosen connected apps through the brain.

One MCP server on 127.0.0.1 (random port); each job part gets its own bearer token and sees only
the apps it was granted. Every call runs through `Toolbox.run(caller="expert")`, so asks,
preferences and the approvals log apply, and the answer is masked before it leaves. The app's
own sign-in and secrets stay here: the expert holds only a token that dies with its job part.
"""

import asyncio
import hmac
import json
import logging
import secrets
import uuid
from collections.abc import Callable, Sequence
from contextlib import AsyncExitStack
from dataclasses import dataclass, field

from acp.schema import HttpHeader, HttpMcpServer
from mcp import types
from mcp.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.responses import PlainTextResponse

from brain.app_tools import specs_for
from brain.auth import Principal
from brain.guards import Guards
from brain.loopback import serve_loopback
from brain.masking import mask_json
from brain.memory_mcp import MEMORY_TOOLS, call_memory_tool, list_memory_tools
from brain.mind.turn import Call
from brain.protocol import RpcError
from brain.toolbox import Toolbox

log = logging.getLogger("brain")

# What an expert's own memory writes are labelled with; it never reads the personal facts.
EXPERT_CLIENT = Principal(key="expert", name="expert", kind="expert", local=False)


@dataclass
class Grant:
    """One job part's access: a token, the apps it may reach, and the descriptor for ACP."""

    job_id: str
    apps: tuple[str, ...]
    token: str
    descriptor: HttpMcpServer
    manager: StreamableHTTPSessionManager | None = None
    # Set when the person sends the hand-off card; until then the token lists but never calls.
    sent: bool = False
    _stop: asyncio.Event = field(default_factory=asyncio.Event)
    _task: asyncio.Task | None = None


class ExpertApps:
    def __init__(self, apps, toolbox: Callable[[], Toolbox], guards: Guards) -> None:
        self._apps = apps
        self._toolbox = toolbox
        self._guards = guards
        self._grants: dict[str, Grant] = {}  # token -> grant
        self._stack = AsyncExitStack()
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
        await self._stack.aclose()
        self._url = ""

    async def _hold(self, grant: Grant, ready: asyncio.Event) -> None:
        async with grant.manager.run():
            ready.set()
            await grant._stop.wait()

    async def _ensure_server(self) -> None:
        if self._url:
            return
        port = await self._stack.enter_async_context(serve_loopback(self._asgi))
        self._url = f"http://127.0.0.1:{port}/mcp"

    async def _asgi(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            return
        # Bytes, so a non-ASCII header is just a mismatch (str would raise TypeError).
        sent = dict(scope["headers"]).get(b"authorization", b"")
        grant = next(
            (
                g
                for t, g in self._grants.items()
                if hmac.compare_digest(f"Bearer {t}".encode(), sent)
            ),
            None,
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
            + list_memory_tools(self._toolbox())
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

        if not grant.sent:
            return reply("Not available yet: the person has not sent this job.", True)
        args = params.arguments or {}
        if params.name in MEMORY_TOOLS:
            return await call_memory_tool(
                self._toolbox(),
                self._guards,
                EXPERT_CLIENT,
                params.name,
                args,
                f"expert job {grant.job_id}",
                grant.job_id,
            )
        # A name outside the grant is simply not there, whatever app it belongs to.
        if params.name not in {s.name for s in self._specs(grant)}:
            return reply(f"No tool named {params.name}.", True)
        # The ask's text is plain data (tool, input, job), so the person can see who wants what.
        text = f"{params.name} {json.dumps(args, sort_keys=True, separators=(',', ':'))}"
        call = Call(uuid.uuid4().hex, params.name, args, "", f"{text} (expert job {grant.job_id})")
        try:
            out = await self._toolbox().run(call, caller="expert", job_id=grant.job_id)
        except RpcError as exc:
            return reply(exc.message, True)
        except Exception:
            log.exception("expert app call failed: %s", params.name)
            return reply(f"{params.name} could not be run.", True)
        return reply(out if isinstance(out, str) else "")
