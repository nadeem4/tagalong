"""Maps a connected app's MCP tools to toolbox specs, and runs them as a toolbox source.

Names become `app__tool` (safe characters, short enough for the model API). Permissions come
from the tool's hints, but a risky word in the name always locks it, since hints are the
app's own claim and cannot be trusted to lower the bar. Results come back fenced as data.
"""

import json
import logging
import re
from typing import Literal

from mcp.types import (
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    ResourceLink,
    TextContent,
    TextResourceContents,
    Tool,
)

from brain.apps import AppError, Apps
from brain.mind.turn import Call
from brain.protocol import ErrorCode, RpcError
from brain.toolbox import NAME_MAX, SEP, ToolSpec
from brain.tools import _fence_safe

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


RESULT_MAX = 8000  # characters of an app's answer that reach the model


def _first_line(text: str) -> str:
    lines = text.strip().splitlines()
    return lines[0] if lines else "no reason given"


def _block_text(block: object) -> str:
    if isinstance(block, TextContent):
        return block.text
    if isinstance(block, ResourceLink):
        return f"{block.name} {block.uri}"
    if isinstance(block, ImageContent):
        return f"[image: {block.mime_type}]"
    if isinstance(block, EmbeddedResource):
        res = block.resource
        return res.text if isinstance(res, TextResourceContents) else f"[resource: {res.uri}]"
    return ""


def result_text(result: CallToolResult) -> str:
    parts = [t for t in (_block_text(b) for b in result.content) if t]
    if parts:
        return "\n".join(parts)
    if result.structured_content is not None:
        return json.dumps(result.structured_content)
    return ""


def format_result(app_id: str, result: CallToolResult) -> str:
    """An app's answer as capped, fenced data the model reads but never obeys."""
    body = result_text(result)
    if len(body) > RESULT_MAX:
        body = body[: RESULT_MAX - 1] + "\u2026"
    return f'<data kind="app" app="{app_id}">\n{_fence_safe(body)}\n</data>'


class AppSource:
    """Connected apps' tools as a toolbox source; modes reuse the permissions table."""

    def __init__(self, apps: Apps) -> None:
        self._apps = apps

    def specs(self) -> list[ToolSpec]:
        return [
            spec
            for app_id in self._apps.ids()
            if self._apps.status(app_id).state == "connected"
            for spec in specs_for(app_id, self._apps.tools(app_id))
        ]

    def known_specs(self) -> list[ToolSpec]:
        return [
            spec
            for app_id in self._apps.ids()
            for spec in specs_for(app_id, self._apps.tools(app_id))
        ]

    async def run(self, call: Call, tool: str) -> str | list[dict]:
        app_id, _, part = tool.partition(SEP)
        name = self._apps.name(app_id)
        real = next(
            (t.name for t in self._apps.tools(app_id) if _tool_part(t.name, app_id) == part), None
        )
        if real is None:
            raise RpcError(ErrorCode.unknown_tool, f"No tool named {tool}.")
        try:
            result = await self._apps.call(app_id, real, call.input)
        except AppError as exc:
            raise RpcError(ErrorCode.tool_failed, str(exc)) from None
        if result.is_error:
            reason = _first_line(result_text(result))
            raise RpcError(ErrorCode.tool_failed, f"{name} could not do that: {reason}")
        return format_result(app_id, result)

    def unavailable(self, name: str) -> RpcError | None:
        app_id, sep, _ = name.partition(SEP)
        if sep and app_id in self._apps.ids() and self._apps.status(app_id).state != "connected":
            return RpcError(
                ErrorCode.body_offline, f"{self._apps.name(app_id)} is not connected right now."
            )
        return None
