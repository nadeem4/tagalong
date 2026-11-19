"""Tests for Scout's asks as open items: a turn never waits for a card, and an answer runs the
saved call later through the same gate, even when the turn that raised it is gone.

Everything runs on fakes: a fake body list, a fake source that records what ran, and the real
toolbox, engine, asks, open items and approvals wired the way a session wires them.
"""

import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest

from brain import permission
from brain.approvals import Approvals
from brain.asks import Asks
from brain.events import Event
from brain.holds import Holds
from brain.memory import Memory
from brain.mind.turn import Call
from brain.open_item_runner import AskRunner
from brain.open_items import OpenItems
from brain.permission import (
    AskOpen,
    Engine,
    Person,
    SideCheckDecider,
    StandingRule,
    stored_auto_rules,
)
from brain.protocol import ErrorCode, RpcError
from brain.setup.flights import not_for_home
from brain.store import rules
from brain.store.work import WorkStore
from brain.tasks import Tasks, TaskStopHooks
from brain.toolbox import Toolbox, ToolSpec
from brain.tools import preference_tools

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
    def __init__(self, *names, effect="change", task_kinds=None, deny_stops=()):
        kinds = task_kinds or {}
        self._specs = [
            ToolSpec(
                n,
                f"{n} tool",
                {"type": "object"},
                effect=effect,
                task_kind=kinds.get(n),
                deny_stops_task=n in deny_stops,
            )
            for n in names
        ]
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
        self.asks = Asks(self.bodies)
        self.approvals = Approvals(self.memory, self.work, lambda m, p: None, lambda: NOW)
        self.items = OpenItems(self.memory.db, lambda: self.clock[0])
        self.stored: dict[str, str] = {}
        self.events: list[Event] = []  # what Scout is told
        self.answers: list[Event] = []  # the person's saved card answers
        self.finished: list[tuple[list[str], str]] = []  # events code ended, and how
        self.tasks = Tasks(
            self.memory.db,
            lambda text: text,
            lambda: self.clock[0],
            items=self.items,
            post=self.events.append,
        )
        if self.tasks.get("k1") is None:  # the task turn t1 works on
            self.tasks.open("do", "desktop", id="k1", title="Fix it")
        self.source = Source(
            "t", "h", "r", effect=effect, task_kinds={"h": "do"}, deny_stops=("r",)
        )
        self.engine = Engine(
            [StandingRule(stored_auto_rules(lambda: self.stored)), Person()],
            self.approvals,
            None,
            lambda name: self.stored.__setitem__(name, "auto"),
        )
        self.holds = Holds(self.asks, self.work, self.items, self.tasks)
        self.tasks.hooks = TaskStopHooks(close_cards=self.holds.close)
        self.runner = AskRunner(
            self.items,
            self.asks,
            lambda: self.box,
            self.events.append,
            lambda: self.clock[0],
            self.approvals,
            tasks=self.tasks,
            task=lambda turn: "k1" if turn == "t1" else None,
            cause=lambda turn: "evt-ask-turn" if turn == "t1" else None,
            close_cards=self.holds.close,
        )
        # What the session does for every answer: save the event, handled by code, no turn.

        def saved(ask, option, body):
            event = Event("card_answer", body, {"ask": ask, "option": option})
            self.answers.append(event)
            self.finished.append(([event.id], "handled"))

        self.asks.on_item_answer = saved
        self.asks.register(
            "ask", lambda ask, opt, body, _text, at: self.runner.answered(ask, opt, body, at)
        )
        self.box = Toolbox(
            [self.source],
            lambda: self.stored,
            self.stored.__setitem__,
            self.holds,
            self.engine,
            runner=self.runner,
            tasks=self.tasks,
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


async def test_a_card_answer_event_is_handled_without_a_turn():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.asks.answer(card["id"], "allow", "desktop")
    await rig.settle()
    [answer] = rig.answers
    assert (answer.source, answer.payload) == ("desktop", {"ask": card["id"], "option": "allow"})
    assert rig.finished == [([answer.id], "handled")]  # code handled it: no turn takes it
    assert rig.source.ran == [("t", {"n": 1})]  # the saved call ran


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
    assert (wake.kind, wake.payload["outcome"], wake.payload["result"]) == (
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
    assert (wake.payload["outcome"], wake.payload["reason"]) == ("refused", "the person said no")
    assert rig.work.get(card["id"]).end_reason == "refused"
    assert rig.items.get(card["id"]).state == "done"


async def test_the_same_call_again_is_the_same_open_item():
    rig = Rig()
    first = await rig.box.run(call())
    again = await rig.box.run(call(text="Again."))
    assert first == again
    assert len(rig.items.list_open(kind="ask")) == 1 and len(rig.opened()) == 1


def hand(extra=None, id="h1"):
    return Call(id=id, name="h", input={"n": 1, **(extra or {})}, turn="t1", text="Handing off.")


def do_tasks(rig):
    return rig.memory.db.execute("SELECT COUNT(*) FROM tasks WHERE kind='do'").fetchone()[0]


async def test_two_identical_hand_offs_in_a_turn_are_one_card_and_one_task():
    rig = Rig()
    before = do_tasks(rig)
    first = await rig.box.run(hand())
    again = await rig.box.run(hand(id="h2"))
    assert first == again
    assert len(rig.items.list_open(kind="ask")) == 1 and len(rig.opened()) == 1
    assert do_tasks(rig) == before + 1


async def test_a_repeat_hand_off_after_card_due_moves_the_check_back_on_the_same_card():
    rig = Rig()
    await rig.box.run(hand())
    [card] = rig.opened()
    rig.clock[0] = NOW + timedelta(days=2, minutes=1)
    rig.runner.fire_due()
    assert rig.items.get(card["id"]).check_back_at is None
    await rig.box.run(hand({"check_back_minutes": 30}, id="h2"))
    assert len(rig.items.list_open(kind="ask")) == 1
    assert rig.items.get(card["id"]).check_back_at == rig.clock[0] + timedelta(minutes=30)


async def test_a_restart_that_closes_an_answered_hand_off_drops_its_new_task():
    rig = Rig()
    before = do_tasks(rig)
    await rig.box.run(hand())
    [card] = rig.opened()
    item = rig.items.get(card["id"])
    assert rig.tasks.get(item.task_id).state == "waiting"
    rig.items.answer(card["id"], "allow", "desktop")  # answered, then the brain restarts
    again = Rig(rig.memory, clock=rig.clock)
    again.runner.start()
    assert again.tasks.get(item.task_id).state == "stopped"
    assert do_tasks(again) == before + 1


async def test_a_tool_turned_off_since_refuses_the_late_yes():
    rig = Rig()
    await rig.box.run(call())
    rig.stored["t"] = "off"
    rig.asks.answer(rig.opened()[0]["id"], "allow", "desktop")
    await rig.settle()
    assert rig.source.ran == []
    assert rig.events[0].payload["outcome"] == "refused"


async def test_a_call_that_held_a_secret_runs_from_the_raw_copy_in_the_same_process():
    rig = Rig()
    rig.approvals.mask = lambda value: {**value, "input": {"n": "[secret]"}}
    await rig.box.run(call())
    [item] = rig.items.list_open(kind="ask")
    assert item.saved_call["input"] == {"n": "[secret]"}  # nothing unmasked is saved
    rig.asks.answer(rig.opened()[0]["id"], "allow", "desktop")
    await rig.settle()
    assert rig.source.ran == [("t", {"n": 1})]
    assert rig.events[0].payload["outcome"] == "approved"


async def test_a_call_that_held_a_secret_fails_after_a_restart():
    rig = Rig()
    rig.approvals.mask = lambda value: {**value, "input": {"n": "[secret]"}}
    await rig.box.run(call())
    again = Rig(rig.memory)
    again.runner.returned(None)
    await again.settle()
    again.asks.answer(again.opened()[0]["id"], "allow", "desktop")
    await again.settle()
    assert again.source.ran == []
    assert again.events[-1].payload["reason"] == "held a secret"


async def test_deny_wins_even_when_the_tool_became_auto_since():
    rig = Rig(effect="read")
    rig.stored["t"] = "ask"  # a read tool is auto by itself; the owner made it ask
    await rig.box.run(call())
    [card] = rig.opened()
    del rig.stored["t"]  # now it is auto again

    rig.asks.answer(card["id"], "deny", "desktop")
    await rig.settle()
    assert rig.source.ran == []
    assert rig.events[0].payload["outcome"] == "refused"
    assert rig.work.get(card["id"]).end_reason == "refused"


async def test_a_card_due_wakes_scout_at_two_thirds_of_the_wait_once():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.clock[0] = NOW + timedelta(days=2, minutes=1)  # past 2/3 of 3 days
    rig.runner.fire_due()
    rig.runner.fire_due()
    [due] = [e for e in rig.events if e.kind == "card_due"]
    assert due.payload["ask"] == card["id"] and due.payload["left_s"] < 86400
    assert (due.payload["urgent"], due.task, due.caused_by) == (False, "k1", "evt-ask-turn")
    assert rig.items.get(card["id"]).state == "open"
    rig.asks.answer(card["id"], "allow", "desktop")
    await rig.settle()
    assert [e.kind for e in rig.events] == ["card_due", "ask_ended"]


async def test_a_restart_does_not_repeat_a_card_due_already_told():
    rig = Rig()
    await rig.box.run(call())
    rig.clock[0] = NOW + timedelta(days=2, minutes=1)
    rig.runner.fire_due()
    again = Rig(rig.memory, clock=rig.clock)
    again.runner.start()
    assert [e.kind for e in again.events] == []


async def test_not_now_without_a_time_checks_back_in_30_minutes():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.asks.answer(card["id"], "not_now", "desktop")
    await rig.settle()
    assert rig.items.get(card["id"]).state == "open" and rig.closed() == []
    assert not rig.finished or rig.finished == [([rig.answers[0].id], "handled")]
    assert rig.events == []  # no turn, no ask_ended
    rig.clock[0] = NOW + timedelta(minutes=29)
    rig.runner.fire_due()
    assert rig.events == []
    rig.clock[0] = NOW + timedelta(minutes=30)
    rig.runner.fire_due()
    [due] = rig.events
    assert (due.kind, due.payload["ask"]) == ("card_due", card["id"])


async def test_a_person_set_check_back_is_not_moved_by_scout():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    at = NOW + timedelta(hours=5)
    rig.runner.answered(card["id"], "not_now", "desktop", at)
    await rig.settle()
    again = Call(id="c2", name="t", input={"n": 1, "check_back_minutes": 60}, turn="t1", text="")
    await rig.box.run(again)  # Scout opens the same call again, with its own idea of when
    assert rig.items.get(card["id"]).check_back_at == at
    assert rig.items.get(card["id"]).check_back_by == "person"


async def test_check_back_minutes_and_urgent_come_from_the_call_arguments():
    rig = Rig()
    c = Call(
        id="c1",
        name="t",
        input={"n": 1, "check_back_minutes": 10, "urgent": True},
        turn="t1",
        text="",
    )
    await rig.box.run(c)
    [card] = rig.opened()
    assert (card["check_back_by"], card["urgent"]) == ("scout", True)
    item = rig.items.get(card["id"])
    assert item.check_back_at == NOW + timedelta(minutes=10)
    assert item.saved_call["input"] == {"n": 1}  # the arguments are the gate's, not the tool's
    rig.clock[0] = NOW + timedelta(minutes=11)
    rig.runner.fire_due()
    assert rig.events[0].payload["urgent"] is True


async def test_a_card_answered_after_restart_runs_once_under_its_task():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    again = Rig(rig.memory, clock=rig.clock)
    again.runner.start()
    again.runner.answered(card["id"], "allow", "desktop")
    again.runner.answered(card["id"], "allow", "desktop")  # a second tap changes nothing
    await again.settle()
    assert again.source.ran == [("t", {"n": 1})]
    [ended] = [e for e in again.events if e.kind == "ask_ended"]
    assert (ended.task, ended.payload["outcome"]) == ("k1", "approved")


async def test_stop_task_closes_the_card_and_posts_task_stop():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.asks.answer(card["id"], "stop_task", "desktop")
    await rig.settle()
    assert rig.items.get(card["id"]).state == "done"
    assert rig.items.for_task("k1") == []
    assert rig.tasks.get("k1").state == "stopped"
    [stop] = [e for e in rig.events if e.kind == "task_stop"]
    assert (stop.payload, stop.source) == ({"task": "k1", "by": "desktop"}, "desktop")
    assert rig.source.ran == []
    assert [e.kind for e in rig.events] == ["task_stop"]  # no ask_ended: the task is over


async def test_no_on_the_recheck_card_stops_the_task():
    rig = Rig()
    await rig.box.run(Call(id="c1", name="r", input={"job": "j1"}, turn="t1", text="Still on?"))
    [card] = rig.opened()
    rig.asks.answer(card["id"], "deny", "desktop")
    await rig.settle()
    assert rig.tasks.get("k1").state == "stopped"
    assert rig.items.for_task("k1") == []
    assert rig.source.ran == []
    assert [e.kind for e in rig.events] == ["task_stop"]


async def test_no_on_an_ordinary_card_leaves_the_task_open():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.asks.answer(card["id"], "deny", "desktop")
    await rig.settle()
    assert rig.tasks.get("k1").state != "stopped"


async def test_stop_task_on_an_ask_card_releases_a_held_expert_card_of_the_task():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.work.create("goal", "a job", id="j1", state="active", task_id="k1")
    held = asyncio.ensure_future(
        rig.holds.ask(kind="question", text="Which?", options=["A"], ask_id="x1", job_id="j1")
    )
    await asyncio.sleep(0)
    assert rig.asks.is_open("x1")
    rig.asks.answer(card["id"], "stop_task", "desktop")
    await rig.settle()
    with pytest.raises(RpcError) as err:
        await held
    assert err.value.code == ErrorCode.cancelled
    assert not rig.asks.is_open("x1")


async def test_stop_task_on_a_card_whose_task_already_ended_still_tells_scout():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.tasks.end("k1", "done")
    rig.asks.answer(card["id"], "stop_task", "desktop")
    await rig.settle()
    [ended] = [e for e in rig.events if e.kind == "ask_ended"]
    assert (ended.payload["ask"], ended.payload["outcome"]) == (card["id"], "refused")
    assert rig.source.ran == []


async def test_an_ask_task_card_shows_no_task_and_no_stop_option():
    rig = Rig()
    rig.tasks.open("ask", "desktop", id="k2", title="Say")
    rig.runner._task = lambda turn: "k2"
    await rig.box.run(call())
    [card] = rig.opened()
    assert "task" not in card and "check_back_at" not in card
    assert card["options"] == ["allow", "always", "deny"]


async def test_a_yes_just_after_the_deadline_ends_it_like_the_timer_would():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.clock[0] = NOW + timedelta(days=3, seconds=1)  # due, the timer has not fired yet
    rig.asks.answer(card["id"], "allow", "desktop")
    await rig.settle()
    assert rig.source.ran == []
    assert [e.kind for e in rig.events] == ["card_expired"]
    assert rig.work.get(card["id"]).end_reason == "expired"
    assert card["id"] not in rig.runner._raw
    rig.runner.fire_due()
    assert len(rig.events) == 1  # not told twice


async def test_an_expired_card_posts_card_expired():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.clock[0] = NOW + timedelta(days=3)
    rig.runner.fire_due()
    assert [(c["id"], c["reason"]) for c in rig.closed()] == [(card["id"], "timeout")]
    assert rig.items.get(card["id"]).state == "expired"
    assert rig.events[0].kind == "card_expired"
    assert rig.events[0].payload["reason"] == "no answer"
    assert rig.work.get(card["id"]).end_reason == "expired"
    with pytest.raises(RpcError):
        rig.asks.answer(card["id"], "allow", "desktop")


def made_for_it(rig):
    """A call whose task the gate opened for it (as for a hand-off): the card belongs to it."""
    rig.tasks.open("do", "desktop", id="k2", title="Fix the build")
    return Call("c1", "t", {"n": 1, "task_id": "k2", "new_task": True}, "t1", "Doing it.")


async def test_a_card_belongs_to_the_task_its_call_names():
    rig = Rig()
    await rig.box.run(made_for_it(rig))
    [card] = rig.opened()
    assert rig.items.get(card["id"]).task_id == "k2"


async def test_a_no_ends_the_task_made_for_the_call():
    rig = Rig()
    await rig.box.run(made_for_it(rig))
    [card] = rig.opened()
    rig.asks.answer(card["id"], "deny", "desktop")
    await rig.settle()
    assert rig.tasks.get("k2").state == "stopped" and rig.tasks.get("k1").state == "open"


async def test_an_expired_card_ends_the_task_made_for_the_call():
    rig = Rig()
    await rig.box.run(made_for_it(rig))
    rig.clock[0] = NOW + timedelta(days=3)
    rig.runner.fire_due()
    assert rig.tasks.get("k2").state == "stopped"


async def test_a_no_keeps_a_task_the_call_only_named():
    rig = Rig()
    await rig.box.run(Call("c1", "t", {"n": 1, "task_id": "k1"}, "t1", "Doing it."))
    [card] = rig.opened()
    rig.asks.answer(card["id"], "deny", "desktop")
    await rig.settle()
    assert rig.tasks.get("k1").state == "open"


async def test_restart_closes_an_answered_item_it_cannot_vouch_for():
    rig = Rig()
    await rig.box.run(call())
    [item] = rig.items.list_open(kind="ask")
    rig.items.answer(item.id, "allow", "desktop")  # the brain died before the call finished
    again = Rig(rig.memory)
    again.runner.start()
    assert again.items.get(item.id).state == "done"
    assert again.source.ran == []
    assert again.events[0].payload["outcome"] == "failed"


async def test_a_card_comes_back_when_a_body_joins_after_a_restart():
    rig = Rig()
    await rig.box.run(call())
    [item] = rig.items.list_open(kind="ask")
    again = Rig(rig.memory)
    again.runner.start()
    again.runner.returned(None)
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


async def test_reconnect_reshows_open_cards():
    rig = Rig()
    await rig.box.run(call())
    [item] = rig.items.list_open(kind="ask")
    rig.bodies.sent.clear()
    rig.runner.returned(None)  # the card is up already: no second one
    await rig.settle()
    assert rig.opened() == [] and rig.events == []
    rig.asks.expire(item.id, "x")  # the body dropped it while away
    rig.bodies.sent.clear()
    rig.runner.returned(3600)
    await rig.settle()
    assert [c["id"] for c in rig.opened()] == [item.id]


async def test_live_only_shown_expired_on_return():
    rig = Rig()
    gone = rig.items.open("expert_ask", live_only=True)
    rig.clock[0] = NOW + timedelta(minutes=5)
    rig.items.expire_live_only()  # its expert ended while the person was away
    rig.clock[0] = NOW + timedelta(minutes=10)
    rig.runner.returned(600)
    await rig.settle()
    assert rig.closed() == [{"id": gone.id, "state": "closed", "reason": "timeout"}]


async def test_return_wake_names_waiting_asks_and_their_age():
    rig = Rig()
    await rig.box.run(call())
    [item] = rig.items.list_open(kind="ask")
    again = Rig(rig.memory, clock=[NOW + timedelta(hours=5)])
    again.runner.start()
    again.runner.returned(18000)
    await again.settle()
    [wake] = [e for e in again.events if e.kind == "asks_waiting"]
    [row] = json.loads(wake.payload["asks"])
    assert wake.payload["count"] == 1
    assert (row["ask"], row["tool"], row["age_s"]) == (item.id, "t", 18000)


async def test_a_card_that_cannot_be_built_does_not_stop_the_others():
    rig = Rig()
    await rig.box.run(call(1))
    await rig.box.run(call(2))
    again = Rig(rig.memory)
    again.runner.start()
    real = again.box.ask_request
    seen = []

    async def flaky(c, spec, kind, **kw):
        seen.append(c.input["n"])
        if c.input["n"] == 1:
            raise ValueError("card broke")
        return await real(c, spec, kind, **kw)

    again.box.ask_request = flaky
    again.runner.returned(None)
    await again.settle()
    assert seen == [1, 2]
    [card] = again.opened()
    [wake] = [e for e in again.events if e.kind == "asks_waiting"]
    assert wake.payload["count"] == 1 and card["input"] == {"n": 2}


async def test_an_ask_opened_while_no_screen_was_up_is_told_on_return():
    rig = Rig()
    rig.bodies.online = []  # a WhatsApp-only wake turn: no display body
    await rig.box.run(call())
    [item] = rig.items.list_open(kind="ask")
    rig.clock[0] = NOW + timedelta(minutes=5)
    rig.runner.returned(600)  # the card was published already, so it counts as up
    await rig.settle()
    [wake] = [e for e in rig.events if e.kind == "asks_waiting"]
    [row] = json.loads(wake.payload["asks"])
    assert (row["ask"], row["age_s"]) == (item.id, 300)


class Look:
    """A side-check that waits for a gate, then grants or passes."""

    def __init__(self, gate, pref):
        self.gate = gate
        self.pref = pref

    async def decide(self, facts):
        await self.gate.wait()
        return self.pref


def with_side_check(rig, look):
    rig.engine = Engine(
        [
            StandingRule(stored_auto_rules(lambda: rig.stored)),
            SideCheckDecider(look),
            Person(),
        ],
        rig.approvals,
        None,
        lambda name: rig.stored.__setitem__(name, "auto"),
    )
    rig.box = Toolbox(
        [rig.source],
        lambda: rig.stored,
        rig.stored.__setitem__,
        Holds(rig.asks, rig.work, rig.items),
        rig.engine,
        runner=rig.runner,
    )


async def test_the_card_is_up_while_the_side_check_still_looks():
    rig = Rig()
    gate = asyncio.Event()
    with_side_check(rig, Look(gate, None))
    turn = asyncio.create_task(rig.box.run(call()))
    await rig.settle()
    [card] = rig.opened()  # on screen before the side-check returned
    assert not turn.done()
    gate.set()
    out = await asyncio.wait_for(turn, 1)
    assert card["id"] in out  # a pass leaves the same item open for the person
    assert [i.id for i in rig.items.list_open(kind="ask")] == [card["id"]]


async def test_a_side_check_yes_answers_the_item_and_closes_the_card():
    rig = Rig()
    gate = asyncio.Event()
    pref = rules.add_preference(
        rig.memory.db,
        sentence="Fine to run t",
        source=None,
        tool=None,
        group_key=None,
        at="2026-11-11T09:00:00Z",
    )
    with_side_check(rig, Look(gate, pref))
    turn = asyncio.create_task(rig.box.run(call()))
    await rig.settle()
    [card] = rig.opened()
    gate.set()
    assert await asyncio.wait_for(turn, 1) == "ran t"
    item = rig.items.get(card["id"])
    assert (item.state, item.answer) == ("done", "allow")
    assert rig.closed()[0]["reason"] == "answered" and rig.closed()[0]["by"] == "side_check"
    assert rig.closed()[0]["option"] == "allow"
    assert rig.items.list_open(kind="ask") == []


async def test_person_answers_first_then_side_check_yes_changes_nothing():
    rig = Rig()
    gate = asyncio.Event()
    pref = rules.add_preference(
        rig.memory.db,
        sentence="Fine to run t",
        source=None,
        tool=None,
        group_key=None,
        at="2026-11-11T09:00:00Z",
    )
    with_side_check(rig, Look(gate, pref))
    turn = asyncio.create_task(rig.box.run(call()))
    await rig.settle()
    [card] = rig.opened()
    rig.asks.answer(card["id"], "allow", "desktop")  # the person is first
    await rig.settle()
    gate.set()
    out = await asyncio.wait_for(turn, 1)
    await rig.settle()
    assert card["id"] in out and "waiting" in out  # the turn is told the ask is open
    assert len(rig.opened()) == 1  # no second card
    assert rig.source.ran == [("t", {"n": 1})]  # the saved call ran exactly once
    rows = rig.work.list_asks("all", 10, None)
    assert all(r.decided_by != "scout" for r in rows)


async def test_ask_ended_is_caused_by_the_asking_turn():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    rig.asks.answer(card["id"], "allow", "desktop")
    await rig.settle()
    [ended] = rig.events
    assert (ended.kind, ended.source, ended.caused_by) == ("ask_ended", "scout", "evt-ask-turn")


async def test_an_ask_outside_a_turn_saves_no_cause():
    # An expert's app call reaches the runner with turn "": it must not borrow a say's cause.
    rig = Rig()
    await rig.box.run(call(turn=""))
    [card] = rig.opened()
    rig.asks.answer(card["id"], "allow", "desktop")
    await rig.settle()
    [ended] = rig.events
    assert ended.caused_by is None


async def test_the_saved_cause_survives_a_restart():
    rig = Rig()
    await rig.box.run(call())
    [card] = rig.opened()
    again = Rig(rig.memory, clock=rig.clock)
    again.runner._cause = lambda turn: "other-turn"  # a new process has a different current turn
    again.runner.start()
    again.runner.answered(card["id"], "allow", "desktop")
    await again.settle()
    ended = [e for e in again.events if e.kind == "ask_ended"]
    assert ended and ended[0].caused_by == "evt-ask-turn"


async def _home_card(rig, n=1):
    home = Call(id=f"h{n}", name="t", input={"n": n, "id": f"app{n}"}, turn="", text="")
    spec, kind = rig.box.spec_named("t")
    req = await rig.box.ask_request(home, spec, kind, job_id=None, ask_id=f"x{n}")
    return rig.runner.open(home, req, timedelta(hours=1), home=True)


async def test_a_home_card_runs_as_a_press_and_does_not_wake_scout():
    # Home's setup card: the answer runs the saved call as a Home press (it opens no task), and
    # the install's own news tells the story, so Scout is not woken for it.
    rig = Rig()
    pressed: list[str | None] = []
    claim = not_for_home(lambda given, title: "task")

    async def run(call, tool):
        pressed.append(claim(None, "install"))
        return "ran"

    rig.source.run = run
    item = await _home_card(rig)
    assert rig.asks.is_open(item.id)
    rig.asks.answer(item.id, "allow", "desktop")
    await rig.settle()
    assert pressed == [None] and rig.items.get(item.id).state == "done"
    assert rig.events == []


async def test_a_home_card_that_is_denied_or_lapses_tells_scout_nothing():
    rig = Rig()
    denied = await _home_card(rig)
    rig.asks.answer(denied.id, "deny", "desktop")
    await rig.settle()
    assert rig.items.get(denied.id).state == "done" and rig.events == []
    lapsed = await _home_card(rig, 2)
    rig.clock[0] = NOW + timedelta(hours=2)
    rig.runner.fire_due()
    assert rig.items.get(lapsed.id).state == "expired" and rig.events == []


def _home_ends(rig):
    ends: list[tuple[str, str | None]] = []
    rig.runner.home_ended = lambda tool, args, token: ends.append((args["id"], token))
    return ends


async def test_a_home_card_that_ends_with_an_error_token_tells_home():
    rig = Rig()
    ends = _home_ends(rig)

    async def run(call, tool):
        return json.dumps({"error": "unknown_app", "detail": "x"})

    rig.source.run = run
    item = await _home_card(rig)
    rig.asks.answer(item.id, "allow", "desktop")
    await rig.settle()
    assert ends == [("app1", "unknown_app")] and rig.events == []


async def test_a_home_card_that_needs_env_or_raises_tells_home():
    rig = Rig()
    ends = _home_ends(rig)

    async def run(call, tool):
        if call.input["n"] == 1:
            return json.dumps({"id": "a", "status": "connected", "needs_env": ["KEY"]})
        raise RpcError(ErrorCode.tool_failed, "no")

    rig.source.run = run
    for n in (1, 2):
        item = await _home_card(rig, n)
        rig.asks.answer(item.id, "allow", "desktop")
        await rig.settle()
    assert ends == [("app1", "needs_env"), ("app2", "failed")]


async def test_a_home_card_that_is_denied_or_lapses_tells_home_and_a_clean_add_says_none():
    rig = Rig()
    ends = _home_ends(rig)
    denied = await _home_card(rig)
    rig.asks.answer(denied.id, "deny", "desktop")
    await rig.settle()
    await _home_card(rig, 2)
    rig.clock[0] = NOW + timedelta(hours=2)
    rig.runner.fire_due()
    rig.clock[0] = NOW
    ok = await _home_card(rig, 3)
    rig.asks.answer(ok.id, "allow", "desktop")
    await rig.settle()
    assert ends == [("app1", "denied"), ("app2", "lapsed"), ("app3", None)]


async def test_a_returning_body_is_not_told_of_home_cards():
    rig = Rig()
    await _home_card(rig)
    await rig.runner._return(3600)
    assert [e for e in rig.events if e.kind == "asks_waiting"] == []


class _PreferenceSource:
    """The real save_preference tool, served to the toolbox."""

    def __init__(self, approvals):
        self._tools = {s.name: (s, h) for s, h in preference_tools(approvals)}

    def specs(self):
        return [s for s, _ in self._tools.values()]

    known_specs = specs

    async def run(self, call, tool):
        return await self._tools[tool][1](call.input)

    def unavailable(self, name):
        return None


def _saved(rig):
    return [p.sentence for p in rules.list_preferences(rig.memory.db) if not p.builtin]


def _preference_rig():
    rig = Rig()
    rig.stored["save_preference"] = "auto"  # an "Always" rule
    rig.engine = Engine(  # a side-check that says yes to everything, beside the rule
        [StandingRule(stored_auto_rules(lambda: rig.stored)), _SayYes(), Person()],
        rig.approvals,
        None,
        lambda name: rig.stored.__setitem__(name, "auto"),
    )
    rig.box = Toolbox(
        [_PreferenceSource(rig.approvals)],
        lambda: rig.stored,
        rig.stored.__setitem__,
        rig.holds,
        rig.engine,
        runner=rig.runner,
        tasks=rig.tasks,
    )
    return rig


class _SayYes:
    name = "side_check"

    async def decide(self, req):
        return permission.Grant("side_check")


def _pref(sentence="  Prefer Claude Code  "):
    return Call(
        id="p1",
        name="save_preference",
        input={"sentence": sentence, "question": "Keep it?"},
        turn="t1",
        text="",
    )


async def test_save_preference_opens_a_card_a_rule_or_side_check_cannot_answer():
    rig = _preference_rig()
    out = await asyncio.wait_for(rig.box.run(_pref()), 1)
    [item] = rig.items.list_open(kind="ask")
    assert item.id in out and len(rig.opened()) == 1
    assert _saved(rig) == []  # nothing is kept until the person answers


async def test_allowing_the_preference_card_saves_exactly_the_shown_sentence():
    rig = _preference_rig()
    await rig.box.run(_pref())
    [card] = rig.opened()
    assert "Prefer Claude Code" in json.dumps(card)
    rig.asks.answer(card["id"], "allow", "desktop")
    await rig.settle()
    assert _saved(rig) == ["Prefer Claude Code"]


async def test_denying_the_preference_card_saves_nothing():
    rig = _preference_rig()
    await rig.box.run(_pref())
    [card] = rig.opened()
    rig.asks.answer(card["id"], "deny", "desktop")
    await rig.settle()
    assert _saved(rig) == []
    assert rig.items.get(card["id"]).state == "done"
