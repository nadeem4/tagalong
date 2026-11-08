"""Checks the built-in spend guards: the daily budget, the per-turn step cap and the wake caps.

They guard the model_call hook; side-check and offer calls are never counted as turn steps.
"""

from datetime import UTC, datetime, timedelta

from brain.builtin_guards import (
    daily_budget,
    spend_guards,
    step_cap,
    wake_caps,
)
from brain.events import EventKind
from brain.guards import EmitCtx, Hook, ModelCallCtx

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


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


# wake_caps: the per-kind and overall hourly caps on the emit hook.
TIMER = EventKind("timer", max_per_hour=2)


def _wake_ctx(wakes, kind=TIMER):
    return EmitCtx(kind, NOW, wakes)


def test_wake_caps_allow_under_both_caps():
    wakes = [(NOW - timedelta(minutes=5), "timer")]
    assert wake_caps(5).check(_wake_ctx(wakes)).kind == "allow"


def test_wake_caps_hold_when_the_kind_cap_is_reached_with_wait_seconds():
    wakes = [(NOW - timedelta(minutes=50), "timer"), (NOW - timedelta(minutes=10), "timer")]
    v = wake_caps(5).check(_wake_ctx(wakes))
    assert (v.kind, v.code, v.reason) == ("block", "held", "wake cap reached")
    assert v.value == 600.0  # the oldest wake leaves the hour in 10 minutes


def test_wake_caps_hold_when_the_overall_cap_is_reached():
    wakes = [(NOW - timedelta(minutes=30), "job_ended"), (NOW - timedelta(minutes=20), "back")]
    v = wake_caps(2).check(_wake_ctx(wakes))
    assert (v.code, v.value) == ("held", 1800.0)


def test_wake_caps_ignore_kinds_without_a_cap():
    wakes = [(NOW - timedelta(minutes=1), "timer")] * 9
    assert wake_caps(1).check(_wake_ctx(wakes, EventKind("note"))).kind == "allow"
    assert wake_caps(1).check(_wake_ctx(wakes, None)).kind == "allow"


def test_wake_caps_wait_is_zero_after_the_window_ages_out():
    wakes = [(NOW - timedelta(hours=2), "timer"), (NOW - timedelta(hours=1), "timer")]
    assert wake_caps(1).check(_wake_ctx(wakes)).kind == "allow"
