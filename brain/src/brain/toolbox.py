"""One toolbox for every tool the model or Home may call, built from sources.

A Source owns a set of tools (the brain's own, or a body's). The toolbox lists what Scout may
see, and gates each call: unknown name, wrong caller, or a source that cannot serve it now.
A tool_call guard then decides: an ask-mode tool waits for a person's allow (gate step 3);
Home calls skip that step.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import ValidationError

from brain.approvals import Approvals
from brain.asks import Asks
from brain.bodies import Bodies
from brain.builtin_guards import (
    anyone_online,
    person_ask,
    resolve_mode,
    side_check_guard,
    tool_mode,
)
from brain.guards import AskCtx, Guards, Hook, ToolCallCtx
from brain.mind.prompt import part_blocks
from brain.mind.turn import Call
from brain.offers import Offers
from brain.protocol import LIMITS, CallResult, ErrorCode, RpcError, Tool
from brain.side_check import SideCheck

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
    self_asks: bool = False  # runs its own ask with the user, so the gate adds none


class Source(Protocol):
    def specs(self) -> list[ToolSpec]: ...

    def known_specs(self) -> list[ToolSpec]:
        """`specs` plus tools that cannot be served now (an offline body's last declared)."""
        ...

    async def run(self, call: Call, tool: str) -> str | list[dict]: ...

    def unavailable(self, name: str) -> RpcError | None:
        """Set when this source owns the name but cannot serve it now."""
        ...


class BrainSource:
    approval_source = "scout_tool"  # how the approvals log names this source

    def __init__(self, tools: list[tuple[ToolSpec, Handler]]) -> None:
        self._tools = {spec.name: (spec, handler) for spec, handler in tools}

    def specs(self) -> list[ToolSpec]:
        return [spec for spec, _ in self._tools.values()]

    def known_specs(self) -> list[ToolSpec]:
        return self.specs()

    async def run(self, call: Call, tool: str) -> str | list[dict]:
        return await self._tools[tool][1](call.input)

    def unavailable(self, name: str) -> RpcError | None:
        return None


SEP = "__"  # joins body id and tool name; bodies may not use it in tool names


class BodySource:
    """Each online body's declared tools, offered as `body__tool` and run through Bodies.use."""

    approval_source = "scout_tool"

    def __init__(self, bodies: Bodies) -> None:
        self._bodies = bodies

    def specs(self) -> list[ToolSpec]:
        return self._specs_of({b.id: self._bodies.tools(b.id) for b in self._bodies.online()})

    def known_specs(self) -> list[ToolSpec]:
        return self._specs_of(self._bodies.known_tools())

    @staticmethod
    def _specs_of(tools_by_body: dict[str, list[Tool]]) -> list[ToolSpec]:
        return [
            ToolSpec(
                f"{body_id}{SEP}{tool.name}",
                tool.description,
                tool.input_schema,
                effect=tool.effect or "change",
                locked=tool.confirm is True,
            )
            for body_id, tools in sorted(tools_by_body.items())
            for tool in tools
        ]

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


def _error_code(name: str) -> ErrorCode:
    # Guard codes are ErrorCode names; "" or "error" (a guard that raised) means denied.
    return ErrorCode[name] if name in ErrorCode.__members__ else ErrorCode.denied


class Toolbox:
    def __init__(
        self,
        sources: list[Source],
        modes: Callable[[], dict[str, str]],
        save_mode: Callable[[str, str], None],
        asks: Asks | None = None,
        approvals: Approvals | None = None,
        side_check: SideCheck | None = None,
        offers: Offers | None = None,
        guards: Guards | None = None,
    ) -> None:
        self.sources = sources  # brain source first; later tasks append body sources
        self._modes = modes  # stored per-tool choices, read on every call
        self._save_mode = save_mode
        self._asks = asks  # None skips gate step 3 (the ask)
        self._approvals = approvals  # None records nothing
        self._side_check = side_check  # None: every ask goes to the person
        self._offers = offers  # None: no offers to auto-approve
        if guards is None:
            # Standalone toolbox: build the same chain the Session registers.
            guards = Guards()
            guards.add(tool_mode(modes))
            if asks is not None:
                guards.add(anyone_online(asks))
                if side_check is not None and approvals is not None:
                    guards.add(side_check_guard(side_check, approvals))
                guards.add(person_ask())
        self._guards = guards

    def mode(self, spec: ToolSpec) -> Literal["ask", "auto"]:
        return resolve_mode(spec, self._modes().get(spec.name))

    def set_mode(self, name: str, mode: str) -> None:
        spec = next((s for src in self.sources for s in src.specs() if s.name == name), None)
        if spec is None:
            raise RpcError(ErrorCode.unknown_tool, f"No tool named {name}.")
        if mode not in ("ask", "auto"):
            raise RpcError(ErrorCode.invalid_params, "mode must be ask or auto.")
        if spec.self_asks:
            raise RpcError(ErrorCode.invalid_params, f"{name} asks for itself.")
        if spec.locked and mode == "auto":
            raise RpcError(ErrorCode.invalid_params, f"{name} always asks first.")
        self._save_mode(name, mode)

    def known_specs(self) -> list[ToolSpec]:
        return [spec for source in self.sources for spec in source.known_specs()]

    def home_tools(self) -> list[Tool]:
        """Home's tool catalogue for `hello`: contract records only (no audience, no mode)."""
        return [
            Tool(
                name=s.name,
                description=s.description,
                input_schema=s.input_schema,
                effect=s.effect,
            )
            for source in self.sources
            for s in source.specs()
            if "home" in s.audience
        ]

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

    async def _ask(self, call: Call, spec: ToolSpec, source_kind: str) -> None:
        """Gate step 3: run the ask chain; return only if the call may run."""
        assert self._asks is not None
        approvals = self._approvals

        def record(outcome: str, decided_by: str = "person") -> None:
            if approvals is not None:
                approvals.record(
                    source=source_kind,
                    tool=spec.name,
                    summary=summary,
                    input=call.input,
                    group_key=spec.name,
                    outcome=outcome,
                    decided_by=decided_by,
                )

        summary = approvals.summarise(call.text, spec.name, call.input) if approvals else ""
        ctx = AskCtx(
            source_kind,
            spec.name,
            summary,
            call.input,
            spec.name,
            spec.locked,
            call.turn,
            lambda: self._asks.permission(call, spec.name, spec.locked),
        )
        verdict = await self._guards.run(Hook.ask, ctx)
        if verdict.kind in ("block", "stop"):
            if verdict.guard == "anyone_online":
                record("no_one", "none")
            elif verdict.guard == "person_ask" and verdict.code == "timeout":
                record("timed_out", "none")
            elif verdict.guard == "person_ask" and verdict.code == "denied":
                record("refused")
            # A cancelled ask is not a final outcome, so it records no row.
            # Logged guard reasons hold no tool text; the user-facing line is built here.
            reason = verdict.reason
            if verdict.guard == "anyone_online":
                reason = f"Nobody was there to ask, so {spec.name} was not run."
            elif verdict.guard == "person_ask" and verdict.code == "denied":
                reason = f"The user said no to {spec.name}."
            raise RpcError(_error_code(verdict.code), reason)
        if verdict.guard == "side_check":
            return  # the guard already logged Scout's row
        record("approved")
        if verdict.value == "always":
            self.set_mode(spec.name, "auto")  # now Auto: an offer would be noise
        elif self._offers is not None:
            self._offers.consider(spec.name, source_kind, spec.name)

    async def run(self, call: Call, caller: str = "scout") -> str | list[dict]:
        for source in self.sources:
            for spec in source.specs():
                if spec.name == call.name:
                    if caller not in spec.audience:
                        raise RpcError(ErrorCode.unknown_tool, f"No tool named {call.name}.")
                    if self._asks is not None:
                        kind = getattr(source, "approval_source", "scout_tool")
                        ctx = ToolCallCtx(spec, call.input, caller, kind, call.turn)
                        verdict = await self._guards.run(Hook.tool_call, ctx)
                        if verdict.kind in ("block", "stop"):
                            raise RpcError(_error_code(verdict.code), verdict.reason)
                        if verdict.kind == "ask":
                            await self._ask(call, spec, kind)
                    return await source.run(call, call.name)
        for source in self.sources:
            error = source.unavailable(call.name)
            if error is not None:
                raise error
        raise RpcError(ErrorCode.unknown_tool, f"No tool named {call.name}.")
