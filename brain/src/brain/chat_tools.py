"""Home's chat_since tool: the saved chat after an id, so a body that was away can catch up.

Home-only (the model never sees it). Text was masked when saved; the tool reads only that.
"""

import json
import sqlite3

from brain.store import conversation
from brain.toolbox import Handler, ToolSpec

_DEFAULT, _MAX = 20, 50


def chat_tools(db: sqlite3.Connection) -> list[tuple[ToolSpec, Handler]]:
    async def chat_since(args: dict) -> str:
        limit = min(max(int(args.get("limit") or _DEFAULT), 1), _MAX)
        raw = args.get("after_id")
        after = int(raw) if isinstance(raw, str) and raw.isdigit() else None
        rows, more = conversation.since(db, after, limit)
        messages = [
            {"id": str(r.id), "role": r.role, "text": r.text, "source": r.source, "at": r.at}
            for r in rows
        ]
        return json.dumps({"messages": messages, "more": more})

    spec = ToolSpec(
        "chat_since",
        "Saved chat messages after an id (the last few when none), oldest first.",
        {
            "type": "object",
            "properties": {"after_id": {"type": "string"}, "limit": {"type": "integer"}},
        },
        frozenset({"home"}),
        effect="read",
    )
    return [(spec, chat_since)]
