"""Scout's memory for other AI tools: an MCP server on loopback at /mcp/memory.

A client the owner made in Home holds a bearer token (a `devices` row of kind `mcp_client`, only
its hash kept; revoking it ends the next call). Its three tools are toolbox tools of audience
mcp and expert, so every call passes the gate as caller `mcp:<client>` and its answer is masked.
There is no forget: another tool never deletes what Scout remembers. What a client writes is
labelled with its name, and chat, summaries and (without the switch) personal facts never leave.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Callable
from contextlib import AsyncExitStack
from contextvars import ContextVar

from mcp import types
from mcp.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from starlette.responses import PlainTextResponse

from brain.devices import Devices, McpClient
from brain.guards import Guards
from brain.loopback import serve_loopback
from brain.masking import mask_json
from brain.memory import Memory
from brain.mind.turn import Call
from brain.permission import Tier
from brain.protocol import RpcError
from brain.store.memory import OUTSIDE, MemoryFull, MemoryRefused
from brain.toolbox import Handler, Toolbox, ToolSpec
from brain.tools import Notify, format_hits

log = logging.getLogger("brain")

PATH = "/mcp/memory"
LIST_MAX = 200
# What the client calls each tool, and the toolbox name behind it (Scout has its own `recall`).
MEMORY_TOOLS = {
    "recall": "memory_recall",
    "remember": "memory_remember",
    "list_memories": "memory_list",
}
_AUDIENCE = frozenset({"mcp", "expert"})

# Who is calling, for the handler: the toolbox passes a tool's arguments and nothing else.
CLIENT: ContextVar[McpClient | None] = ContextVar("memory_client", default=None)


def memory_client_tools(memory: Memory, notify: Notify) -> list[tuple[ToolSpec, Handler]]:
    def client() -> McpClient:
        who = CLIENT.get()
        assert who is not None
        return who

    async def recall(args: dict) -> str:
        query = args.get("query")
        if not isinstance(query, str) or not query.strip():
            raise MemoryRefused("recall needs a query.")
        hits = memory.search(query, include_personal=client().personal, facts_only=True)
        return format_hits(hits) if hits else "No matching memories."

    async def remember(args: dict) -> str:
        text = args.get("text")
        if not isinstance(text, str):
            raise MemoryRefused("remember needs text.")
        try:
            item = memory.remember(
                "about_you", text, tag=args.get("tag") or "", source=f"{OUTSIDE}{client().name}"
            )
        except MemoryFull:
            raise MemoryRefused(
                "Scout's memory about the owner is full. The owner can make room in Home."
            ) from None
        notify("changed", {"what": "memory"})
        return f"saved #{item.id}"

    async def list_memories(args: dict) -> str:
        items = memory.list_items(LIST_MAX, include_personal=client().personal, facts_only=True)
        return json.dumps(
            {
                "memories": [
                    {
                        "id": i.id,
                        "kind": i.kind,
                        "text": i.text,
                        "at": i.updated_at,
                        "source": i.source,
                    }
                    for i in items
                ]
            }
        )

    return [
        (
            ToolSpec(
                "memory_recall",
                "Search what Scout remembers about the owner. Returns matching memories.",
                {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
                _AUDIENCE,
                effect="read",
            ),
            recall,
        ),
        (
            ToolSpec(
                "memory_remember",
                "Save a short note about the owner for Scout to keep. It is shown to Scout as "
                "told by you, not as the owner's own words.",
                {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "tag": {
                            "type": "string",
                            "description": "Topic of the note, e.g. work or skills.",
                        },
                    },
                    "required": ["text"],
                },
                _AUDIENCE,
                tier=Tier.locked,  # the text is an outside tool's, so only the owner may allow it
            ),
            remember,
        ),
        (
            ToolSpec(
                "memory_list",
                "List Scout's memories, newest first.",
                {"type": "object", "properties": {}},
                _AUDIENCE,
                effect="read",
            ),
            list_memories,
        ),
    ]


def list_memory_tools(toolbox: Toolbox) -> list[types.Tool]:
    """The memory tools a client may call now: those not turned Off."""
    live = {s.name: s for s in toolbox.active_specs() if s.name in MEMORY_TOOLS.values()}
    return [
        types.Tool(
            name=external,
            description=live[internal].description,
            input_schema=live[internal].input_schema,
        )
        for external, internal in MEMORY_TOOLS.items()
        if internal in live
    ]


async def call_memory_tool(
    toolbox: Toolbox,
    guards: Guards,
    client: McpClient,
    name: str,
    args: dict,
    by: str,
    job_id: str | None = None,
) -> types.CallToolResult:
    """One client call through the toolbox gate as `mcp:<client>`; `by` says who asks, for the
    Allow card. A tool turned Off is refused by the gate itself."""

    def reply(text: str, is_error: bool = False) -> types.CallToolResult:
        text = mask_json(guards, "job_result", text)  # a memory may quote a secret the brain knows
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=text)], is_error=is_error
        )

    internal = MEMORY_TOOLS.get(name)
    if internal is None:
        return reply(f"No tool named {name}.", True)
    text = f"{name} {json.dumps(args, sort_keys=True, separators=(',', ':'))} ({by})"
    call = Call(uuid.uuid4().hex, internal, args, "", text)
    token = CLIENT.set(client)
    try:
        out = await toolbox.run(call, caller=f"mcp:{client.name}", job_id=job_id)
    except (RpcError, MemoryRefused) as exc:
        return reply(exc.message if isinstance(exc, RpcError) else str(exc), True)
    except Exception:
        log.exception("memory call failed: %s", name)
        return reply(f"{name} could not be run.", True)
    finally:
        CLIENT.reset(token)
    return reply(out if isinstance(out, str) else "")


class MemoryMcp:
    def __init__(
        self, devices: Devices, toolbox: Callable[[], Toolbox], guards: Guards, port: int
    ) -> None:
        self._devices = devices
        self._toolbox = toolbox
        self._guards = guards
        self._port = port
        self._stack = AsyncExitStack()
        self._stop = asyncio.Event()
        self._holding: asyncio.Task | None = None
        self.url = ""
        self._manager = StreamableHTTPSessionManager(
            Server(
                "tagalong-memory",
                on_list_tools=lambda ctx, params: self._list(),
                on_call_tool=lambda ctx, params: self._call(
                    ctx.request.scope["memory_client"], params
                ),
            ),
            json_response=True,
            stateless=True,
            # Keeps a web page from reaching this port through the owner's browser (DNS rebinding).
            security_settings=TransportSecuritySettings(
                allowed_hosts=["127.0.0.1:*", "localhost:*"],
                allowed_origins=["http://127.0.0.1:*", "http://localhost:*"],
            ),
        )

    async def start(self) -> None:
        """Raises OSError when the port is taken; the brain then runs without this endpoint."""
        ready = asyncio.Event()
        # The manager's task group must start and end in one task, so a task owns it.
        self._holding = asyncio.create_task(self._hold(ready))
        await ready.wait()
        try:
            port = await self._stack.enter_async_context(serve_loopback(self._asgi, self._port))
        except OSError:
            await self.stop()
            raise
        self.url = f"http://127.0.0.1:{port}{PATH}"

    async def stop(self) -> None:
        await self._stack.aclose()
        self._stop.set()
        if self._holding is not None:
            await self._holding

    async def _hold(self, ready: asyncio.Event) -> None:
        async with self._manager.run():
            ready.set()
            await self._stop.wait()

    async def _asgi(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            return
        sent = dict(scope["headers"]).get(b"authorization", b"")
        token = sent[7:].decode("utf-8", "replace") if sent.startswith(b"Bearer ") else ""
        if scope["path"] != PATH:
            await PlainTextResponse("not found", 404)(scope, receive, send)
            return
        client = self._devices.client(token) if token else None
        if client is None:
            await PlainTextResponse("unauthorized", 401)(scope, receive, send)
            return
        scope["memory_client"] = client
        await self._manager.handle_request(scope, receive, send)

    async def _list(self) -> types.ListToolsResult:
        return types.ListToolsResult(tools=list_memory_tools(self._toolbox()))

    async def _call(
        self, client: McpClient, params: types.CallToolRequestParams
    ) -> types.CallToolResult:
        return await call_memory_tool(
            self._toolbox(),
            self._guards,
            client,
            params.name,
            params.arguments or {},
            f"memory client {client.name}",
        )
