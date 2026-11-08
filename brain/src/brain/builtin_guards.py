"""Built-in guards: the spend caps (daily budget, step cap), wake caps and the expert ask chain.

The budget also sits on emit so the scheduler drops wakes; model_call guards the turn loop.
Budget comes first so a spent day reports over_budget even when the step cap is also reached.
The ask hook runs anyone_online, side_check_guard and person_ask in that order; only Jobs still
uses it (P3 moves it onto the permission engine, which already decides every tool call).
"""

import dataclasses
import logging
from typing import TYPE_CHECKING

from brain.guards import (
    ALLOW,
    AskCtx,
    EmitCtx,
    Guard,
    Guards,
    Hook,
    ModelCallCtx,
    Verdict,
    allow_once,
    block,
    stop,
)
from brain.protocol import ErrorCode, RpcError

if TYPE_CHECKING:
    pass

log = logging.getLogger("brain")
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


def anyone_online(asks) -> Guard:
    def check(ctx: AskCtx) -> Verdict:
        if asks.anyone_online():
            return ALLOW
        return block("nobody online", "denied")

    return Guard("anyone_online", Hook.ask, check)


def side_check_guard(side_check, approvals) -> Guard:
    async def check(ctx: AskCtx) -> Verdict:
        if (
            not ctx.can_approve or ctx.person_only or ctx.locked
        ):  # the floor: Scout never sees these
            return ALLOW
        from brain.side_check import AskFacts  # side_check imports this module

        facts = AskFacts(ctx.source, ctx.tool, ctx.summary, ctx.input, ctx.group_key)
        try:
            pref = await side_check.decide(facts)
            if pref is None:
                return ALLOW
            # Allow-once only: the tool's ask mode stays as it is.
            approvals.scout_approved(facts, pref, ctx.summary, ctx.job_id)
            return allow_once("approved under a preference", value=pref)
        except Exception:
            log.exception("side-check failed; asking the person")
            return ALLOW

    return Guard("side_check", Hook.ask, check)


_ASK_REASONS = {
    ErrorCode.timeout: "nobody answered the ask in time",
    ErrorCode.cancelled: "the ask was cancelled",
}


def person_ask() -> Guard:
    async def check(ctx: AskCtx) -> Verdict:
        try:
            choice = await ctx.ask_person()
        except RpcError as exc:
            # Plain words only: logged guard reasons must never carry tool text.
            return block(_ASK_REASONS.get(exc.code, exc.code.name), exc.code.name)
        if choice == "deny":
            return block("the person said no", "denied")
        return allow_once("the person answered", value=choice)

    return Guard("person_ask", Hook.ask, check)
