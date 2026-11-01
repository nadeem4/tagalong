"""Scout's setup tools: look at the machine and the registries before suggesting a fix.

All read-only and automatic. They return facts as JSON; Scout decides what to say.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from pathlib import Path
from typing import TYPE_CHECKING

from brain.setup.facts import Machine
from brain.toolbox import Handler, ToolSpec

if TYPE_CHECKING:
    from brain.setup.registry import Registry

InspectFn = Callable[[], Awaitable[Machine]]


def setup_tools(
    home: Path, registry: "Registry | None", inspect_fn: InspectFn
) -> list[tuple[ToolSpec, Handler]]:
    async def inspect_machine(args: dict) -> str:
        # `experts` is filled once installed experts are recorded (20e, 21a).
        return json.dumps({"machine": asdict(await inspect_fn()), "experts": []})

    empty = {"type": "object", "properties": {}}
    return [
        (
            ToolSpec(
                "inspect_machine",
                "What this computer has: OS, CPU, Node, npm, git and Claude Code, and "
                "Tagalong's own Node. Read-only.",
                empty,
                effect="read",
                default_mode="auto",
            ),
            inspect_machine,
        )
    ]
