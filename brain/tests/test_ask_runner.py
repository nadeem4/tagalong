"""Tests for Scout's asks as open items: a turn never waits for a card, and an answer runs the
saved call later through the same gate, even when the turn that raised it is gone.

Everything runs on fakes: a fake body list, a fake source that records what ran, and the real
toolbox, engine, asks, open items and approvals wired the way a session wires them.
"""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from brain import permission
from brain.approvals import Approvals
from brain.asks import Asks
from brain.events import Event
from brain.memory import Memory
from brain.mind.turn import Call
from brain.open_item_runner import AskRunner
from brain.open_items import OpenItems
from brain.permission import AskOpen, Engine, Person, StandingRule, stored_auto_rules
from brain.protocol import RpcError
from brain.store.work import WorkStore
from brain.toolbox import Toolbox, ToolSpec

NOW = datetime(2026, 11, 11, 9, 0, 0, tzinfo=UTC)


class Bodies:
    def __init__(self, online=("desktop",)):
        self.online = list(online)
        self.sent: list[dict] = []

    def display_ids(self):
        return list(self.online)

    def notify(self, method, params):
        self.sent.append(dict(params))


class Source:
    def __init__(self, *names, effect="change"):
        self._specs = [ToolSpec(n, f"{n} tool", {"type": "object"}, effect=effect) for n in names]
        self.ran: list[tuple[str, dict]] = []

    def specs(self):
        return list(self._specs)

    def known_specs(self):
        return list(self._specs)

    async def run(self, call, tool):
        self.ran.append((tool, call.input))
        return f"ran {tool}"

    def unavailable(self, name):
        return None


class Rig:
    def __init__(self, memory=None, clock=None, effect="change"):
        self.clock = clock or [NOW]
        self.memory = memory or Memory(":memory:")
        self.work = WorkStore(self.memory.db, lambda: NOW)
        self.bodies = Bodies()
        self.asks = Asks(self.bodies, self.work)
        self.approvals = Approvals(self.memory, self.work, lambda m, p: None, lambda: NOW)
        self.items = OpenItems(self.memory.db, lambda: self.clock[0])
        self.stored: dict[str, str] = {}
        self.events: list[Event] = []
        self.source = Source("t", effect=effect)
        self.engine = Engine(
            [StandingRule(stored_auto_rules(lambda: self.stored)), Person()],
            self.approvals,
            None,
            lambda name: self.stored.__setitem__(name, "auto"),
        )
        self.runner = AskRunner(
            self.items,
            self.asks,
            lambda: self.box,
            lambda event, on_start=None: self.events.append(event),
            lambda: self.clock[0],
            self.approvals,
        )
        self.asks.on_item_answer = self.runner.answered
        self.box = Toolbox(
            [self.source],
            lambda: self.stored,
            self.stored.__setitem__,
            self.asks,
            self.engine,
            runner=self.runner,
        )

    def opened(self):
        return [p for p in self.bodies.sent if p["state"] == "open"]

    def closed(self):
        return [p for p in self.bodies.sent if p["state"] == "closed"]

    async def settle(self):
        for _ in range(30):
            await asyncio.sleep(0)


def call(n=1, text="Doing it.", turn="t1"):
    return Call(id="c1", name="t", input={"n": n}, turn=turn, text=text)


async def test_ask_returns_open_without_waiting():
    rig = Rig()
    out = await asyncio.wait_for(rig.box.run(call()), 1)
    [card] = rig.opened()
    [item] = rig.items.list_open(kind="ask")
    assert card["id"] == item.id and "turn" not in card
    assert item.saved_call["name"] == "t" and item.saved_call["input"] == {"n": 1}
    assert item.deadline_at == NOW + timedelta(days=3)
    assert item.id in out and "do not call it again" in out
    assert rig.source.ran == []


async def test_answer_after_turn_cancel_runs_saved_call():
    rig = Rig()
    turn = asyncio.create_task(rig.box.run(call()))
    await rig.settle()
    turn.cancel()  # the turn is over before the person answers
    await asyncio.gather(turn, return_exceptions=True)
    [card] = rig.opened()
    rig.asks.answer(card["id"], "allow", "desktop")
    await rig.settle()
    assert rig.source.ran == [("t", {"n": 1})]
    assert rig.items.get(card["id"]).state == "done"
    [wake] = rig.events
    assert (wake.kind, wake.facts["outcome"], wake.facts["result"]) == (
        "ask_ended",
        "approved",
        "ran t",
    )
    assert rig.work.ask_detail(card["id"])["decided_by"] == "person"
    assert rig.work.get(card["id"]).end_reason == "approved"


async def test_cancel_does_not_close_open_ask():
    rig = Rig()
    turn = asyncio.create_task(rig.box.run(call()))
    await rig.settle()
    turn.cancel()
    await asyncio.gather(turn, return_exceptions=True)
    [item] = rig.items.list_open(kind="ask")
    assert rig.closed() == [] and rig.asks.is_open(item.id)


def test_no_park_after_constant_exists():
    assert not hasattr(permission, "PARK_AFTER_S")
    assert not hasattr(Asks, "park")


async def test_denial_still_refuses_and_scout_words_it():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.asks.answer(card["id"], "deny", "desktop")
    await rig.settle()
    assert rig.source.ran == []
    [wake] = rig.events
    assert (wake.facts["outcome"], wake.facts["reason"]) == ("refused", "the person said no")
    assert rig.work.get(card["id"]).end_reason == "refused"
    assert rig.items.get(card["id"]).state == "done"


async def test_the_same_call_again_is_the_same_open_item():
    rig = Rig()
    first = await rig.box.run(call())
    again = await rig.box.run(call(text="Again."))
    assert first == again
    assert len(rig.items.list_open(kind="ask")) == 1 and len(rig.opened()) == 1


async def test_a_tool_turned_off_since_refuses_the_late_yes():
    rig = Rig()
    await rig.box.run(call())
    rig.stored["t"] = "off"
    rig.asks.answer(rig.opened()[0]["id"], "allow", "desktop")
    await rig.settle()
    assert rig.source.ran == []
    assert rig.events[0].facts["outcome"] == "refused"


async def test_a_call_that_held_a_secret_runs_from_the_raw_copy_in_the_same_process():
    rig = Rig()
    rig.approvals.mask = lambda value: {**value, "input": {"n": "[secret]"}}
    await rig.box.run(call())
    [item] = rig.items.list_open(kind="ask")
    assert item.saved_call["input"] == {"n": "[secret]"}  # nothing unmasked is saved
    rig.asks.answer(rig.opened()[0]["id"], "allow", "desktop")
    await rig.settle()
    assert rig.source.ran == [("t", {"n": 1})]
    assert rig.events[0].facts["outcome"] == "approved"


async def test_a_call_that_held_a_secret_fails_after_a_restart():
    rig = Rig()
    rig.approvals.mask = lambda value: {**value, "input": {"n": "[secret]"}}
    await rig.box.run(call())
    again = Rig(rig.memory)
    again.runner.rejoined()
    await again.settle()
    again.asks.answer(again.opened()[0]["id"], "allow", "desktop")
    await again.settle()
    assert again.source.ran == []
    assert again.events[0].facts["reason"] == "held a secret"


async def test_deny_wins_even_when_the_tool_became_auto_since():
    rig = Rig(effect="read")
    rig.stored["t"] = "ask"  # a read tool is auto by itself; the owner made it ask
    await rig.box.run(call())
    [card] = rig.opened()
    del rig.stored["t"]  # now it is auto again

    rig.asks.answer(card["id"], "deny", "desktop")
    await rig.settle()
    assert rig.source.ran == []
    assert rig.events[0].facts["outcome"] == "refused"
    assert rig.work.get(card["id"]).end_reason == "refused"


async def test_a_notice_wakes_scout_at_two_thirds_of_the_wait_once():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.clock[0] = NOW + timedelta(days=2, minutes=1)  # past 2/3 of 3 days
    rig.runner.fire_due()
    rig.runner.fire_due()
    [notice] = [e for e in rig.events if e.kind == "ask_notice"]
    assert notice.facts["ask"] == card["id"] and notice.facts["left_s"] < 86400
    assert rig.items.get(card["id"]).state == "open"
    rig.asks.answer(card["id"], "allow", "desktop")
    await rig.settle()
    assert [e.kind for e in rig.events] == ["ask_notice", "ask_ended"]


async def test_no_answer_by_the_deadline_expires_it_and_tells_scout():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.clock[0] = NOW + timedelta(days=3)
    rig.runner.fire_due()
    assert [(c["id"], c["reason"]) for c in rig.closed()] == [(card["id"], "timeout")]
    assert rig.items.get(card["id"]).state == "expired"
    assert rig.events[0].facts["outcome"] == "expired"
    assert rig.work.get(card["id"]).end_reason == "expired"
    with pytest.raises(RpcError):
        rig.asks.answer(card["id"], "allow", "desktop")


async def test_restart_closes_an_answered_item_it_cannot_vouch_for():
    rig = Rig()
    await rig.box.run(call())
    [item] = rig.items.list_open(kind="ask")
    rig.items.answer(item.id, "allow", "desktop")  # the brain died before the call finished
    again = Rig(rig.memory)
    again.runner.start()
    assert again.items.get(item.id).state == "done"
    assert again.source.ran == []
    assert again.events[0].facts["outcome"] == "failed"


async def test_a_card_comes_back_when_a_body_joins_after_a_restart():
    rig = Rig()
    await rig.box.run(call())
    [item] = rig.items.list_open(kind="ask")
    again = Rig(rig.memory)
    again.runner.start()
    again.runner.rejoined()
    await again.settle()
    [card] = again.opened()
    assert card["id"] == item.id and card["tool"] == "t"
    again.asks.answer(item.id, "allow", "desktop")
    await again.settle()
    assert again.source.ran == [("t", {"n": 1})]


async def test_an_ask_that_needs_nobody_runs_in_the_turn():
    rig = Rig()
    rig.stored["t"] = "auto"
    assert await rig.box.run(call()) == "ran t"
    assert rig.items.list_open() == []


def test_ask_open_is_not_a_failure():
    assert not issubclass(AskOpen, RpcError)
