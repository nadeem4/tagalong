"""One toolbox for every tool the model or Home may call, built from sources.

A Source owns a set of tools (the brain's own, or a body's). The toolbox lists what Scout may
see, and gates each call: unknown name, wrong caller, or a source that cannot serve it now.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from brain.mind.turn import Call
from brain.protocol import ErrorCode, RpcError

log = logging.getLogger("brain")

NAME_MAX = 64  # the model API rejects longer tool names

Handler = Callable[[dict], Awaitable[str]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict
    audience: frozenset[str] = frozenset({"scout"})  # the design's `for`; a Python keyword


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


class Toolbox:
    def __init__(self, sources: list[Source]) -> None:
        self.sources = sources  # brain source first; later tasks append body sources

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
