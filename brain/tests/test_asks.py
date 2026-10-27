"""Checks permission asks: open shape, answers, first-answer-wins, timeout and cancel.

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
