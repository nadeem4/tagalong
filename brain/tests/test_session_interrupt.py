"""Checks Session when the owner talks over Scout: the turn is cut, history keeps what was said,
and the model gets what was left unsaid once, with the owner's next words.

Fakes only: a scripted model and a voice that remembers the sentences it was given.
"""

import asyncio
import copy
import json

from test_sessions import (
    Gate,
    RecordingVoice,
    finish_quietly,
    join,
    make,
    read_aloud,
    remember_call,
    say,
    settle,
    states,
)

from brain.memory import Memory
from brain.protocol import Interrupted, SayParams

MARK = "[interrupted: the owner spoke over this]"


class SnapGate(Gate):
    """Gate that snapshots what the model was shown, since history is edited afterwards."""

    async def stream(self, system, messages, tools):
        snap = copy.deepcopy(messages)
        first = True
        async for item in super().stream(system, messages, tools):
            if first:
                self.seen[-1] = snap
                first = False
            yield item


class SentenceVoice(RecordingVoice):
    def __init__(self, **sentences):
        super().__init__()
        self.logs = dict(sentences)
        self.hushed = []

    def sentences(self, turn):
        return list(self.logs.get(turn, []))

    def hush(self, body_id):
        self.hushed.append(body_id)


def over(text, turn, heard):
    return SayParams(text=text, spoken=True, interrupted=Interrupted(turn=turn, heard=heard))


def last_user_texts(model, call=-1):
    return [b["text"] for b in model.seen[call][-1]["content"] if b["type"] == "text"]


def make_voiced(model, memory=None):
    session, sent = make(model, memory)
    session.voice = voice = SentenceVoice()
    join(session, "desktop")
    read_aloud(session)
    return session, sent, voice


async def talk_over_a_running_turn(heard=1, steps=None):
    gate = asyncio.Event()
    model = SnapGate([gate, *(steps or ["ok"])])
    session, sent, voice = make_voiced(model)
    first = await session.say("desktop", say("tell me"))
    voice.logs[first.turn] = ["One.", "Two.", "Three."]
    await settle()
    second = await session.say("desktop", over("wait", first.turn, heard))
    await finish_quietly(session)
    return session, sent, voice, model, first, second


async def test_interrupt_cancels_the_running_turn_and_starts_a_new_one_with_the_owners_words():
    session, sent, voice, model, first, second = await talk_over_a_running_turn()
    assert second.joined is False and second.turn != first.turn
    ended = {p["turn"]: p["reason"] for m, p in sent if m == "turn" and p["state"] == "ended"}
    assert ended == {first.turn: "cancelled", second.turn: "done"}
    assert voice.hushed == ["desktop"]  # what was queued must not keep playing
    texts = last_user_texts(model)
    assert texts[1] == "wait"
    assert '<data kind="interruption">' in texts[0]


async def test_next_turn_receives_spoken_and_unsaid_once():
    session, _, _, model, _, _ = await talk_over_a_running_turn(steps=["ok", "again"])
    block = last_user_texts(model)[0]
    assert "One." in block and "Two. Three." in block
    await session.say("desktop", say("and now?"))
    await finish_quietly(session)
    assert "interruption" not in json.dumps(model.seen[-1])


async def test_unsaid_is_not_in_saved_history():
    memory = Memory(":memory:")
    gate = asyncio.Event()
    session, _, voice = make_voiced(SnapGate([gate, "ok"]), memory)
    first = await session.say("desktop", say("tell me"))
    voice.logs[first.turn] = ["One.", "Two.", "Three."]
    await settle()
    await session.say("desktop", over("wait", first.turn, 1))
    await finish_quietly(session)
    assert "Two. Three." not in json.dumps(memory.load_messages())
    assert "Two. Three." not in json.dumps(session.history)


async def test_saved_history_keeps_only_the_spoken_sentences_and_marks_the_cut():
    memory = Memory(":memory:")
    session, _, voice = make_voiced(SnapGate(["One. Two. Three.", "ok"]), memory)
    first = await session.say("desktop", say("tell me"))
    await finish_quietly(session)
    voice.logs[first.turn] = ["One.", "Two.", "Three."]
    await session.say("desktop", over("wait", first.turn, 1))
    await finish_quietly(session)
    cut = {"type": "text", "text": f"One.\n\n{MARK}"}
    assert session.history[1] == {"role": "assistant", "content": [cut]}
    assert memory.load_messages()[1] == {"role": "assistant", "content": [cut]}


async def test_a_cut_mid_stream_adds_the_spoken_part_as_the_assistant_turn():
    session, _, _, _, _, _ = await talk_over_a_running_turn(heard=2)
    roles = [m["role"] for m in session.history]
    assert roles == ["user", "assistant", "user", "assistant"]
    assert session.history[1]["content"] == [{"type": "text", "text": f"One. Two.\n\n{MARK}"}]


async def test_second_interrupt_replaces_the_first_unsaid():
    gate = asyncio.Event()
    model = SnapGate([gate, gate, "done"])
    session, _, voice = make_voiced(model)
    a = await session.say("desktop", say("tell me"))
    voice.logs[a.turn] = ["A1.", "A2."]
    await settle()
    b = await session.say("desktop", over("wait", a.turn, 1))
    voice.logs[b.turn] = ["B1.", "B2."]
    while len(model.seen) < 2:  # b waits for a to wind down, then asks the model
        await asyncio.sleep(0.005)
    await session.say("desktop", over("no, this", b.turn, 0))
    await finish_quietly(session)
    block = last_user_texts(model)[0]
    assert "B1. B2." in block and "A2." not in block


async def test_stale_turn_in_interrupted_is_a_plain_say():
    model = SnapGate(["hi"])
    session, _, voice = make_voiced(model)
    voice.logs["gone"] = ["Old."]
    await session.say("desktop", over("hello", "gone", 0))
    await finish_quietly(session)
    assert last_user_texts(model)[0] == "hello"
    assert MARK not in json.dumps(session.history)


async def test_interrupt_after_all_sentences_has_empty_unsaid():
    session, sent, voice = make_voiced(SnapGate(["One. Two.", "ok"]))
    first = await session.say("desktop", say("tell me"))
    await finish_quietly(session)
    voice.logs[first.turn] = ["One.", "Two."]
    await session.say("desktop", over("thanks", first.turn, 2))
    await finish_quietly(session)
    assert MARK not in json.dumps(session.history)
    assert states(sent) == ["started", "ended", "started", "ended"]
    assert session.history[1]["content"] == [{"type": "text", "text": "One. Two."}]


async def test_history_stays_valid_after_a_cancel_mid_tool_call():
    gate = asyncio.Event()
    model = SnapGate([remember_call("x"), gate, "ok"])
    session, _, voice = make_voiced(model)
    first = await session.say("desktop", say("tell me"))
    voice.logs[first.turn] = ["One.", "Two."]
    for _ in range(20):
        await asyncio.sleep(0.005)
    await session.say("desktop", over("wait", first.turn, 1))
    await finish_quietly(session)
    roles = [m["role"] for m in session.history]
    assert all(a != b for a, b in zip(roles, roles[1:], strict=False))  # strictly alternating
    uses = [
        b["id"]
        for m in session.history
        if m["role"] == "assistant"
        for b in m["content"]
        if b.get("type") == "tool_use"
    ]
    answers = [
        b["tool_use_id"]
        for m in session.history
        if m["role"] == "user"
        for b in m["content"]
        if b.get("type") == "tool_result"
    ]
    assert uses == answers


async def test_a_running_turn_is_cut_even_when_nothing_is_left_unsaid():
    # Everything made so far was heard, but the model is still going: the turn is cancelled.
    session, sent, voice, model, first, second = await talk_over_a_running_turn(heard=3)
    assert second.joined is False and second.turn != first.turn
    ended = {p["turn"]: p["reason"] for m, p in sent if m == "turn" and p["state"] == "ended"}
    assert ended[first.turn] == "cancelled"
    assert session.history[1]["content"] == [
        {"type": "text", "text": f"One. Two. Three.\n\n{MARK}"}
    ]
    assert voice.hushed == ["desktop"]


async def test_a_cut_after_streamed_words_replaces_them_with_the_heard_part():
    # The cancel kept the streamed words as the reply; the cut must swap them, not add to them.
    class Streaming(SnapGate):
        async def stream(self, system, messages, tools):
            if not self.seen:
                self.seen.append([])
                yield "One. Two. Three."
                await asyncio.Event().wait()
            async for item in super().stream(system, messages, tools):
                yield item

    session, _, voice = make_voiced(Streaming(["ok"]))
    first = await session.say("desktop", say("tell me"))
    voice.logs[first.turn] = ["One.", "Two.", "Three."]
    await settle()
    await session.say("desktop", over("wait", first.turn, 1))
    await finish_quietly(session)
    assert [m["role"] for m in session.history] == ["user", "assistant", "user", "assistant"]
    assert session.history[1]["content"] == [{"type": "text", "text": f"One.\n\n{MARK}"}]
    assert "Two. Three." not in json.dumps(session.history)
