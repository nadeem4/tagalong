"""A tiny stdio MCP server for the Apps tests; it also serves over http with `--http PORT`.

Tools cover the cases the manager must handle: a plain one, read-only and destructive hints,
a slow call, an oversized result, and one that adds a tool and fires list-changed. Argv modes
`hang` (never answers) and `exit` (dies at once) fake broken servers. FAKE_PIDFILE gets its pid
so tests can prove the process is gone.
"""

import asyncio
import os
import sys
import time

from mcp.server.mcpserver import Context, MCPServer
from mcp.types import ToolAnnotations

server = MCPServer("fake")


@server.tool()
def echo(text: str) -> str:
    return text


@server.tool(annotations=ToolAnnotations(read_only_hint=True))
def read_note() -> str:
    return "a note"


@server.tool(annotations=ToolAnnotations(destructive_hint=True))
def delete_note() -> str:
    return "deleted"


@server.tool()
async def slow() -> str:
    await asyncio.sleep(30)
    return "late"


@server.tool()
def big() -> str:
    return "x" * 20000


@server.tool()
async def add_tool(ctx: Context) -> str:
    def extra() -> str:
        return "extra"

    server.add_tool(extra)
    # The classic notification servers send; notify_tools_changed only feeds listen subscribers.
    await ctx.session.send_tool_list_changed()
    return "added"


def main() -> None:
    pidfile = os.environ.get("FAKE_PIDFILE")
    if pidfile:
        with open(pidfile, "w") as f:
            f.write(str(os.getpid()))
    args = sys.argv[1:]
    if args[:1] == ["exit"]:
        sys.exit(3)
    if args[:1] == ["hang"]:
        time.sleep(3600)
    if args[:1] == ["--http"]:
        asyncio.run(server.run_streamable_http_async(port=int(args[1])))
    else:
        server.run("stdio")


if __name__ == "__main__":
    main()
