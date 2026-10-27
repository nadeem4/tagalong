"""One toolbox for every tool the model or Home may call, built from sources.

A Source owns a set of tools (the brain's own, or a body's). The toolbox lists what Scout may
see, and gates each call: unknown name, wrong caller, or a source that cannot serve it now.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import ValidationError

from brain.bodies import Bodies
from brain.mind.prompt import part_blocks
from brain.mind.turn import Call
from brain.protocol import LIMITS, CallResult, ErrorCode, RpcError

log = logging.getLogger("brain")

NAME_MAX = 64  # the model API rejects longer tool names

Handler = Callable[[dict], Awaitable[str]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict
    audience: frozenset[str] = frozenset({"scout"})  # the design's `for`; a Python keyword
    effect: Literal["read", "change"] = "change"  # unknown effect is treated as a change
    default_mode: Literal["ask", "auto"] | None = None  # beats the effect-based default
    locked: bool = False  # always asks; the person cannot turn this to auto


class Source(Protocol):
    def specs(self) -> list[ToolSpec]: ...

    async def run(self, call: Call, tool: str) -> str | list[dict]: ...

    def unavailable(self, name: str) -> RpcError | None:
        """Set when this source owns the name but cannot serve it now."""
        ...


class BrainSource:
    def __init__(self, tools: list[tuple[ToolSpec, Handler]]) -> None:
        self._tools = {spec.name: (spec, handler) for spec, handler in tools}

    def specs(self) -> list[ToolSpec]:
        return [spec for spec, _ in self._tools.values()]

    async def run(self, call: Call, tool: str) -> str | list[dict]:
        return await self._tools[tool][1](call.input)

    def unavailable(self, name: str) -> RpcError | None:
        return None


SEP = "__"  # joins body id and tool name; bodies may not use it in tool names


class BodySource:
    """Each online body's declared tools, offered as `body__tool` and run through Bodies.use."""

    def __init__(self, bodies: Bodies) -> None:
        self._bodies = bodies

    def specs(self) -> list[ToolSpec]:
        out = []
        for body in sorted(self._bodies.online(), key=lambda b: b.id):
            for tool in self._bodies.tools(body.id):
                out.append(
                    ToolSpec(
                        f"{body.id}{SEP}{tool.name}",
                        tool.description,
                        tool.input_schema,
                        effect=tool.effect or "change",
                        locked=tool.confirm is True,
                    )
                )
        return out

    async def run(self, call: Call, tool: str) -> str | list[dict]:
        body_id, _, plain = tool.partition(SEP)
        raw = await self._bodies.use(body_id, call.id, plain, call.input)
        try:
            parts = CallResult.model_validate({"output": raw}).output
        except ValidationError:
            raise RpcError(ErrorCode.tool_failed, "body sent a bad result") from None
        total = 0
        for part in parts:
            size = len(part.data) * 3 // 4 if hasattr(part, "data") else 0
            total += size
            if size > LIMITS["part_bytes"] or total > LIMITS["message_bytes"]:
                raise RpcError(ErrorCode.over_limit, f"{plain} sent more data than allowed.")
        return part_blocks(parts)

    def unavailable(self, name: str) -> RpcError | None:
        body_id, sep, _ = name.partition(SEP)
        if sep and not self._bodies.is_online(body_id):
            return RpcError(ErrorCode.body_offline, f"{body_id} is not connected right now.")
        return None


class Toolbox:
    def __init__(
        self,
        sources: list[Source],
        modes: Callable[[], dict[str, str]],
        save_mode: Callable[[str, str], None],
    ) -> None:
        self.sources = sources  # brain source first; later tasks append body sources
        self._modes = modes  # stored per-tool choices, read on every call
        self._save_mode = save_mode

    def mode(self, spec: ToolSpec) -> Literal["ask", "auto"]:
        if spec.locked:
            return "ask"
        stored = self._modes().get(spec.name)
        if stored in ("ask", "auto"):
            return stored
        if spec.default_mode is not None:
            return spec.default_mode
        return "auto" if spec.effect == "read" else "ask"

    def set_mode(self, name: str, mode: str) -> None:
        spec = next((s for src in self.sources for s in src.specs() if s.name == name), None)
        if spec is None:
            raise RpcError(ErrorCode.unknown_tool, f"No tool named {name}.")
        if mode not in ("ask", "auto"):
            raise RpcError(ErrorCode.invalid_params, "mode must be ask or auto.")
        if spec.locked and mode == "auto":
            raise RpcError(ErrorCode.invalid_params, f"{name} always asks first.")
        self._save_mode(name, mode)

    def model_tools(self) -> list[dict]:
        out = []
        for source in self.sources:
            for spec in sorted(source.specs(), key=lambda s: s.name):
                if "scout" not in spec.audience:
                    continue
                if len(spec.name) > NAME_MAX:
                    log.warning("tool name too long, dropped: %s", spec.name)
                    continue
                out.append(
                    {
                        "name": spec.name,
                        "description": spec.description,
                        "input_schema": spec.input_schema,
                    }
                )
        return out

    async def run(self, call: Call, caller: str = "scout") -> str | list[dict]:
        for source in self.sources:
            for spec in source.specs():
                if spec.name == call.name:
                    if caller not in spec.audience:
                        raise RpcError(ErrorCode.unknown_tool, f"No tool named {call.name}.")
                    return await source.run(call, call.name)
        for source in self.sources:
            error = source.unavailable(call.name)
            if error is not None:
                raise error
        raise RpcError(ErrorCode.unknown_tool, f"No tool named {call.name}.")
