"""`tagalong memory-mcp`: the stdio MCP server another AI tool (Claude Code, Cursor, Codex) starts
and stops itself. It holds no memory: each tool call dials the brain, says hello as a client of
kind `mcp_client` with its own token, forwards the call and returns the brain's answer, so the
brain's permission engine, masking and source labels apply as they do to every other caller.

The link file `<TAGALONG_HOME>/memory-clients/<name>.json` holds the brain's address, the pinned
certificate fingerprint (null for the brain's own machine, which is reached over loopback ws)
and the client's token.
"""

import asyncio
import json
import ssl
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from brain.memory_mcp import MEMORY_SPECS, MEMORY_TOOLS
from brain.node.main import MAX_FRAME, connect_pinned
from brain.protocol import PROTOCOL, ErrorCode

NAME_PATTERN = r"^[a-z0-9-]{1,32}$"
Dial = Callable[[str, str | None], Awaitable[Any]]


@dataclass(frozen=True)
class BridgeLink:
    addr: str
    fingerprint: str | None
    token: str


class BridgeError(Exception):
    """A failure worded for the AI tool that called, or for the person at the terminal."""


async def dial(addr: str, fingerprint: str | None) -> Any:
    if fingerprint is None:
        return await connect(f"ws://{addr}", max_size=MAX_FRAME)
    return await connect_pinned(addr, fingerprint)


def link_path(home: Path, name: str) -> Path:
    return home / "memory-clients" / f"{name}.json"


def load_link(home: Path, name: str) -> BridgeLink:
    try:
        return BridgeLink(**json.loads(link_path(home, name).read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError):
        raise BridgeError(
            f"This machine is not paired as '{name}'. In Home, make a link for this AI tool, "
            f"then run: tagalong memory-mcp --pair <link> --client {name}"
        ) from None


def save_link(home: Path, name: str, link: BridgeLink) -> None:
    path = link_path(home, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(link)), encoding="utf-8")


def _frame(req_id: int, method: str, params: dict) -> str:
    return json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})


async def _reply(ws: Any, req_id: int) -> dict:
    async for raw in ws:
        message = json.loads(raw)
        if message.get("id") == req_id:
            return message
    raise ConnectionClosed(None, None)


async def call_brain(link: BridgeLink, name: str, tool: str, args: dict, connect_to: Dial) -> str:
    """One call as `name`. Raises BridgeError with words for the AI tool."""
    try:
        ws = await connect_to(link.addr, link.fingerprint)
        async with ws:
            hello = {
                "protocol": PROTOCOL,
                "token": link.token,
                "body": {"id": name, "kind": "mcp_client", "name": name, "display": False},
                "tools": [],
            }
            await ws.send(_frame(1, "hello", hello))
            if "error" in await _reply(ws, 1):
                raise BridgeError(
                    "The brain refused this AI tool; its access may have been revoked. Make a "
                    "new link in Home and pair again."
                )
            await ws.send(_frame(2, "call", {"tool": tool, "input": args}))
            answer = await _reply(ws, 2)
    except ssl.SSLError:
        raise BridgeError(
            "Scout's brain showed a certificate other than the one this tool was paired with."
        ) from None
    except (OSError, ConnectionClosed, TimeoutError) as err:
        raise BridgeError(f"Scout's brain is not reachable at {link.addr}: {err}") from None
    if "error" in answer:
        raise BridgeError(str(answer["error"].get("message", "The call failed.")))
    return "".join(part.get("text", "") for part in answer["result"]["output"])


def build_server(link: BridgeLink, name: str = "mcp", connect_to: Dial = dial) -> Server:
    tools = [
        types.Tool(
            name=external,
            description=MEMORY_SPECS[internal].description,
            input_schema=MEMORY_SPECS[internal].input_schema,
        )
        for external, internal in MEMORY_TOOLS.items()
    ]

    async def list_tools(ctx, params) -> types.ListToolsResult:
        return types.ListToolsResult(tools=tools)

    async def call_tool(ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
        try:
            text = await call_brain(link, name, params.name, params.arguments or {}, connect_to)
            failed = False
        except BridgeError as err:
            text, failed = str(err), True
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=text)], is_error=failed
        )

    return Server("tagalong-memory", on_list_tools=list_tools, on_call_tool=call_tool)


async def serve(home: Path, name: str) -> None:
    server = build_server(load_link(home, name), name)
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


async def pair_with_link(home: Path, name: str, link: str, connect_to: Dial = dial) -> None:
    """Redeem a link made in Home and save what the bridge needs. The code is spent here."""
    query = parse_qs(urlsplit(link).query)
    try:
        addr, fingerprint, code = (query[key][0] for key in ("addr", "fp", "code"))
    except (KeyError, IndexError):
        raise BridgeError("That is not a pairing link made in Home.") from None
    try:
        ws = await connect_to(addr, fingerprint)
        async with ws:
            params = {"code": code, "device": {"name": name, "kind": "mcp_client"}}
            await ws.send(_frame(1, "pair", params))
            answer = await asyncio.wait_for(_reply(ws, 1), 10)
    except ssl.SSLError:
        raise BridgeError(
            "Scout's brain showed a certificate other than the one in the link."
        ) from None
    except (OSError, ConnectionClosed, TimeoutError) as err:
        raise BridgeError(f"Could not reach the brain at {addr}: {err}") from None
    if "error" in answer:
        if answer["error"].get("code") == ErrorCode.unauthorized:
            raise BridgeError("That link did not work: it may be used up or expired.")
        raise BridgeError(str(answer["error"].get("message", "Pairing failed.")))
    save_link(home, name, BridgeLink(addr, fingerprint, answer["result"]["token"]))
