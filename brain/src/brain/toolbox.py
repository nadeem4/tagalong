"""One toolbox for every tool the model or Home may call, built from sources.

A Source owns a set of tools (the brain's own, or a body's). The toolbox lists what Scout may
see, and gates each call: unknown name, wrong caller, or a source that cannot serve it now.
The permission engine then decides: an ask-mode tool waits for an allow from a standing rule,
Scout's side-check or the person (gate step 3); Home calls skip that step.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import timedelta
from typing import TYPE_CHECKING, Literal, Protocol

from pydantic import ValidationError

from brain.asks import Asks
from brain.bodies import Bodies
from brain.mind.prompt import part_blocks
from brain.mind.turn import Call
from brain.outputs import OutputStore, preview
from brain.permission import (
    ASK_WAIT_ARG,
    AskOpen,
    AskRequest,
    Decision,
    Engine,
    Tier,
    ask_wait,
    gate_tier,
    resolve_mode,
    summarise,
    tier,
    tool_asker,
)
from brain.protocol import LIMITS, CallResult, ErrorCode, RpcError, Tool
from brain.telemetry import timed

if TYPE_CHECKING:
    from brain.open_item_runner import AskRunner

log = logging.getLogger("brain")

# Results never capped again: read_output is how the capped rest is read, one page at a time.
UNCAPPED = frozenset({"read_output"})
NAME_MAX = 64  # the model API rejects longer tool names

Handler = Callable[[dict], Awaitable[str]]

_WAIT_PROPERTY = {
    "type": "number",
    "description": "Hours this may wait for the person's yes if they are away: 1 to 168, "
    "default 72.",
}


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict
    audience: frozenset[str] = frozenset({"scout"})  # the design's `for`; a Python keyword
    effect: Literal["read", "change"] = "change"  # unknown effect is treated as a change
    default_mode: Literal["ask", "auto"] | None = None  # beats the effect-based default
    # A fixed floor set by the source: `person_only` (only the person, every time), `locked` (asks
    # until the person sets it to auto; no "Always" button) or `auto` (runs its own ask, so the
    # gate adds none). None: the tier comes from `default_mode` or `effect`. See permission.tier.
    tier: Tier | None = None
    # A nudge or follow-up on an expert's job: the owner's own chat message counts as the yes, so
    # on an owner-driven turn the gate adds no ask; on a wake turn it asks like any ask-mode tool.
    follow_up: bool = False
    # Facts built by code for the Allow card (and the approvals log) instead of the model's raw
    # input, e.g. what an install will download. The handler still gets the model's input.
    card: Callable[[dict], Awaitable[dict]] | None = None
    # A tool Anthropic runs (web search): its typed declaration goes to the model as it is, and the
    # brain never runs it.
    server_tool: dict | None = None


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


# The desktop's install_ocr_language gives up on its own at INSTALL_TOOL_TIMEOUT_MS (630 s).
# The brain's wait MUST stay strictly above that so the body always answers first with
# "still installing". Raise this together with the desktop constant.
INSTALL_OCR_TIMEOUT_S = 660.0
# Tools whose body-side work legitimately runs long. Every other tool keeps Bodies.use's 30 s.
BODY_TOOL_TIMEOUTS = {"install_ocr_language": INSTALL_OCR_TIMEOUT_S}

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

    def label(self, body_id: str) -> str:
        """The body's declared name, for Home's group heading."""
        return self._bodies.name(body_id)

    @staticmethod
    def _specs_of(tools_by_body: dict[str, list[Tool]]) -> list[ToolSpec]:
        return [
            ToolSpec(
                f"{body_id}{SEP}{tool.name}",
                tool.description,
                tool.input_schema,
                effect=tool.effect or "change",
                # "always" (delete, overwrite): person only, never Auto.
                tier=(
                    Tier.person_only
                    if tool.confirm == "always"
                    else Tier.locked
                    if tool.confirm is True
                    else None
                ),
            )
            for body_id, tools in sorted(tools_by_body.items())
            for tool in tools
        ]

    async def run(self, call: Call, tool: str) -> str | list[dict]:
        body_id, _, plain = tool.partition(SEP)
        limit = BODY_TOOL_TIMEOUTS.get(plain)
        if limit is None:
            raw = await self._bodies.use(body_id, call.id, plain, call.input)
        else:
            raw = await self._bodies.use(body_id, call.id, plain, call.input, timeout=limit)
        try:
            parts = CallResult.model_validate({"output": raw}).output
        except ValidationError:
            raise RpcError(ErrorCode.tool_failed, "body sent a bad result") from None
        total = 0
        for part in parts:
            # Text counts in bytes, not characters: a body's text could otherwise be unbounded.
            size = (
                len(part.data) * 3 // 4 if hasattr(part, "data") else len(part.text.encode("utf-8"))
            )
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
        asks: Asks | None = None,
        engine: Engine | None = None,
        owner_turn: Callable[[str | None], bool] = lambda turn_id: False,
        on_call: Callable[[Call, ToolSpec, str, str, str | None, BaseException | None], None]
        | None = None,
        outputs: OutputStore | None = None,
        runner: "AskRunner | None" = None,
    ) -> None:
        # Scout's own asks become open items through this and never wait in their turn; without
        # it (a job's ask, or no runner) the call waits for the card.
        self._runner = runner
        # Long text results reach the model as a capped preview; None leaves them whole.
        self._outputs = outputs
        # Told after every call of a known tool: (call, spec, source kind, "ok" | "failed" |
        # "refused", the text result when it ran, the exception when it failed). Never allowed
        # to break the call.
        self._on_call = on_call
        self.sources = sources  # brain source first, then the body and app sources
        self._modes = modes  # stored per-tool choices, read on every call
        self._save_mode = save_mode
        self._asks = asks  # None skips gate step 3 (the ask)
        self._engine = engine  # None skips it too
        self._owner_turn = owner_turn

    def mode(self, spec: ToolSpec) -> Literal["off", "ask", "auto"]:
        return resolve_mode(spec, self._modes().get(spec.name))

    def set_mode(self, name: str, mode: str) -> None:
        # Known specs, so a tool of a body that is offline right now can still be set.
        spec = next((s for s in self.known_specs() if s.name == name), None)
        if spec is None:
            raise RpcError(ErrorCode.unknown_tool, f"No tool named {name}.")
        if mode not in ("off", "ask", "auto"):
            raise RpcError(ErrorCode.invalid_params, "mode must be off, ask or auto.")
        if mode == "ask" and spec.server_tool is not None:
            # Anthropic runs it inside the reply, so it never reaches the gate to be asked.
            raise RpcError(
                ErrorCode.invalid_params, f"{name} runs on Anthropic's side; Off or Auto."
            )
        if mode == "auto":  # Off and Ask are always the owner's to choose
            if spec.tier is Tier.auto:
                raise RpcError(ErrorCode.invalid_params, f"{name} asks for itself.")
            if tier(spec) is Tier.person_only:
                raise RpcError(ErrorCode.invalid_params, f"{name} always needs your yes.")
        self._save_mode(name, mode)

    def active_specs(self) -> list[ToolSpec]:
        """Every servable tool that is not Off, sorted by name within each source.

        The one place the model's tool list and the capability picture read, so Off removes a
        tool from both.
        """
        stored = self._modes()  # one read, not one per tool
        return [
            spec
            for source in self.sources
            for spec in sorted(source.specs(), key=lambda s: s.name)
            if resolve_mode(spec, stored.get(spec.name)) != "off"
        ]

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
        for spec in self.active_specs():
            if "scout" not in spec.audience:
                continue
            if len(spec.name) > NAME_MAX:
                log.warning("tool name too long, dropped: %s", spec.name)
                continue
            if spec.server_tool is not None:
                out.append(spec.server_tool)
                continue
            schema = spec.input_schema
            if self.mode(spec) == "ask":  # only a tool that can ask has a wait to name
                schema = {
                    **schema,
                    "properties": {**schema.get("properties", {}), ASK_WAIT_ARG: _WAIT_PROPERTY},
                }
            out.append({"name": spec.name, "description": spec.description, "input_schema": schema})
        return out

    async def _ask(
        self,
        call: Call,
        spec: ToolSpec,
        source_kind: str,
        job_id: str | None,
        wait: timedelta | None,
    ) -> None:
        """Gate step 3: the engine decides; return only if the call may run. `job_id` names the
        expert job a call comes from, so its approval rows say so. Scout's own ask that needs the
        person opens an item and raises `AskOpen` at once: the answer runs the call later."""
        assert self._asks is not None and self._engine is not None
        req = await self.ask_request(
            call, spec, source_kind, job_id=job_id, ask_id=uuid.uuid4().hex
        )
        later = wait is not None and self._runner is not None
        decision = await self._engine.decide(replace(req, how_to_ask=None) if later else req)
        if decision.allowed:
            return
        if later and decision.code == "no_decider":  # only the person is left to say
            assert wait is not None and self._runner is not None
            raise AskOpen(self._runner.open(call, req, wait).id)
        # Plain words the model reads; logged reasons never carry tool text.
        name = spec.name
        match decision.code:
            case "denied":
                raise RpcError(ErrorCode.denied, f"The user said no to {name}.")
            case "no_one":
                raise RpcError(ErrorCode.denied, f"Nobody was there to ask, so {name} was not run.")
            case "expired":
                raise RpcError(ErrorCode.timeout, decision.reason)
            case "cancelled":
                raise RpcError(ErrorCode.cancelled, "the ask was cancelled")
            case _:
                raise RpcError(ErrorCode.denied, f"Nobody approved {name}, so it was not run.")

    async def ask_request(
        self,
        call: Call,
        spec: ToolSpec,
        kind: str,
        *,
        job_id: str | None,
        ask_id: str,
    ) -> AskRequest:
        """The engine's request for one tool call: the one shape a new ask and an open ask
        decided again share."""
        assert self._asks is not None
        gate = gate_tier(spec, self._modes().get(spec.name))
        shown = call
        if spec.card is not None:
            shown = replace(call, input=await spec.card(call.input))
        return AskRequest(
            kind="tool",
            source=kind,
            tool=spec.name,
            group_key=spec.name,
            summary=summarise(call.text, spec.name, shown.input),
            input=shown.input,
            tier=gate,
            how_to_ask=tool_asker(self._asks, shown, spec.name, gate, ask_id, job_id),
            job_id=job_id,
            turn_id=call.turn or None,
            ask_id=ask_id,
        )

    def spec_named(self, name: str) -> tuple[ToolSpec, str] | None:
        """A tool Scout can call by this name, with its source kind; None when it is gone."""
        found = self._servable(name)
        return (
            None
            if found is None
            else (found[1], getattr(found[0], "approval_source", "scout_tool"))
        )

    def _servable(self, name: str) -> tuple[Source, ToolSpec] | None:
        for source in self.sources:
            for spec in source.specs():
                if spec.name == name:
                    return (source, spec) if "scout" in spec.audience else None
        return None

    async def redecide(self, req: AskRequest) -> Decision:
        """The engine's decision for a request `ask_request` built."""
        assert self._engine is not None
        return await self._engine.decide(req)

    async def run(
        self, call: Call, caller: str = "scout", job_id: str | None = None
    ) -> str | list[dict]:
        found: list = []  # [spec, source kind, ran?] once a servable tool is matched
        # The wait is the model's to name for its own asks only; no tool, card or log sees it.
        hours = call.input.get(ASK_WAIT_ARG)
        if ASK_WAIT_ARG in call.input:
            call = replace(call, input={k: v for k, v in call.input.items() if k != ASK_WAIT_ARG})
        wait = ask_wait(hours) if caller == "scout" and job_id is None else None
        try:
            out = await self._run(call, caller, found, job_id, wait)
        except AskOpen as opened:
            # Not run, not failed: the ask is open for the person. Plain facts for the model.
            if found:
                self._report(call, found[0], found[1], "refused", None, opened)
            return (
                f"{call.name} is waiting for the person's answer (ask {opened.ask_id}). "
                "It runs by itself if they allow it; do not call it again."
            )
        except Exception as err:
            if found:
                status = "failed" if found[2] else "refused"
                self._report(call, found[0], found[1], status, None, err)
            raise
        if found:
            self._report(call, found[0], found[1], "ok", out if isinstance(out, str) else None)
        return self._cap(call, out, caller)

    def _cap(self, call: Call, out: str | list[dict], caller: str) -> str | list[dict]:
        # Only what a model reads is capped: Home's own calls get their JSON whole.
        if (
            self._outputs is not None
            and caller in ("scout", "expert")
            and isinstance(out, str)
            and call.name not in UNCAPPED
        ):
            # An expert cannot call read_output, so it gets no id to follow.
            return preview(self._outputs, call.name, out, readable=caller == "scout")
        return out

    async def carry_out(self, call: Call) -> str | list[dict]:
        """Run an open ask's saved call after the person's yes (the runner has put it through
        the engine); a tool turned off since then still refuses."""
        found = self._servable(call.name)
        if found is None:
            raise RpcError(ErrorCode.unknown_tool, f"No tool named {call.name}.")
        source, spec = found
        if gate_tier(spec, self._modes().get(spec.name)) is Tier.off:
            raise RpcError(ErrorCode.denied, f"{spec.name} is turned off by the owner.")
        kind = getattr(source, "approval_source", "scout_tool")
        try:
            async with timed("tool", name=call.name):
                out = await source.run(call, call.name)
        except Exception as err:
            self._report(call, spec, kind, "failed", None, err)
            raise
        self._report(call, spec, kind, "ok", out if isinstance(out, str) else None)
        return self._cap(call, out, "scout")

    def _report(
        self,
        call: Call,
        spec: ToolSpec,
        kind: str,
        status: str,
        result: str | None,
        error: BaseException | None = None,
    ) -> None:
        if self._on_call is None:
            return
        try:
            self._on_call(call, spec, kind, status, result, error)
        except Exception:
            log.exception("on_call hook failed")

    async def _gate(
        self, call: Call, spec: ToolSpec, kind: str, job_id: str | None, wait: timedelta | None
    ) -> None:
        stored = self._modes().get(spec.name)
        gate = gate_tier(spec, stored)
        if gate is Tier.off:
            # Plain words the model reads; it should route around, not retry.
            raise RpcError(ErrorCode.denied, f"{spec.name} is turned off by the owner.")
        if gate is Tier.auto or self._engine is None or self._asks is None:
            return  # nobody is asked and nothing is logged
        # A follow-up the owner asked for in chat is already their yes; one Scout starts on a
        # wake goes through the engine.
        if spec.follow_up and gate is not Tier.person_only and self._owner_turn(call.turn):
            return
        await self._ask(call, spec, kind, job_id, wait)

    async def _run(
        self, call: Call, caller: str, found: list, job_id: str | None, wait: timedelta | None
    ) -> str | list[dict]:
        for source in self.sources:
            for spec in source.specs():
                if spec.name == call.name:
                    if caller not in spec.audience:
                        raise RpcError(ErrorCode.unknown_tool, f"No tool named {call.name}.")
                    kind = getattr(source, "approval_source", "scout_tool")
                    found[:] = [spec, kind, False]
                    if caller != "home":
                        await self._gate(call, spec, kind, job_id, wait)
                    found[2] = True
                    # Only the run: the gate above may wait on the person.
                    async with timed("tool", name=call.name):
                        return await source.run(call, call.name)
        for source in self.sources:
            error = source.unavailable(call.name)
            if error is not None:
                raise error
        raise RpcError(ErrorCode.unknown_tool, f"No tool named {call.name}.")
