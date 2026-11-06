"""Home's reading_status tool: how Scout reads the screen, from the body's last report."""

import json

from brain.reading import ReadingStore
from brain.toolbox import Handler, ToolSpec


def reading_home_tools(store: ReadingStore) -> list[tuple[ToolSpec, Handler]]:
    async def reading_status(args: dict) -> str:
        return json.dumps({"rows": store.rows()})

    return [
        (
            ToolSpec(
                "reading_status",
                "How Scout reads the screen on this PC: one row per way, with its state.",
                {"type": "object", "properties": {}},
                frozenset({"home"}),
                effect="read",
            ),
            reading_status,
        )
    ]
