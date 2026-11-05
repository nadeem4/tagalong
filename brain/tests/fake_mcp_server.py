"""A tiny stdio MCP server for the Apps tests; it also serves over http with `--http PORT`.

Tools cover the cases the manager must handle: a plain one, read-only and destructive hints,
a slow call, an oversized result, and one that adds a tool and fires list-changed. Argv modes
`hang` (never answers) and `exit` (dies at once) fake broken servers. FAKE_PIDFILE gets its pid
so tests can prove the process is gone.

Gmail-shaped tools (`search_threads`, `get_thread`, `create_draft`, and a `send_message` that the
loops tests prove is never called) read the mailbox JSON at FAKE_MAIL_FILE on every call:
`{"threads": [{"id", "messages": [{"id", "from", "subject", "date", "body", "labels"}]}]}`.
"""

import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime

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


def _mailbox() -> list[dict]:
    path = os.environ.get("FAKE_MAIL_FILE")
    if not path:
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)["threads"]


def _add_mail_tools() -> None:
    """Only with FAKE_MAIL_FILE set, so the other tests still see the same six tools."""

    @server.tool(annotations=ToolAnnotations(read_only_hint=True))
    def search_threads(query: str, page_size: int = 50, page_token: str = "") -> dict:
        """Threads with a message in `in:sent` or `in:inbox` after `after:<epoch>`."""
        label = "SENT" if "in:sent" in query else "INBOX"
        found = re.search(r"after:(\d+)", query)
        after = int(found.group(1)) if found else 0
        ids = [
            {"id": t["id"]}
            for t in _mailbox()
            if any(
                label in m.get("labels", [])
                and datetime.fromisoformat(m["date"]).timestamp() >= after
                for m in t["messages"]
            )
        ]
        start = int(page_token or 0)
        out: dict = {"threads": ids[start : start + page_size]}
        if start + page_size < len(ids):
            out["next_page_token"] = str(start + page_size)
        return out

    @server.tool(annotations=ToolAnnotations(read_only_hint=True))
    def get_thread(thread_id: str) -> dict:
        for t in _mailbox():
            if t["id"] == thread_id:
                return t
        return {"id": thread_id, "messages": []}

    @server.tool()
    def create_draft(thread_id: str, body: str) -> dict:
        return {"draft_id": f"draft-{thread_id}"}

    @server.tool()
    def send_message(thread_id: str, body: str) -> str:
        return "sent"


if os.environ.get("FAKE_MAIL_FILE"):
    _add_mail_tools()


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
