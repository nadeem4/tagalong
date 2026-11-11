"""Checks F9: a say part over the limit is refused up front, and a request the API rejects
(a 400) is dropped from live history so the next turn still works.

Fake models only; the real API is never called.
"""

import asyncio
import base64
import json
from types import SimpleNamespace

import pytest
from test_sessions import Gate, file_memory, finish_quietly, make, say, settle, turns_done
from test_turn import ok_tool, tool_step

from brain.memory import Memory
from brain.mind.prompt import check_part_sizes
from brain.mind.turn import Final, run_turn
from brain.protocol import ErrorCode, RpcError, SayParams


def _image(megabytes):
    raw = base64.b64encode(b"\0" * (megabytes * 1_000_000)).decode()
    return {"type": "image", "mime": "image/png", "data": raw}


async def test_say_with_an_over_limit_part_is_refused_before_anything_changes(tmp_path):
    memory = file_memory(tmp_path)
    session, sent = make(Gate(["never"]), memory)
    params = SayParams(text="what is this?", parts=[_image(6)])
    with pytest.raises(RpcError) as err:
        session.say("desktop", params)
    assert err.value.code == ErrorCode.over_limit
    assert session._task is None and session.history == [] and sent == []
    assert memory.load_messages(include_cut=True) == []


async def test_say_with_parts_over_the_message_limit_is_refused():
    session, _ = make(Gate(["never"]))
    parts = [_image(4)] * 6  # each under 5 MB, 24 MB together
    with pytest.raises(RpcError) as err:
        session.say("desktop", SayParams(parts=parts))
    assert err.value.code == ErrorCode.over_limit


class Rejects(Gate):
    """The API answers the first request with a 400, then works."""

    async def stream(self, system, messages, tools):
        self.seen.append(list(messages))
        if len(self.seen) == 1:
            err = RuntimeError("Could not process image")
            err.status_code = 400
            raise err
            yield
        yield "ok"
        yield Final([{"type": "text", "text": "ok"}], "end_turn", SimpleNamespace())


async def test_a_request_the_api_rejects_is_dropped_so_the_next_turn_works(tmp_path):
    memory: Memory = file_memory(tmp_path)
    model = Rejects([])
    session, sent = make(model, memory)
    session.say("desktop", say("a bad picture"))
    await finish_quietly(session)
    assert sent[-1][1]["reason"] == "error"
    session.say("desktop", say("Reply with just: ok"))
    await finish_quietly(session)
    assert "a bad picture" not in json.dumps(model.seen[1])
    assert [m["role"] for m in model.seen[1]] == ["user"]
    assert [m["role"] for m in memory.load_messages()] == ["user", "assistant"]


def _four_hundred(text):
    err = RuntimeError(text)
    err.status_code = 400
    return err


class AlwaysRejects(Gate):
    fail_calls = 99

    def __init__(self, text, hold=None):
        super().__init__([])
        self.text, self.hold = text, hold

    async def stream(self, system, messages, tools):
        self.seen.append(list(messages))
        if self.hold is not None and len(self.seen) == 1:
            await self.hold.wait()
        if len(self.seen) <= self.fail_calls:
            raise _four_hundred(self.text)
            yield
        yield "ok"
        yield Final([{"type": "text", "text": "ok"}], "end_turn", SimpleNamespace())


async def test_a_400_on_a_text_only_request_keeps_it(tmp_path):
    memory = file_memory(tmp_path)
    model = AlwaysRejects("Your credit balance is too low")
    session, _ = make(model, memory)
    session.say("desktop", say("long story"))
    await finish_quietly(session)
    session.say("desktop", say("try again"))
    await finish_quietly(session)
    assert "long story" in json.dumps(model.seen[1])
    assert "long story" in json.dumps(session.history)


async def test_a_400_from_older_history_does_not_cut_requests_one_by_one(tmp_path):
    memory = file_memory(tmp_path)
    model = AlwaysRejects("messages.0.content.1: invalid block")
    session, _ = make(model, memory)
    for text in ("one", "two", "three"):
        session.say("desktop", say(text))
        await finish_quietly(session)
    assert [m["role"] for m in session.history] == ["user"] * 3
    assert len(memory.load_messages()) == 3


async def test_a_400_on_a_request_with_an_image_is_dropped_whatever_it_says(tmp_path):
    memory = file_memory(tmp_path)
    model = AlwaysRejects("invalid_request_error")
    session, _ = make(model, memory)
    model.fail_calls = 1
    session.say("desktop", SayParams(text="look", parts=[_image(1)]))
    await finish_quietly(session)
    session.say("desktop", say("next"))
    await finish_quietly(session)
    assert [m["role"] for m in model.seen[1]] == ["user"]
    assert "look" not in json.dumps(model.seen[1])


async def test_a_say_after_a_rejected_turn_gets_its_own_turn(tmp_path):
    hold = asyncio.Event()
    memory = file_memory(tmp_path)
    model = AlwaysRejects("Could not process image", hold=hold)
    model.fail_calls = 1
    session, _ = make(model, memory)
    session.say("desktop", say("a bad picture"))
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert session.say("desktop", say("and also this")).joined is False
    hold.set()
    await turns_done(session)
    await settle()  # the second say gets its turn once the first has ended
    await turns_done(session)
    assert "a bad picture" not in json.dumps(model.seen[-1])
    assert "and also this" in json.dumps(model.seen[-1])
    assert session.history[-1]["role"] == "assistant"


async def test_a_400_after_a_tool_round_is_not_dropped():
    class After:
        model_id = "m"
        calls = 0

        async def stream(self, system, messages, tools):
            self.calls += 1
            if self.calls == 1:
                yield tool_step(("c1", "x"))[1]
                return
            raise _four_hundred("Could not process image")
            yield

    rejected = []
    history = [{"role": "user", "content": "go"}]
    reason = await run_turn(
        turn_id="t",
        body_id="desktop",
        model=After(),
        system=lambda: "s",
        history=history,
        tools=lambda: [],
        run_tool=ok_tool,
        notify=lambda m, p: None,
        budget=SimpleNamespace(spend=lambda u, m: None),
        step_cap=5,
        on_rejected=lambda: rejected.append(1),
    )
    assert reason == "error" and rejected == []


async def test_a_part_of_exactly_the_limit_passes():
    exact = base64.b64encode(bytes(5_000_000)).decode()  # padded; 5,000,000 bytes decoded
    check_part_sizes(SayParams(parts=[{"type": "image", "mime": "image/png", "data": exact}]).parts)
