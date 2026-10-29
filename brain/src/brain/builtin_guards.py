"""Built-in guards: the spend caps (daily budget, step cap) and the tool-mode gate.

The budget also sits on emit so the scheduler drops wakes; model_call guards the turn loop.
Budget comes first so a spent day reports over_budget even when the step cap is also reached.
tool_mode is the tool_call guard that asks the person before a tool runs in ask mode.
"""

import dataclasses
from collections.abc import Callable
from typing import TYPE_CHECKING, Literal

from brain.guards import ALLOW, Guard, Guards, Hook, ModelCallCtx, ToolCallCtx, Verdict, ask, stop

if TYPE_CHECKING:
    from brain.toolbox import ToolSpec


def daily_budget(budget) -> Guard:
    def check(ctx: ModelCallCtx) -> Verdict:
        return ALLOW if budget.allows() else stop("daily budget spent", "over_budget")

    return Guard("daily_budget", Hook.model_call, check)


def daily_budget_on_emit(budget) -> Guard:
    # Same check and name on the emit hook, so the scheduler drops wakes once the day is spent.
    return dataclasses.replace(daily_budget(budget), hook=Hook.emit)


def step_cap(cap: int) -> Guard:
    def check(ctx: ModelCallCtx) -> Verdict:
        if ctx.kind == "turn" and ctx.steps >= cap:
            return stop("step limit reached", "step_cap")
        return ALLOW

    return Guard("step_cap", Hook.model_call, check)


def spend_guards(budget, cap: int) -> Guards:
    guards = Guards()
    guards.add(daily_budget(budget))
    guards.add(daily_budget_on_emit(budget))
    guards.add(step_cap(cap))
    return guards


def resolve_mode(spec: "ToolSpec", stored: str | None) -> Literal["ask", "auto"]:
    """The mode a tool runs in; Home's permission list uses this too, so both always agree."""
    if spec.self_asks:
        return "auto"
    if spec.locked:
        return "ask"
    if stored in ("ask", "auto"):
        return stored
    if spec.default_mode is not None:
        return spec.default_mode
    return "auto" if spec.effect == "read" else "ask"


def tool_mode(modes: Callable[[], dict[str, str]]) -> Guard:
    def check(ctx: ToolCallCtx) -> Verdict:
        if ctx.caller == "home":
            return ALLOW
        if resolve_mode(ctx.spec, modes().get(ctx.spec.name)) == "ask":
            return ask("needs your yes")
        return ALLOW

    return Guard("tool_mode", Hook.tool_call, check)
