"""Home's tasks_list tool: every task that is not an Ask, with where it came from.

Home-only (the model never sees it). A row is facts for the Tasks page: kind, state, source and
the chain of events that led to it (`caused_by`, walked back to a depth cap); code never words it.
"""

import json

from brain.events import EventLog
from brain.tasks import Tasks
from brain.toolbox import Handler, ToolSpec

CHAIN_DEPTH = 5


def tasks_tools(tasks: Tasks, events: EventLog) -> list[tuple[ToolSpec, Handler]]:
    def chain(event_id: str | None) -> list[dict]:
        """The event that caused the task, then the one that caused that, oldest cause last."""
        links = []
        while event_id is not None and len(links) < CHAIN_DEPTH:
            row = events.get(event_id)
            if row is None:  # swept: the chain ends here
                break
            links.append({"kind": row.kind, "source": row.source})
            event_id = row.caused_by
        return links

    async def tasks_list(args: dict) -> str:
        rows = [
            {
                "id": t.id,
                "kind": t.kind,
                "state": t.state,
                "title": t.title,
                "source": t.source,
                "caused_by": t.caused_by,
                "chain": chain(t.caused_by),
                "created_at": t.created_at,
                "ended_at": t.ended_at,
            }
            for t in tasks.list_all(include_ended=args.get("include_ended") is True)
        ]
        return json.dumps({"tasks": rows})

    spec = ToolSpec(
        "tasks_list",
        "Every task that is not an Ask, newest first, with its source and what caused it. Ended"
        " tasks only when include_ended is true.",
        {"type": "object", "properties": {"include_ended": {"type": "boolean"}}},
        frozenset({"home"}),
        effect="read",
    )
    return [(spec, tasks_list)]
