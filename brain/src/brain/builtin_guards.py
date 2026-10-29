"""Built-in guards that cap what the model loop may spend: the daily budget and the step cap.

They sit on the model_call hook so the turn loop asks one place before every model call.
Budget comes first so a spent day reports over_budget even when the step cap is also reached.
"""

from brain.guards import ALLOW, Guard, Guards, Hook, ModelCallCtx, Verdict, stop


def daily_budget(budget) -> Guard:
    def check(ctx: ModelCallCtx) -> Verdict:
        return ALLOW if budget.allows() else stop("daily budget spent", "over_budget")

    return Guard("daily_budget", Hook.model_call, check)


def step_cap(cap: int) -> Guard:
    def check(ctx: ModelCallCtx) -> Verdict:
        if ctx.kind == "turn" and ctx.steps >= cap:
            return stop("step limit reached", "step_cap")
        return ALLOW

    return Guard("step_cap", Hook.model_call, check)


def spend_guards(budget, cap: int) -> Guards:
    guards = Guards()
    guards.add(daily_budget(budget))
    guards.add(step_cap(cap))
    return guards
