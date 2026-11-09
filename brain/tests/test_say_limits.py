"""Checks F9: a say part over the limit is refused up front, and a request the API rejects
(a 400) is dropped from live history so the next turn still works.

Fake models only; the real API is never called.
"""

import base64
import json
from types import SimpleNamespace

import pytest
from test_sessions import Gate, file_memory, finish_quietly, make, say

from brain.memory import Memory
from brain.mind.turn import Final
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
