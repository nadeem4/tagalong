"""Tests for Scout asks that outlive their turn: parking, a later yes, the same call again.

Everything runs on fakes: a fake body list, a fake source that records what ran, and the real
toolbox, engine, asks and work rows wired the way a session wires them.
"""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from brain.approvals import Approvals
from brain.asks import Asks
from brain.events import Event
from brain.memory import Memory
from brain.mind.turn import Call
from brain.permission import Engine, Person, StandingRule, stored_auto_rules
from brain.protocol import ErrorCode, RpcError
from brain.store.work import TransitionRefused, WorkStore
from brain.toolbox import Toolbox as RealToolbox
from brain.toolbox import ToolSpec
from brain.waiting import WaitingAsks

NOW = datetime(2026, 11, 8, 9, 0, 0, tzinfo=UTC)


class Bodies:
    def __init__(self, online=("desktop",), headless=()):
        self.online = list(online)
        self.headless = set(headless)
        self.sent: list[dict] = []

    def display_ids(self):
        return [i for i in self.online if i not in self.headless]

    def notify(self, method, params):
        self.sent.append(dict(params))


class Source:
    def __init__(self, *names):
        self._specs = [ToolSpec(n, f"{n} tool", {"type": "object"}) for n in names]
        self.ran: list[tuple[str, dict]] = []
        self.fail: RpcError | None = None

    def specs(self):
        return list(self._specs)

    def known_specs(self):
        return list(self._specs)

    async def run(self, call, tool):
        if self.fail is not None:
            raise self.fail
        self.ran.append((tool, call.input))
        return f"ran {tool}"

    def unavailable(self, name):
        return None


def now():
    return NOW


class SlowCheck:
    """A decider that takes a while and passes, like a side-check model call."""

    name = "slow_check"

    def __init__(self, delay):
        self.delay = delay

    async def decide(self, req):
        await asyncio.sleep(self.delay)
        return None


class Rig:
    def __init__(self, online=("desktop",), headless=(), park_after=0.05, names=("t",), slow=0.0):
        self.memory = Memory(":memory:")
        self.work = WorkStore(self.memory.db, now)
        self.bodies = Bodies(online, headless)
        self.asks = Asks(self.bodies, self.work)
        self.approvals = Approvals(self.memory, self.work, lambda m, p: None, now)
        self.stored: dict[str, str] = {}
        self.events: list[Event] = []
        self.source = Source(*names)
        self.engine = Engine(
            [StandingRule(stored_auto_rules(lambda: self.stored)), SlowCheck(slow), Person()],
            self.approvals,
            None,
            lambda name: self.stored.__setitem__(name, "auto"),
            now=now,
        )
        self.clock = NOW  # the waiting asks' own clock; tests move it past a notice or deadline
        self.waiting = WaitingAsks(
            self.work,
            self.asks,
            lambda: self.box,
            self.events.append,
            lambda: self.clock,
            self.approvals,
        )
        self.box = RealToolbox(
            [self.source],
            lambda: self.stored,
            self.stored.__setitem__,
            self.asks,
            self.engine,
            waiting=self.waiting,
            park_after=park_after,
        )

    def opened(self):
        return [p for p in self.bodies.sent if p["state"] == "open"]

    def closed(self):
        return [p for p in self.bodies.sent if p["state"] == "closed"]

    async def settle(self, times=20):
        for _ in range(times):
            await asyncio.sleep(0)


def call(n=1, name="t", call_id="c1", turn="t1"):
    return Call(id=call_id, name=name, input={"n": n}, turn=turn, text="Doing it.")


async def test_scout_ask_parks_after_the_wait_and_the_turn_goes_on():
    rig = Rig(park_after=0.05)
    out = await rig.box.run(call())
    [ask] = rig.opened()
    assert out == (
        f"t is waiting for the person's answer (ask {ask['id']}). "
        "It runs by itself if they allow it; do not call it again."
    )
    assert rig.source.ran == []
    row = rig.work.get(ask["id"])
    assert row.state == "active" and row.due_at is not None
    assert [r.id for r in rig.work.waiting_asks()] == [ask["id"]]


async def test_scout_ask_parks_at_once_when_nobody_displays():
    rig = Rig(online=("browser",), headless=("browser",), park_after=300.0)
    out = await asyncio.wait_for(rig.box.run(call()), 5)
    assert "waiting for the person's answer" in out
    [ask] = rig.asks.open_asks()
    assert rig.work.get(ask["id"]).state == "active"
    assert rig.source.ran == []


async def test_a_yes_in_time_runs_the_call_in_the_turn():
    rig = Rig(park_after=5.0)
    task = asyncio.create_task(rig.box.run(call()))
    await rig.settle()
    rig.asks.answer(rig.opened()[0]["id"], "allow", "desktop")
    assert await task == "ran t"


async def test_stopping_the_turn_withdraws_only_the_waiting_ask():
    rig = Rig(park_after=0.05)
    await rig.box.run(call(1))  # parked
    [parked] = rig.opened()
    rig.box._park_after = 5.0
    waiting = asyncio.create_task(rig.box.run(call(2, call_id="c2")))
    await rig.settle()
    second = next(p for p in rig.opened() if p["id"] != parked["id"])
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    await rig.settle()
    closed = rig.closed()
    assert [(c["id"], c["reason"]) for c in closed] == [(second["id"], "cancelled")]
    assert [a["id"] for a in rig.asks.open_asks()] == [parked["id"]]
    assert rig.work.get(parked["id"]).state == "active"
    assert rig.work.ask_detail(second["id"])["decided_by"] is None  # nothing was decided


async def test_parked_frame_has_no_turn():
    rig = Rig(park_after=0.05)
    await rig.box.run(call())
    assert "turn" in rig.opened()[0]  # the frame sent while the turn waited named it
    [replay] = rig.asks.open_asks()
    assert "turn" not in replay


async def test_job_owned_ask_never_parks():
    rig = Rig(park_after=0.01)
    spec = ToolSpec("t", "t tool", {"type": "object"}, frozenset({"scout", "expert"}))
    rig.source._specs = [spec]
    task = asyncio.create_task(rig.box.run(call(), caller="expert", job_id="job1"))
    await asyncio.sleep(0.1)
    assert not task.done()
    rig.asks.answer(rig.opened()[0]["id"], "allow", "desktop")
    assert await task == "ran t"


async def test_a_call_that_needs_no_ask_never_parks():
    rig = Rig(park_after=0.01)
    rig.stored["t"] = "auto"
    assert await rig.box.run(call()) == "ran t"
    assert rig.opened() == []


def ended(rig):
    return [e for e in rig.events if e.kind == "ask_ended"]


async def park(rig, n=1):
    await rig.box.run(call(n))
    return rig.opened()[-1]["id"]


async def test_late_yes_runs_the_call_once_and_wakes_scout():
    rig = Rig(park_after=0.05)
    ask_id = await park(rig)
    rig.asks.answer(ask_id, "allow", "desktop")
    await rig.settle()
    assert rig.source.ran == [("t", {"n": 1})]
    [event] = ended(rig)
    assert event.key == f"ask:{ask_id}"
    assert event.facts == {
        "ask": ask_id,
        "tool": "t",
        "summary": rig.work.ask_detail(ask_id)["summary"],
        "outcome": "approved",
        "result": "ran t",
    }
    with pytest.raises(RpcError) as err:  # a second answer finds a closed ask
        rig.asks.answer(ask_id, "allow", "desktop")
    assert err.value.code == ErrorCode.not_found
    assert len(rig.source.ran) == 1 and len(ended(rig)) == 1


async def test_late_no_wakes_scout_with_refused():
    rig = Rig(park_after=0.05)
    ask_id = await park(rig)
    rig.asks.answer(ask_id, "deny", "desktop")
    await rig.settle()
    assert rig.source.ran == []
    [event] = ended(rig)
    assert event.facts["outcome"] == "refused"
    assert event.facts["ask"] == ask_id


async def test_late_yes_for_a_tool_now_off_runs_nothing():
    rig = Rig(park_after=0.05)
    ask_id = await park(rig)
    rig.stored["t"] = "off"
    rig.asks.answer(ask_id, "allow", "desktop")
    await rig.settle()
    assert rig.source.ran == []
    [event] = ended(rig)
    assert event.facts["outcome"] == "failed"
    assert "turned off" in event.facts["reason"]


async def test_late_yes_that_fails_wakes_scout_with_the_reason():
    rig = Rig(park_after=0.05)
    ask_id = await park(rig)
    rig.source.fail = RpcError(ErrorCode.tool_failed, "disk full")
    rig.asks.answer(ask_id, "allow", "desktop")
    await rig.settle()
    [event] = ended(rig)
    assert event.facts["outcome"] == "failed" and "disk full" in event.facts["reason"]


async def test_same_call_while_parked_returns_the_same_ask():
    rig = Rig(park_after=0.05)
    ask_id = await park(rig)
    out = await rig.box.run(call(1, call_id="c2"))
    assert ask_id in out
    assert len(rig.opened()) == 1
    assert len(rig.asks.open_asks()) == 1


async def test_parked_at_once_card_has_no_turn_when_a_body_joins():
    rig = Rig(online=("browser",), headless=("browser",), park_after=300.0)
    await asyncio.wait_for(rig.box.run(call()), 5)
    await rig.settle()
    rig.bodies.online.append("desktop")
    [replay] = rig.asks.open_asks()
    assert "turn" not in replay


async def test_two_identical_parallel_calls_open_one_card_under_a_slow_check():
    rig = Rig(park_after=0.3, slow=0.1)
    first, second = await asyncio.gather(
        rig.box.run(call(call_id="c1")), rig.box.run(call(call_id="c2"))
    )
    [ask] = rig.opened()
    assert ask["id"] in first and ask["id"] in second


async def test_a_recall_right_after_an_immediate_park_gets_the_same_ask():
    rig = Rig(online=("browser",), headless=("browser",), park_after=300.0, slow=0.1)
    first = await rig.box.run(call(call_id="c1"))
    second = await rig.box.run(call(call_id="c2"))
    await asyncio.sleep(0.2)
    [ask] = rig.asks.open_asks()
    assert ask["id"] in first and ask["id"] in second


async def test_the_claim_is_released_when_the_decision_ends():
    rig = Rig(park_after=0.05)
    ask_id = await park(rig)
    rig.asks.answer(ask_id, "deny", "desktop")
    await rig.settle()
    await rig.box.run(call(call_id="c2"))
    assert len(rig.opened()) == 2


async def test_a_parked_id_is_forgotten_once_the_ask_ends():
    rig = Rig(park_after=0.05)
    ask_id = await park(rig)
    assert ask_id in rig.asks._parked
    rig.asks.answer(ask_id, "deny", "desktop")
    await rig.settle()
    assert rig.asks._parked == set()


# --- deadline, notice and expiry ---


def waits(hours, n=1):
    return Call(id="c1", name="t", input={"n": n, "ask_wait_hours": hours}, turn="t1", text="Go.")


def notices(rig):
    return [e for e in rig.events if e.kind == "ask_notice"]


async def test_notice_fires_once_at_two_thirds_with_facts_only():
    rig = Rig()
    await rig.box.run(waits(3))
    ask_id = rig.opened()[-1]["id"]
    rig.clock = NOW + timedelta(hours=2) - timedelta(seconds=1)
    rig.waiting.fire_due()
    assert notices(rig) == []
    rig.clock = NOW + timedelta(hours=2)
    rig.waiting.fire_due()
    rig.waiting.fire_due()  # once only
    [event] = notices(rig)
    assert event.key == f"ask:{ask_id}"
    assert event.facts == {
        "ask": ask_id,
        "tool": "t",
        "summary": rig.work.ask_detail(ask_id)["summary"],
        "age_s": 7200,
        "left_s": 3600,
    }
    assert rig.source.ran == []


async def test_deadline_expires_with_no_answer_closes_the_card_and_wakes_scout():
    rig = Rig()
    await rig.box.run(waits(1))
    ask_id = rig.opened()[-1]["id"]
    rig.clock = NOW + timedelta(hours=1)
    rig.waiting.fire_due()
    await rig.settle()
    assert {"id": ask_id, "state": "closed", "reason": "timeout"} in rig.closed()
    [event] = ended(rig)
    assert event.facts["outcome"] == "expired" and event.facts["reason"] == "no answer"
    row = rig.work.get(ask_id)
    assert (row.state, row.end_reason) == ("expired", "expired")
    assert rig.work.ask_detail(ask_id)["decided_by"] == "none"
    assert rig.work.events_of_kind(ask_id, "decided")[-1].data["reason"] == "no answer"
    rig.waiting.fire_due()  # nothing is left to expire
    await rig.settle()
    assert len(ended(rig)) == 1


async def test_firing_twice_before_the_end_lands_wakes_and_logs_once():
    rig = Rig()
    await rig.box.run(waits(1))
    ask_id = rig.opened()[-1]["id"]
    rig.clock = NOW + timedelta(hours=1)
    rig.waiting.fire_due()
    rig.waiting.fire_due()  # before the adopted decision has settled
    await rig.settle()
    assert len(ended(rig)) == 1
    assert len(rig.work.events_of_kind(ask_id, "decided")) == 1


async def test_after_expiry_the_same_call_opens_a_new_ask():
    rig = Rig()
    await rig.box.run(waits(1))
    rig.clock = NOW + timedelta(hours=1)
    rig.waiting.fire_due()
    await rig.settle()
    await rig.box.run(waits(1))
    assert len(rig.opened()) == 2  # the claim was released with the end


async def test_one_bad_row_does_not_stop_the_others_from_expiring(monkeypatch):
    rig = Rig()
    for rid in ("bad", "good"):
        rig.work.create(
            "ask",
            rid,
            id=rid,
            state="active",
            input={"name": "t", "input": {"n": 1}},
            due_at=NOW + timedelta(hours=1),
        )
    real = rig.approvals.record

    def record(**kw):
        if kw["ask_id"] == "bad":
            raise TransitionRefused("bad is not an ask with facts")
        real(**kw)

    monkeypatch.setattr(rig.approvals, "record", record)
    rig.clock = NOW + timedelta(hours=1)
    rig.waiting.fire_due()  # must not raise
    assert rig.work.get("good").state == "expired"
    assert rig.work.get("bad").state == "expired"  # left waiting_asks, so it cannot recur


async def test_an_unexpected_error_on_one_row_is_logged_and_skipped(monkeypatch):
    rig = Rig()
    for rid in ("bad", "good"):
        rig.work.create(
            "ask",
            rid,
            id=rid,
            state="active",
            input={"name": "t", "input": {"n": 1}},
            due_at=NOW + timedelta(hours=1),
        )
    real = rig.approvals.record

    def record(**kw):
        if kw["ask_id"] == "bad":
            raise RuntimeError("boom")
        real(**kw)

    monkeypatch.setattr(rig.approvals, "record", record)
    rig.clock = NOW + timedelta(hours=1)
    rig.waiting.fire_due()
    assert rig.work.get("good").state == "expired"


async def test_expired_ask_runs_nothing():
    rig = Rig()
    await rig.box.run(waits(1))
    ask_id = rig.opened()[-1]["id"]
    rig.clock = NOW + timedelta(hours=1)
    rig.waiting.fire_due()
    await rig.settle()
    with pytest.raises(RpcError) as err:  # a late yes finds a closed ask
        rig.asks.answer(ask_id, "allow", "desktop")
    assert err.value.code == ErrorCode.not_found
    assert rig.source.ran == []


async def test_expiry_of_an_ask_no_longer_live_is_logged_directly():
    rig = Rig()
    row = rig.work.create(
        "ask",
        "Do it",
        id="old",
        state="active",
        input={"name": "t", "input": {"n": 1}, "text": "Go."},
        due_at=NOW + timedelta(hours=1),
    )
    rig.work.add_ask(row.id, source="scout_tool", tool="t", summary="Do it", input={"n": 1})
    rig.clock = NOW + timedelta(hours=1)
    rig.waiting.fire_due()
    assert rig.work.get("old").state == "expired"
    assert rig.work.ask_detail("old")["decided_by"] == "none"
    [event] = ended(rig)
    assert event.facts == {
        "ask": "old",
        "tool": "t",
        "summary": "Do it",
        "outcome": "expired",
        "reason": "no answer",
    }


async def test_default_wait_is_three_days():
    rig = Rig()
    await rig.box.run(call())
    ask_id = rig.opened()[-1]["id"]
    assert rig.work.get(ask_id).due_at == (NOW + timedelta(days=3)).isoformat(timespec="seconds")


async def test_one_timer_is_armed_for_the_earliest_moment_and_dropped_when_idle():
    rig = Rig()
    assert rig.waiting._handle is None
    await rig.box.run(waits(3))
    assert rig.waiting._handle is not None
    ask_id = rig.opened()[-1]["id"]
    rig.asks.answer(ask_id, "allow", "desktop")
    await rig.settle()
    assert rig.waiting._handle is None
