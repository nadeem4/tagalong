"""Tests for Scout asks that outlive their turn: parking, a later yes, the same call again.

Everything runs on fakes: a fake body list, a fake source that records what ran, and the real
toolbox, engine, asks and work rows wired the way a session wires them.
"""

import asyncio
from datetime import UTC, datetime

import pytest

from brain.approvals import Approvals
from brain.asks import Asks
from brain.events import Event
from brain.memory import Memory
from brain.mind.turn import Call
from brain.permission import Engine, Person, StandingRule, stored_auto_rules
from brain.protocol import ErrorCode, RpcError
from brain.store.work import WorkStore
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


class Rig:
    def __init__(self, online=("desktop",), headless=(), park_after=0.05, names=("t",)):
        self.memory = Memory(":memory:")
        self.work = WorkStore(self.memory.db, now)
        self.bodies = Bodies(online, headless)
        self.asks = Asks(self.bodies, self.work)
        self.approvals = Approvals(self.memory, self.work, lambda m, p: None, now)
        self.stored: dict[str, str] = {}
        self.events: list[Event] = []
        self.source = Source(*names)
        self.engine = Engine(
            [StandingRule(stored_auto_rules(lambda: self.stored)), Person()],
            self.approvals,
            None,
            lambda name: self.stored.__setitem__(name, "auto"),
            now=now,
        )
        self.waiting = WaitingAsks(self.work, self.asks, lambda: self.box, self.events.append, now)
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
