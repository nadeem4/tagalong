"""Built-in guards: the spend caps (daily budget, step cap) and the wake caps.

The budget also sits on emit so the scheduler drops wakes; model_call guards the turn loop.
Budget comes first so a spent day reports over_budget even when the step cap is also reached.
Asks are not here: the permission engine decides every one of them.
"""

import dataclasses

from brain.guards import ALLOW, EmitCtx, Guard, Guards, Hook, ModelCallCtx, Verdict, block, stop

_WINDOW = 3600  # seconds in the rolling wake-cap window


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


def wake_caps(per_hour: int) -> Guard:
    """Hold a wake while its kind's cap or the overall cap is reached; value = seconds to wait."""

    def check(ctx: EmitCtx) -> Verdict:
        if ctx.kind is None or ctx.kind.max_per_hour is None:
            return ALLOW
        recent = [(t, k) for t, k in ctx.wakes if (ctx.now - t).total_seconds() < _WINDOW]
        waits = []
        for times, cap in (
            ([t for t, k in recent if k == ctx.kind.name], ctx.kind.max_per_hour),
            ([t for t, _ in recent], per_hour),
        ):
            if len(times) >= cap:
                oldest_blocking = times[len(times) - cap]
                waits.append(_WINDOW - (ctx.now - oldest_blocking).total_seconds())
        if not waits:
            return ALLOW
        return dataclasses.replace(block("wake cap reached", "held"), value=max(waits))

    return Guard("wake_caps", Hook.emit, check)


def spend_guards(budget, cap: int) -> Guards:
    guards = Guards()
    guards.add(daily_budget(budget))
    guards.add(daily_budget_on_emit(budget))
    guards.add(step_cap(cap))
    return guards
