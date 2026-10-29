"""The guard runner: one ordered list of checks per hook, folded into a single verdict.

Every refusal (budget, tool gate, masking) goes through here so precedence and logging live
once. A guard that raises counts as a block, so spend and tool hooks fail closed.
"""

import dataclasses
import inspect
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from brain.events import EventKind
    from brain.toolbox import ToolSpec

log = logging.getLogger("brain.guardrails")


class Hook(StrEnum):
    model_call = "model_call"
    tool_call = "tool_call"
    ask = "ask"
    tool_result = "tool_result"
    emit = "emit"
    save = "save"


@dataclass(frozen=True)
class Verdict:
    kind: Literal["allow", "ask", "block", "stop", "rewrite"]
    reason: str = ""
    code: str = ""  # machine reason: over_budget, step_cap, an ErrorCode value
    value: Any = None
    once: bool = False  # allow for this one call only (side-check approval)
    guard: str = ""  # filled by the runner


ALLOW = Verdict("allow")


def ask(reason: str) -> Verdict:
    return Verdict("ask", reason)


def block(reason: str, code: str = "") -> Verdict:
    return Verdict("block", reason, code)


def stop(reason: str, code: str) -> Verdict:
    return Verdict("stop", reason, code)


def rewrite(value: Any) -> Verdict:
    return Verdict("rewrite", value=value)


def allow_once(reason: str, value: Any = None) -> Verdict:
    return Verdict("allow", reason, value=value, once=True)


@dataclass(frozen=True)
class Guard:
    name: str
    hook: Hook
    check: Callable[[Any], Verdict | Awaitable[Verdict]]


@dataclass(frozen=True)
class ModelCallCtx:
    kind: Literal["turn", "side_check", "offer"]
    turn_id: str | None
    steps: int


@dataclass(frozen=True)
class ToolCallCtx:
    spec: "ToolSpec"
    input: dict
    caller: str
    source_kind: str
    turn_id: str | None


@dataclass(frozen=True)
class AskCtx:
    """Filled in by G2."""


@dataclass(frozen=True)
class EmitCtx:
    kind: "EventKind | None"
    now: datetime
    wakes: Sequence[tuple[datetime, str]]


@dataclass(frozen=True)
class SaveCtx:
    what: Literal["chat", "approval", "job_result", "log"]
    text: str


class _Fold:
    """Combines guard verdicts for one hook; `feed` returns True when later guards can't matter."""

    def __init__(self, hook: Hook, ctx: Any):
        self.hook = hook
        self.ctx = ctx
        self.asked: Verdict | None = None
        self.rewritten: Verdict | None = None
        self.final: Verdict | None = None

    def feed(self, guard: Guard, verdict: Verdict) -> bool:
        v = dataclasses.replace(verdict, guard=guard.name)
        if v.kind in ("block", "stop"):
            self._log(v)
            self.final = v
            return True
        if v.kind == "allow" and v.once and self.hook is Hook.ask:
            self.final = v
            return True
        if v.kind == "ask":
            self._log(v)
            self.asked = self.asked or v
        elif v.kind == "rewrite":
            self.rewritten = v
            self.ctx = dataclasses.replace(self.ctx, text=v.value)
        return False

    def failed(self, guard: Guard) -> bool:
        # Reason is fixed words: an exception's text could carry tool input.
        return self.feed(guard, block("guard failed", "error"))

    def result(self) -> Verdict:
        return self.final or self.asked or self.rewritten or ALLOW

    def _log(self, v: Verdict) -> None:
        turn = getattr(self.ctx, "turn_id", None)
        suffix = f" turn={turn}" if turn else ""
        log.info(
            "guard=%s hook=%s verdict=%s reason=%s%s", v.guard, self.hook, v.kind, v.reason, suffix
        )


class Guards:
    def __init__(self) -> None:
        self._guards: list[Guard] = []

    def add(self, guard: Guard) -> None:
        self._guards.append(guard)

    def _for(self, hook: Hook) -> list[Guard]:
        return [g for g in self._guards if g.hook == hook]

    async def run(self, hook: Hook, ctx: Any) -> Verdict:
        fold = _Fold(hook, ctx)
        for g in self._for(hook):
            try:
                v = g.check(fold.ctx)
                if inspect.isawaitable(v):
                    v = await v
            except Exception:
                done = fold.failed(g)
            else:
                done = fold.feed(g, v)
            if done:
                break
        return fold.result()

    def run_sync(self, hook: Hook, ctx: Any) -> Verdict:
        fold = _Fold(hook, ctx)
        for g in self._for(hook):
            try:
                v = g.check(fold.ctx)
                if inspect.isawaitable(v):
                    if inspect.iscoroutine(v):
                        v.close()
                    raise TypeError("async guard on a sync hook")
            except Exception:
                done = fold.failed(g)
            else:
                done = fold.feed(g, v)
            if done:
                break
        return fold.result()
