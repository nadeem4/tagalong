"""Home's events_waiting tool: news Scout has not told yet, and any event it gave up on.

Home-only (the model never sees it). A row is facts for the Waiting list: what and when. The
`gist` is the payload's first fact value, cut short; code never words it as prose.
"""

import json
import sqlite3
from collections.abc import Callable
from datetime import datetime

from brain.events import EVENT_KINDS
from brain.store import events as store
from brain.toolbox import Handler, ToolSpec

_GIST_MAX = 60
_NEWS = [name for name, kind in EVENT_KINDS.items() if kind.wakes]  # not say, card_answer


def _gist(payload: dict) -> str:
    first = next(iter(payload.values()), None)
    if first is None:
        return ""
    text = first if isinstance(first, str) else json.dumps(first)
    line = text.strip().split("\n")[0]
    return line if len(line) <= _GIST_MAX else line[: _GIST_MAX - 3] + "..."


def events_tools(
    db: sqlite3.Connection, now: Callable[[], datetime]
) -> list[tuple[ToolSpec, Handler]]:
    async def waiting(_args: dict) -> str:
        at = now()
        rows = [
            {
                "id": e.id,
                "kind": e.kind,
                "source": e.source,
                "at": e.at,
                "age_s": int((at - datetime.fromisoformat(e.at)).total_seconds()),
                "gave_up": e.state == "gave_up",
                "gist": _gist(e.payload),
            }
            for e in store.list_waiting(db, _NEWS)
        ]
        return json.dumps({"waiting": rows})

    spec = ToolSpec(
        "events_waiting",
        "News waiting to be told, and news Scout gave up on, oldest first.",
        {"type": "object", "properties": {}},
        frozenset({"home"}),
        effect="read",
    )
    return [(spec, waiting)]
