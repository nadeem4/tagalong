"""Checks permission asks: open shape, answers, first-answer-wins, timeout and cancel.

A fake Bodies records notify() calls so no sockets are needed; every frame is also
validated against the contract's AskParams.
"""

import asyncio
import time

import pytest
from job_rows import fresh_work

from brain.asks import Answer, AskExpired, Asks
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
    assert Asks(FakeBodies(["desktop"]), fresh_work()).anyone_online() is True


async def test_timeout_closes_ask_and_raises_timeout():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    with pytest.raises(RpcError) as err:
        await asks.open(text="Which?", options=["allow"], timeout=0.01)
    assert err.value.code == ErrorCode.timeout
    closed = bodies.sent[-1][1]
    assert closed["state"] == "closed" and closed["reason"] == "timeout"
    assert asks.open_asks() == []


async def test_closed_frame_names_the_answering_body():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
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
    asks = Asks(bodies, fresh_work())
    asks.show("a1", call(), "desktop__x", False)
    params = await opened(bodies)
    assert asks.open_asks() == [params]
    asks.answer(params["id"], "deny", "desktop")
    assert asks.open_asks() == []


async def test_open_asks_returns_copies():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    asks.show("a1", call(), "desktop__x", False)
    params = await opened(bodies)
    asks.open_asks()[0]["options"] = ["tampered"]
    assert asks.open_asks()[0]["options"] == ["allow", "always", "deny"]
    asks.answer(params["id"], "deny", "desktop")


async def test_answer_after_timeout_is_not_found():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    with pytest.raises(RpcError):
        await asks.open(text="Which?", options=["allow"], timeout=0.01)
    ask_id = bodies.sent[0][1]["id"]
    with pytest.raises(RpcError) as err:
        asks.answer(ask_id, "allow", "desktop")
    assert err.value.code == ErrorCode.not_found


async def test_answer_in_the_tick_after_timeout_fired_is_not_found():
    # Both timers come due in one loop pass: the timeout cancels the wait first, then the
    # answer runs before the handler has closed the ask. It must not hit a finished future.
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(asks.open(text="Which?", options=["allow"], timeout=0.05))
    params = await opened(bodies)
    seen: list[RpcError] = []

    def late_answer() -> None:
        try:
            asks.answer(params["id"], "allow", "desktop")
        except RpcError as exc:
            seen.append(exc)

    asyncio.get_running_loop().call_later(0.06, late_answer)
    time.sleep(0.1)  # block the loop so both timers are due together
    with pytest.raises(RpcError) as err:
        await task
    assert err.value.code == ErrorCode.timeout
    assert [e.code for e in seen] == [ErrorCode.not_found]


async def test_answer_landing_just_before_timeout_wins():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(asks.open(text="Which?", options=["allow"], timeout=0.05))
    params = await opened(bodies)
    asyncio.get_running_loop().call_later(
        0.01, lambda: asks.answer(params["id"], "allow", "desktop")
    )
    time.sleep(0.1)  # answer and timeout both due in one loop pass, the answer first
    assert (await task).option == "allow"
    assert asks.open_asks() == []


# --- open(): asks with no turn, custom options and typed answers ---------------


async def test_open_shape_has_no_turn_and_no_confirm():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(
        asks.open(text="Run it?", options=["allow-once", "reject"], tool="Bash", input={"c": "ls"})
    )
    params = await opened(bodies)
    assert params == {
        "id": params["id"],
        "state": "open",
        "text": "Run it?",
        "options": ["allow-once", "reject"],
        "tool": "Bash",
        "input": {"c": "ls"},
    }
    asks.answer(params["id"], "allow-once", "desktop")
    assert await task == Answer("allow-once", None)


async def test_open_answer_carries_text():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(asks.open(text="Which?", options=["a", "b"]))
    params = await opened(bodies)
    asks.answer(params["id"], "a", "desktop", text="because")
    assert await task == Answer("a", "because")


async def test_open_answer_is_the_option_and_text_only():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(asks.open(text="t", options=["a", "cancel"]))
    params = await opened(bodies)
    asks.answer(params["id"], "a", "desktop")
    assert await task == Answer("a", None)


async def test_free_text_accepts_unlisted_option_with_text():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(asks.open(text="Which?", options=["a", "b"], free_text=True))
    params = await opened(bodies)
    with pytest.raises(RpcError) as err:
        asks.answer(params["id"], "other", "desktop")  # no text: still invalid
    assert err.value.code == ErrorCode.invalid_params
    asks.answer(params["id"], "other", "desktop", text="my own answer")
    assert await task == Answer("other", "my own answer")


async def test_unlisted_option_is_invalid_without_free_text():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(asks.open(text="Which?", options=["a", "b"]))
    params = await opened(bodies)
    with pytest.raises(RpcError) as err:
        asks.answer(params["id"], "other", "desktop", text="typed")
    assert err.value.code == ErrorCode.invalid_params
    asks.answer(params["id"], "b", "desktop")
    await task


async def test_open_has_no_default_timeout():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(asks.open(text="Which?", options=["a"]))
    params = await opened(bodies)
    await asyncio.sleep(0.05)
    assert not task.done()
    asks.answer(params["id"], "a", "desktop")
    await task


async def test_open_with_timeout_closes_and_raises():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    with pytest.raises(RpcError) as err:
        await asks.open(text="Which?", options=["a"], timeout=0.01)
    assert err.value.code == ErrorCode.timeout
    assert bodies.sent[-1][1]["reason"] == "timeout"


async def test_open_with_nobody_online_returns_unanswered():
    bodies = FakeBodies(online=[])
    asks = Asks(bodies, fresh_work())
    assert await asks.open(text="Which?", options=["a"]) == Answer(None, None)
    assert bodies.sent == []


async def test_open_first_answer_wins():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(asks.open(text="Which?", options=["a", "b"]))
    params = await opened(bodies)
    asks.answer(params["id"], "a", "desktop")
    with pytest.raises(RpcError) as err:
        asks.answer(params["id"], "b", "extension")
    assert err.value.code == ErrorCode.not_found
    assert await task == Answer("a", None)


async def test_open_rejects_a_duplicate_ask_id():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    first = asyncio.create_task(asks.open(text="Which?", options=["a"], ask_id="job1-a"))
    await opened(bodies)
    await asyncio.sleep(0)
    with pytest.raises(ValueError):
        await asks.open(text="Again?", options=["a"], ask_id="job1-a")
    asks.answer("job1-a", "a", "desktop")  # the first ask is untouched
    assert await first == Answer("a", None)


async def test_open_ask_params_include_free_text_and_recommended_when_given():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(
        asks.open(text="Which?", options=["a", "b"], free_text=True, recommended="b")
    )
    params = await opened(bodies)
    assert params["free_text"] is True
    assert params["recommended"] == "b"
    asks.answer(params["id"], "b", "desktop")
    await task


async def test_open_ask_params_omit_them_by_default():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    task = asyncio.create_task(asks.open(text="Which?", options=["a", "b"]))
    params = await opened(bodies)
    assert "free_text" not in params
    assert "recommended" not in params
    asks.answer(params["id"], "a", "desktop")
    await task


async def test_recommended_outside_options_raises():
    asks = Asks(FakeBodies(), fresh_work())
    with pytest.raises(ValueError):
        await asks.open(text="Which?", options=["a", "b"], recommended="c")


# --- the ask is a work row while it is open -----------------------------------


def goal(work, id="job1"):
    work.create("goal", "a job", id=id, state="active")
    return id


async def test_open_ask_is_active_row():
    bodies = FakeBodies()
    work = fresh_work()
    asks = Asks(bodies, work)
    task = asyncio.create_task(
        asks.open(text="Which?", options=["a"], tool="Bash", parent_id=goal(work))
    )
    params = await opened(bodies)
    row = work.get(params["id"])
    assert (row.kind, row.state, row.parent_id, row.title) == ("ask", "active", "job1", "Which?")
    assert work.ask_detail(params["id"])["tool"] == "Bash"
    asks.answer(params["id"], "a", "desktop")
    await task


async def test_ask_of_a_missing_or_ended_job_is_a_root():
    bodies = FakeBodies()
    work = fresh_work()
    asks = Asks(bodies, work)
    task = asyncio.create_task(asks.open(text="Which?", options=["a"], parent_id="nope"))
    params = await opened(bodies)
    assert work.get(params["id"]).parent_id is None
    asks.answer(params["id"], "a", "desktop")
    await task


async def test_timed_out_and_cancelled_asks_expire():
    bodies = FakeBodies()
    work = fresh_work()
    asks = Asks(bodies, work)
    with pytest.raises(RpcError):
        await asks.open(text="Which?", options=["a"], timeout=0.01)
    timed = bodies.sent[0][1]["id"]
    assert (work.get(timed).state, work.get(timed).end_reason) == ("expired", "timed out")
    task = asyncio.create_task(asks.open(text="Again?", options=["a"], ask_id="x2"))
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert work.get("x2").state == "expired"


async def test_goal_close_expires_open_ask_and_resolves_future():
    bodies = FakeBodies()
    work = fresh_work()
    asks = Asks(bodies, work)
    task = asyncio.create_task(
        asks.open(text="Which?", options=["a"], ask_id="x1", parent_id=goal(work))
    )
    await opened(bodies)
    work.close_goal("job1", "done", "finished")
    with pytest.raises(AskExpired) as err:
        await task
    assert err.value.reason == "job ended: closed by Scout"
    assert work.get("x1").state == "expired"
    assert asks.open_asks() == []
    assert bodies.sent[-1][1] == {"id": "x1", "state": "closed", "reason": "timeout"}
    with pytest.raises(RpcError):  # a late answer finds nothing open
        asks.answer("x1", "a", "desktop")


async def test_open_ask_expired_after_restart():
    bodies = FakeBodies()
    work = fresh_work()
    asks = Asks(bodies, work)
    task = asyncio.create_task(asks.open(text="Which?", options=["a"], ask_id="x1"))
    await opened(bodies)
    # the brain dies here; a new one starts on the same file and scans
    assert work.resume_scan(lambda row: None) == [("x1", "expired")]
    row = work.get("x1")
    assert (row.state, row.end_reason) == ("expired", "brain restarted")
    assert work.resume_scan(lambda row: None) == []
    with pytest.raises(AskExpired):  # this test's waiter outlived the "crash"; a real one cannot
        await task


def _ask_lines(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("ask.")]


async def test_ask_logs_open_show_answer(caplog):
    caplog.set_level("INFO", logger="brain.asks")
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
    asks.show("a1", call(), "desktop__x", False)
    params = await opened(bodies)
    asks.answer(params["id"], "allow", "desktop")
    lines = _ask_lines(caplog)
    assert [ln.split()[0] for ln in lines] == ["ask.opened", "ask.shown", "ask.answered"]
    assert all(f"id={params['id']}" in ln for ln in lines)
    assert "by=desktop" in lines[2] and "why=allow" in lines[2]


def test_a_task_card_adds_not_now_and_stop_task_after_its_own_options():
    bodies = FakeBodies()
    asks = Asks(bodies, fresh_work())
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
    asks = Asks(bodies, fresh_work())
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
    asks = Asks(bodies, fresh_work())
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
    asks = Asks(bodies, fresh_work())
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
