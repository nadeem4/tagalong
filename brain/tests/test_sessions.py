"""Checks Session: one running turn, says that join it, cancel, and the always-sent ended.

A fake model stands in for the API; an Event step makes it wait so tests can act mid-turn.
"""

import asyncio
import datetime
import re
from types import SimpleNamespace

import pytest

from brain.bodies import Bodies
from brain.mind.turn import Final
from brain.protocol import SayParams
from brain.sessions import Session


class Gate:
    model_id = "claude-sonnet-5-5"

    def __init__(self, steps):
        self.steps = list(steps)
        self.seen = []

    async def stream(self, system, messages, tools):
        self.seen.append(list(messages))
        step = self.steps.pop(0)
        if isinstance(step, asyncio.Event):
            await step.wait()
            step = self.steps.pop(0)
        yield step
        yield Final([{"type": "text", "text": step}], "end_turn", SimpleNamespace())


class Open:
    def allows(self):
        return True

    def spend(self, usage, model):
        pass


def make(model):
    sent = []
    bodies = Bodies()
    bodies.notify = lambda m, p: sent.append((m, p))
    now = lambda: datetime.datetime(2026, 1, 1, 9, 0)  # noqa: E731
    return Session(model, Open(), bodies, 10, now=now), sent


def say(text):
    return SayParams(text=text)


def states(sent):
    return [p["state"] for m, p in sent if m == "turn"]


async def finish(session):
    await session._task


async def test_say_starts_turn():
    session, sent = make(Gate(["hi"]))
    result = session.say("desktop", say("hello"))
    assert result.joined is False
    assert re.fullmatch(r"[0-9a-f]{32}", result.turn)
    await finish(session)
    assert sent[0] == ("turn", {"turn": result.turn, "body": "desktop", "state": "started"})
    assert sent[-1] == (
        "turn",
        {"turn": result.turn, "body": "desktop", "state": "ended", "reason": "done"},
    )
    assert session.history[0] == {"role": "user", "content": [{"type": "text", "text": "hello"}]}


async def test_second_say_joins_running_turn():
    gate = asyncio.Event()
    model = Gate([gate, "one", "two"])
    session, sent = make(model)
    first = session.say("desktop", say("a"))
    second = session.say("extension", say("b"))
    assert second.joined is True and second.turn == first.turn
    gate.set()
    await finish(session)
    last_user = model.seen[-1][-1]
    assert last_user["role"] == "user"
    assert {"type": "text", "text": "b"} in last_user["content"]
    assert states(sent) == ["started", "ended"]


async def test_leftover_inbox_kept_in_history():
    session, sent = make(Gate([asyncio.Event(), "x"]))
    result = session.say("desktop", say("a"))
    await asyncio.sleep(0)
    session.say("desktop", say("late"))
    session.cancel(result.turn)  # stops the turn before it can drain the inbox
    await finish(session)
    assert session.history[-1]["content"][-1] == {"type": "text", "text": "late"}
    assert session.say("desktop", say("next")).joined is False


async def test_cancel_running_turn():
    session, sent = make(Gate([asyncio.Event(), "never"]))
    result = session.say("desktop", say("a"))
    await asyncio.sleep(0)
    session.cancel(result.turn)
    await finish(session)
    assert sent[-1][1]["state"] == "ended" and sent[-1][1]["reason"] == "cancelled"


async def test_cancel_unknown_is_noop():
    session, sent = make(Gate(["hi"]))
    session.say("desktop", say("a"))
    session.cancel("nope")
    await finish(session)
    assert sent[-1][1]["reason"] == "done"


async def test_new_say_after_end_starts_new_turn():
    session, sent = make(Gate(["one", "two"]))
    first = session.say("desktop", say("a"))
    await finish(session)
    second = session.say("desktop", say("b"))
    await finish(session)
    assert second.joined is False and second.turn != first.turn
    assert states(sent) == ["started", "ended", "started", "ended"]


async def test_empty_say_raises():
    session, _ = make(Gate([]))
    with pytest.raises(ValueError):
        session.say("desktop", SayParams(text=None, parts=[]))


async def test_say_after_task_finished_but_before_callback_starts_new_turn():
    session, sent = make(Gate(["one", "two"]))
    first = session.say("desktop", say("a"))
    await asyncio.wait({session._task})  # done; the done-callback may not have run yet
    second = session.say("desktop", say("b"))
    assert second.joined is False and second.turn != first.turn
    await finish(session)
    assert states(sent).count("ended") == 2


async def test_leftover_inbox_merges_into_last_user_message():
    session, _ = make(Gate([asyncio.Event(), "x"]))
    result = session.say("desktop", say("a"))
    await asyncio.sleep(0)
    session.say("desktop", say("late"))
    session.cancel(result.turn)
    await finish(session)
    assert [m["role"] for m in session.history] == ["user"]
    assert session.history[0]["content"] == [
        {"type": "text", "text": "a"},
        {"type": "text", "text": "late"},
    ]


async def test_cancel_right_after_say():
    session, sent = make(Gate(["never"]))
    result = session.say("desktop", say("a"))
    session.cancel(result.turn)
    await finish_quietly(session)
    assert states(sent) == ["started", "ended"]
    assert sent[-1][1]["reason"] == "cancelled"
    assert session.say("desktop", say("b")).joined is False


async def finish_quietly(session):
    task = session._task
    await asyncio.wait({task})
    await asyncio.sleep(0)  # let the done-callback run
