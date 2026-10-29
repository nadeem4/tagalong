"""Checks the built-in spend guards: the daily budget and the per-turn step cap.

They guard the model_call hook; side-check and offer calls are never counted as turn steps.
"""

from brain.builtin_guards import daily_budget, spend_guards, step_cap, tool_mode
from brain.guards import Hook, ModelCallCtx, ToolCallCtx
from brain.toolbox import ToolSpec


class Spend:
    def __init__(self, allows=True):
        self._allows = allows

    def allows(self):
        return self._allows


def ctx(kind="turn", steps=0):
    return ModelCallCtx(kind, "t1", steps)


def test_daily_budget_stops_with_over_budget_when_spent():
    v = daily_budget(Spend(allows=False)).check(ctx())
    assert (v.kind, v.code) == ("stop", "over_budget")


def test_daily_budget_allows_under_limit():
    assert daily_budget(Spend()).check(ctx()).kind == "allow"


def test_step_cap_stops_at_cap_for_turns():
    guard = step_cap(3)
    assert guard.check(ctx(steps=2)).kind == "allow"
    v = guard.check(ctx(steps=3))
    assert (v.kind, v.code) == ("stop", "step_cap")


def test_step_cap_ignores_side_check_and_offer_calls():
    guard = step_cap(3)
    assert guard.check(ctx("side_check", 99)).kind == "allow"
    assert guard.check(ctx("offer", 99)).kind == "allow"


async def test_spend_guards_check_budget_before_step_cap():
    guards = spend_guards(Spend(allows=False), 3)
    v = await guards.run(Hook.model_call, ctx(steps=3))
    assert v.code == "over_budget"
    v = await spend_guards(Spend(), 3).run(Hook.model_call, ctx(steps=3))
    assert v.code == "step_cap"


def tool_ctx(caller="scout", **spec_kw):
    spec = ToolSpec("t", "d", {"type": "object"}, **spec_kw)
    return ToolCallCtx(spec, {}, caller, "scout_tool", "t1")


def test_tool_mode_asks_for_change_tools_by_default():
    v = tool_mode(lambda: {}).check(tool_ctx(effect="change"))
    assert (v.kind, v.reason) == ("ask", "needs your yes")


def test_tool_mode_allows_reads_by_default():
    assert tool_mode(lambda: {}).check(tool_ctx(effect="read")).kind == "allow"


def test_tool_mode_stored_auto_allows():
    guard = tool_mode(lambda: {"t": "auto"})
    assert guard.check(tool_ctx(effect="change")).kind == "allow"


def test_tool_mode_self_asks_tool_is_allowed():
    # self_asks runs its own ask, so the gate adds none; the guard still resolves it as auto.
    assert tool_mode(lambda: {}).check(tool_ctx(self_asks=True)).kind == "allow"


def test_tool_mode_home_caller_skips_the_ask():
    assert tool_mode(lambda: {}).check(tool_ctx("home", effect="change")).kind == "allow"


def test_tool_mode_default_mode_beats_effect():
    assert tool_mode(lambda: {}).check(tool_ctx(effect="read", default_mode="ask")).kind == "ask"
    assert (
        tool_mode(lambda: {}).check(tool_ctx(effect="change", default_mode="auto")).kind == "allow"
    )
