"""Checks permission asks: open shape, answers, first-answer-wins, timeout and cancel.

A fake Bodies records notify() calls so no sockets are needed; every frame is also
validated against the contract's AskParams.
"""

import asyncio
import time

import pytest

from brain.asks import Answer, Asks
from brain.mind.turn import Call
from brain.protocol import AskParams, ErrorCode, RpcError


class FakeBodies:
    def __init__(self, online: list[str] | None = None) -> None:
        self.online = ["desktop"] if online is None else online
        self.sent: list[tuple[str, dict]] = []

    def online_ids(self) -> list[str]:
        return self.online

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


async def test_open_ask_shape_and_allow():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.permission(call(), "desktop__x", False))
    params = await opened(bodies)
    assert bodies.sent[0][0] == "ask"
    assert params == {
        "id": params["id"],
        "state": "open",
        "turn": "t1",
        "text": "Opening it.",
        "options": ["allow", "always", "deny"],
        "confirm": True,
        "tool": "desktop__x",
        "input": {"a": 1},
    }
    asks.answer(params["id"], "allow", "desktop")
    assert await task == "allow"


async def test_locked_tool_offers_two_options():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.permission(call(), "desktop__x", True))
    params = await opened(bodies)
    assert params["options"] == ["allow", "deny"]
    asks.answer(params["id"], "deny", "desktop")
    assert await task == "deny"


async def test_always_returns_always():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.permission(call(), "desktop__x", False))
    params = await opened(bodies)
    asks.answer(params["id"], "always", "desktop")
    assert await task == "always"


async def test_second_answer_gets_not_found():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.permission(call(), "desktop__x", False))
    params = await opened(bodies)
    asks.answer(params["id"], "allow", "desktop")
    with pytest.raises(RpcError) as err:
        asks.answer(params["id"], "deny", "extension")
    assert err.value.code == ErrorCode.not_found
    assert await task == "allow"


async def test_answer_with_unoffered_option_is_invalid_params():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.permission(call(), "desktop__x", True))
    params = await opened(bodies)
    with pytest.raises(RpcError) as err:
        asks.answer(params["id"], "always", "desktop")
    assert err.value.code == ErrorCode.invalid_params
    asks.answer(params["id"], "allow", "desktop")  # still open after the bad answer
    assert await task == "allow"


async def test_no_body_online_denies_without_opening():
    bodies = FakeBodies(online=[])
    asks = Asks(bodies)
    assert await asks.permission(call(), "desktop__x", False) == "deny"
    assert bodies.sent == []
    assert asks.anyone_online() is False
    assert asks.open_asks() == []


def test_anyone_online_follows_bodies():
    assert Asks(FakeBodies(["desktop"])).anyone_online() is True


async def test_timeout_closes_ask_and_raises_timeout():
    bodies = FakeBodies()
    asks = Asks(bodies, timeout=0.01)
    with pytest.raises(RpcError) as err:
        await asks.permission(call(), "desktop__x", False)
    assert err.value.code == ErrorCode.timeout
    closed = bodies.sent[-1][1]
    assert closed["state"] == "closed" and closed["reason"] == "timeout"
    assert asks.open_asks() == []


async def test_cancel_closes_ask_with_cancelled_and_forgets_it():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.permission(call(), "desktop__x", False))
    params = await opened(bodies)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    closed = bodies.sent[-1][1]
    assert closed == {"id": params["id"], "state": "closed", "reason": "cancelled"}
    assert asks.open_asks() == []
    with pytest.raises(RpcError) as err:
        asks.answer(params["id"], "allow", "desktop")
    assert err.value.code == ErrorCode.not_found


async def test_closed_frame_names_the_answering_body():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.permission(call(), "desktop__x", False))
    params = await opened(bodies)
    asks.answer(params["id"], "allow", "extension")
    await task
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
    task = asyncio.create_task(asks.permission(call(), "desktop__x", False))
    params = await opened(bodies)
    assert asks.open_asks() == [params]
    asks.answer(params["id"], "deny", "desktop")
    await task
    assert asks.open_asks() == []


async def test_open_asks_returns_copies():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.permission(call(), "desktop__x", False))
    params = await opened(bodies)
    asks.open_asks()[0]["options"] = ["tampered"]
    assert asks.open_asks()[0]["options"] == ["allow", "always", "deny"]
    asks.answer(params["id"], "deny", "desktop")
    await task


async def test_answer_after_timeout_is_not_found():
    bodies = FakeBodies()
    asks = Asks(bodies, timeout=0.01)
    with pytest.raises(RpcError):
        await asks.permission(call(), "desktop__x", False)
    ask_id = bodies.sent[0][1]["id"]
    with pytest.raises(RpcError) as err:
        asks.answer(ask_id, "allow", "desktop")
    assert err.value.code == ErrorCode.not_found


async def test_answer_in_the_tick_after_timeout_fired_is_not_found():
    # Both timers come due in one loop pass: the timeout cancels the wait first, then the
    # answer runs before the handler has closed the ask. It must not hit a finished future.
    bodies = FakeBodies()
    asks = Asks(bodies, timeout=0.05)
    task = asyncio.create_task(asks.permission(call(), "desktop__x", False))
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
    asks = Asks(bodies, timeout=0.05)
    task = asyncio.create_task(asks.permission(call(), "desktop__x", False))
    params = await opened(bodies)
    asyncio.get_running_loop().call_later(
        0.01, lambda: asks.answer(params["id"], "allow", "desktop")
    )
    time.sleep(0.1)  # answer and timeout both due in one loop pass, the answer first
    assert await task == "allow"
    assert asks.open_asks() == []


# --- open(): asks with no turn, custom options and typed answers ---------------


async def test_open_shape_has_no_turn_and_no_confirm():
    bodies = FakeBodies()
    asks = Asks(bodies)
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
    asks = Asks(bodies)
    task = asyncio.create_task(asks.open(text="Which?", options=["a", "b"]))
    params = await opened(bodies)
    asks.answer(params["id"], "a", "desktop", text="because")
    assert await task == Answer("a", "because")


async def test_free_text_accepts_unlisted_option_with_text():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.open(text="Which?", options=["a", "b"], free_text=True))
    params = await opened(bodies)
    with pytest.raises(RpcError) as err:
        asks.answer(params["id"], "other", "desktop")  # no text: still invalid
    assert err.value.code == ErrorCode.invalid_params
    asks.answer(params["id"], "other", "desktop", text="my own answer")
    assert await task == Answer("other", "my own answer")


async def test_unlisted_option_is_invalid_without_free_text():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.open(text="Which?", options=["a", "b"]))
    params = await opened(bodies)
    with pytest.raises(RpcError) as err:
        asks.answer(params["id"], "other", "desktop", text="typed")
    assert err.value.code == ErrorCode.invalid_params
    asks.answer(params["id"], "b", "desktop")
    await task


async def test_open_has_no_default_timeout():
    bodies = FakeBodies()
    asks = Asks(bodies, timeout=0.01)  # applies to permission(), not open()
    task = asyncio.create_task(asks.open(text="Which?", options=["a"]))
    params = await opened(bodies)
    await asyncio.sleep(0.05)
    assert not task.done()
    asks.answer(params["id"], "a", "desktop")
    await task


async def test_open_with_timeout_closes_and_raises():
    bodies = FakeBodies()
    asks = Asks(bodies)
    with pytest.raises(RpcError) as err:
        await asks.open(text="Which?", options=["a"], timeout=0.01)
    assert err.value.code == ErrorCode.timeout
    assert bodies.sent[-1][1]["reason"] == "timeout"


async def test_open_with_nobody_online_returns_unanswered():
    bodies = FakeBodies(online=[])
    asks = Asks(bodies)
    assert await asks.open(text="Which?", options=["a"]) == Answer(None, None)
    assert bodies.sent == []


async def test_cancel_all_closes_named_asks_and_waiters_get_cancelled():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.open(text="Which?", options=["a"], ask_id="job1-a"))
    keep = asyncio.create_task(asks.open(text="Other?", options=["a"], ask_id="job2-a"))
    await opened(bodies)
    await asyncio.sleep(0)
    asks.cancel_all(["job1-a"])
    with pytest.raises(RpcError) as err:
        await task
    assert err.value.code == ErrorCode.cancelled
    closed = [p for _, p in bodies.sent if p["state"] == "closed"]
    assert closed == [{"id": "job1-a", "state": "closed", "reason": "cancelled"}]
    assert [a["id"] for a in asks.open_asks()] == ["job2-a"]
    asks.answer("job2-a", "a", "desktop")
    await keep


async def test_open_first_answer_wins():
    bodies = FakeBodies()
    asks = Asks(bodies)
    task = asyncio.create_task(asks.open(text="Which?", options=["a", "b"]))
    params = await opened(bodies)
    asks.answer(params["id"], "a", "desktop")
    with pytest.raises(RpcError) as err:
        asks.answer(params["id"], "b", "extension")
    assert err.value.code == ErrorCode.not_found
    assert await task == Answer("a", None)
