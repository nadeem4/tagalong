"""Maps a connected app's MCP tools to toolbox specs.

Names become `app__tool` (safe characters, short enough for the model API). Permissions come
from the tool's hints, but a risky word in the name always locks it, since hints are the
app's own claim and cannot be trusted to lower the bar.
"""

import logging
import re
from typing import Literal

from mcp.types import Tool

from brain.toolbox import NAME_MAX, SEP, ToolSpec

log = logging.getLogger("brain")

# Whole words that mean money or data leaves or is lost; these always ask.
RISKY = frozenset({"send", "delete", "remove", "destroy", "trash", "pay", "charge"})


def _words(name: str) -> list[str]:
    """Split on `_ - . space` and camelCase, lowercased."""
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    return [w.lower() for w in re.split(r"[_\-. ]+", spaced) if w]


def classify(tool: Tool) -> tuple[Literal["read", "change"], bool]:
    """Return (effect, locked). No annotations means a change; risk wins over hints."""
    hints = tool.annotations
    locked = bool(hints and hints.destructive_hint) or bool(RISKY & set(_words(tool.name)))
    read = bool(hints and hints.read_only_hint) and not locked
    return ("read" if read else "change"), locked


def _tool_part(name: str, app_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)[: NAME_MAX - len(app_id) - len(SEP)]


def spec_for(app_id: str, tool: Tool) -> ToolSpec | None:
    """One MCP tool as a scout-only spec; None when it has no usable name."""
    part = _tool_part(tool.name, app_id)
    if not part:
        return None
    effect, locked = classify(tool)
    return ToolSpec(
        f"{app_id}{SEP}{part}",
        tool.description or "",
        tool.input_schema,
        effect=effect,
        locked=locked,
    )


def specs_for(app_id: str, tools: list[Tool]) -> list[ToolSpec]:
    """All of an app's specs; when two names collide the first wins and the rest are logged."""
    out: dict[str, ToolSpec] = {}
    for tool in tools:
        spec = spec_for(app_id, tool)
        if spec is None:
            log.warning("app tool has no usable name, dropped: %s/%r", app_id, tool.name)
        elif spec.name in out:
            log.warning("app tool name clash, dropped: %s (from %r)", spec.name, tool.name)
        else:
            out[spec.name] = spec
    return list(out.values())
