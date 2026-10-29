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


# --- the ask chain: anyone_online, side_check_guard, person_ask ----------------------------

from types import SimpleNamespace  # noqa: E402

from brain.builtin_guards import anyone_online, person_ask, side_check_guard  # noqa: E402
from brain.guards import AskCtx  # noqa: E402
from brain.protocol import ErrorCode, RpcError  # noqa: E402


def ask_ctx(ask_person=None):
    async def default():
        return "allow"

    return AskCtx("scout_tool", "t", "Doing it.", {"a": 1}, "t", False, "t1", ask_person or default)


def test_anyone_online_blocks_with_denied_when_nobody_is_online():
    v = anyone_online(SimpleNamespace(anyone_online=lambda: False)).check(ask_ctx())
    assert (v.kind, v.code, v.reason) == (
        "block",
        "denied",
        "Nobody was there to ask, so t was not run.",
    )


def test_anyone_online_allows_when_someone_is_online():
    assert anyone_online(SimpleNamespace(anyone_online=lambda: True)).check(ask_ctx()).kind == (
        "allow"
    )


class StubSideCheck:
    def __init__(self, result=None, boom=False):
        self.result, self.boom, self.facts = result, boom, []

    async def decide(self, facts):
        self.facts.append(facts)
        if self.boom:
            raise RuntimeError("boom")
        return self.result


class StubApprovals:
    def __init__(self):
        self.scouted = []

    def scout_approved(self, facts, pref, summary, job_id=None):
        self.scouted.append((facts, pref, summary))


async def test_side_check_guard_allow_once_with_preference_and_records_scout_row():
    approvals = StubApprovals()
    v = await side_check_guard(StubSideCheck("pref"), approvals).check(ask_ctx())
    assert (v.kind, v.once, v.value, v.reason) == (
        "allow",
        True,
        "pref",
        "approved under a preference",
    )
    [(facts, pref, summary)] = approvals.scouted
    assert (facts.tool, facts.group_key, facts.locked, pref, summary) == (
        "t",
        "t",
        False,
        "pref",
        "Doing it.",
    )


async def test_side_check_guard_falls_through_when_decide_returns_none():
    v = await side_check_guard(StubSideCheck(None), StubApprovals()).check(ask_ctx())
    assert (v.kind, v.once) == ("allow", False)


async def test_side_check_guard_falls_through_when_decide_raises():
    v = await side_check_guard(StubSideCheck(boom=True), StubApprovals()).check(ask_ctx())
    assert (v.kind, v.once) == ("allow", False)


async def test_person_ask_allow():
    v = await person_ask().check(ask_ctx())
    assert (v.kind, v.once, v.value) == ("allow", True, "allow")


async def test_person_ask_always_value():
    async def always():
        return "always"

    v = await person_ask().check(ask_ctx(always))
    assert (v.once, v.value) == (True, "always")


async def test_person_ask_deny_blocks_with_denied():
    async def deny():
        return "deny"

    v = await person_ask().check(ask_ctx(deny))
    assert (v.kind, v.code, v.reason) == ("block", "denied", "The user said no to t.")


async def test_person_ask_timeout_blocks_with_timeout_code():
    async def late():
        raise RpcError(ErrorCode.timeout, "No answer in time.")

    v = await person_ask().check(ask_ctx(late))
    assert (v.kind, v.code, v.reason) == ("block", "timeout", "No answer in time.")


def test_ask_chain_order_is_online_then_side_check_then_person():
    from brain.bodies import Bodies
    from brain.memory import Memory
    from brain.sessions import Session

    session = Session(object(), object(), Bodies(), 10, Memory(":memory:"))
    assert [g.name for g in session.guards._for(Hook.ask)] == [
        "anyone_online",
        "side_check",
        "person_ask",
    ]
