"""Checks the cards: open shape, answers by kind, first-answer-wins, close and cancel.

A fake Bodies records notify() calls so no sockets are needed; every frame is also
validated against the contract's AskParams.
"""

import asyncio

import pytest

from brain.asks import Asks
from brain.mind.turn import Call
from brain.protocol import AskParams, ErrorCode, RpcError


class FakeBodies:
    def __init__(self, online: list[str] | None = None) -> None:
        self.online = ["desktop"] if online is None else online
        self.headless: set[str] = set()
        self.sent: list[tuple[str, dict]] = []

    def display_ids(self) -> list[str]:
        return [i for i in self.online if i not in self.headless]

    def notify(self, method: str, params: dict) -> None:
        AskParams.model_validate({**params, "seq": 1})
        self.sent.append((method, params))


def call(text: str = "Opening it.") -> Call:
    return Call(id="c1", name="desktop__x", input={"a": 1}, turn="t1", text=text)


async def opened(bodies: FakeBodies) -> dict:
    for _ in range(20):
        if bodies.sent:
            return bodies.sent[0][1]
        await asyncio.sleep(0)
    raise AssertionError("no ask was opened")


def test_anyone_online_follows_bodies():
    assert Asks(FakeBodies(["desktop"])).anyone_online() is True


async def test_closed_frame_names_the_answering_body():
    bodies = FakeBodies()
    asks = Asks(bodies)
    asks.show("a1", call(), "desktop__x", False)
    params = await opened(bodies)
    asks.answer(params["id"], "allow", "extension")
    assert bodies.sent[-1][1] == {
        "id": params["id"],
        "state": "closed",
        "reason": "answered",
        "option": "allow",
        "by": "extension",
    }


async def test_open_asks_lists_only_open():
    bodies = FakeBodies()
    asks = Asks(bodies)
    asks.show("a1", call(), "desktop__x", False)
    params = await opened(bodies)
    assert asks.open_asks() == [params]
    asks.answer(params["id"], "deny", "desktop")
    assert asks.open_asks() == []


async def test_open_asks_returns_copies():
    bodies = FakeBodies()
    asks = Asks(bodies)
    asks.show("a1", call(), "desktop__x", False)
    params = await opened(bodies)
    asks.open_asks()[0]["options"] = ["tampered"]
    assert asks.open_asks()[0]["options"] == ["allow", "always", "deny"]
    asks.answer(params["id"], "deny", "desktop")


def test_free_text_accepts_unlisted_option_with_text():
    bodies = FakeBodies()
    asks = Asks(bodies)
    told = []
    asks.register("choice", lambda *a: told.append(a))
    asks.card("c1", kind="choice", text="Which?", options=["a", "b"], free_text=True)
    with pytest.raises(RpcError) as err:
        asks.answer("c1", "other", "desktop")  # no text: still invalid
    assert err.value.code == ErrorCode.invalid_params
    asks.answer("c1", "other", "desktop", text="my own answer")
    assert told == [("c1", "other", "desktop", "my own answer", None)]


def test_unlisted_option_is_invalid_without_free_text():
    asks = Asks(FakeBodies())
    asks.card("c1", kind="choice", text="Which?", options=["a", "b"])
    with pytest.raises(RpcError) as err:
        asks.answer("c1", "other", "desktop", text="typed")
    assert err.value.code == ErrorCode.invalid_params
    asks.answer("c1", "b", "desktop")


def test_first_answer_wins():
    asks = Asks(FakeBodies())
    told = []
    asks.register("choice", lambda *a: told.append(a))
    asks.card("c1", kind="choice", text="Which?", options=["a", "b"])
    asks.answer("c1", "a", "desktop")
    with pytest.raises(RpcError) as err:
        asks.answer("c1", "b", "extension")
    assert err.value.code == ErrorCode.not_found
    assert [t[1] for t in told] == ["a"]


def test_card_params_omit_free_text_and_recommended_by_default():
    bodies = FakeBodies()
    asks = Asks(bodies)
    asks.card("c1", kind="choice", text="Which?", options=["a", "b"])
    [(_, params)] = bodies.sent
    assert "free_text" not in params and "recommended" not in params


def test_recommended_outside_options_raises():
    asks = Asks(FakeBodies())
    with pytest.raises(ValueError):
        asks.card("c1", kind="choice", text="Which?", options=["a", "b"], recommended="c")


def _ask_lines(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("ask.")]


async def test_ask_logs_open_show_answer(caplog):
    caplog.set_level("INFO", logger="brain.asks")
    bodies = FakeBodies()
    asks = Asks(bodies)
    asks.show("a1", call(), "desktop__x", False)
    params = await opened(bodies)
    asks.answer(params["id"], "allow", "desktop")
    lines = _ask_lines(caplog)
    assert [ln.split()[0] for ln in lines] == ["ask.opened", "ask.shown", "ask.answered"]
    assert all(f"id={params['id']}" in ln for ln in lines)
    assert "by=desktop" in lines[2] and "why=allow" in lines[2]


def test_a_task_card_adds_not_now_and_stop_task_after_its_own_options():
    bodies = FakeBodies()
    asks = Asks(bodies)
    asks.show("a0", call(), "desktop__x", True, {"task": None})
    task = {
        "task": {"id": "k1", "title": "Fix it"},
        "check_back_at": "2026-11-11T09:30:00+00:00",
        "check_back_by": "scout",
        "urgent": True,
    }
    asks.show("a1", call(), "desktop__x", False, task)
    [(_, no_task), (_, with_task)] = bodies.sent
    assert no_task["options"] == ["allow", "deny"] and "task" not in no_task
    assert with_task["options"] == ["allow", "always", "deny", "not_now", "stop_task"]
    assert with_task["task"] == {"id": "k1", "title": "Fix it"}
    assert (with_task["check_back_at"], with_task["check_back_by"], with_task["urgent"]) == (
        "2026-11-11T09:30:00+00:00",
        "scout",
        True,
    )


def test_not_now_keeps_the_card_open_and_shows_the_new_time():
    bodies = FakeBodies()
    asks = Asks(bodies)
    told = []
    asks.register("ask", lambda *a: told.append(a))
    asks.show("a1", call(), "desktop__x", True, {"task": {"id": "k1", "title": None}})
    asks.answer("a1", "not_now", "desktop", check_back_at="2026-11-11T11:00:00+00:00")
    assert told == [("a1", "not_now", "desktop", None, "2026-11-11T11:00:00+00:00")]
    assert asks.is_open("a1")
    asks.reschedule("a1", "2026-11-11T11:00:00+00:00", "person")
    last = bodies.sent[-1][1]
    assert (last["state"], last["check_back_at"], last["check_back_by"]) == (
        "open",
        "2026-11-11T11:00:00+00:00",
        "person",
    )


def test_card_publishes_and_returns_at_once():
    bodies = FakeBodies()
    asks = Asks(bodies)
    asks.card(
        "c1", kind="choice", text="Which?", options=["a", "b"], free_text=True,
        recommended="a", tool="choose",
    )  # fmt: skip
    [(_, params)] = bodies.sent
    assert params == {
        "id": "c1", "state": "open", "text": "Which?", "options": ["a", "b"],
        "free_text": True, "recommended": "a", "tool": "choose",
    }  # fmt: skip
    assert asks.is_open("c1")


def test_a_card_answer_goes_to_its_kinds_handler_with_the_typed_text():
    bodies = FakeBodies()
    asks = Asks(bodies)
    told, common = [], []
    asks.register("choice", lambda *a: told.append(("choice", *a)))
    asks.register("offer", lambda *a: told.append(("offer", *a)))
    asks.on_item_answer = lambda *a: common.append(a)
    asks.card("c1", kind="choice", text="Which?", options=["a"], free_text=True)
    asks.answer("c1", "other", "desktop", text="mine")
    assert told == [("choice", "c1", "other", "desktop", "mine", None)]
    assert common == [("c1", "other", "desktop")]  # the session saves the card_answer event
    assert not asks.is_open("c1")
    assert bodies.sent[-1][1] == {
        "id": "c1", "state": "closed", "reason": "answered", "option": "other", "by": "desktop",
    }  # fmt: skip
