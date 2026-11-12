"""Interjections: news that may speak at the next pause borrows the speech queue while Scout talks.

The queue pauses at the sentence break, one short model call sees the news and the sentences
not yet said, and Scout picks continue or replace (no pick resumes). Fakes only: a scripted
model that records how it was called, and a voice that remembers what it was told.
"""

import asyncio
from types import SimpleNamespace

from test_sessions import RecordingVoice, join, make, read_aloud, settle, spoken_say

from brain.events import Event, EventKind
from brain.mind.turn import Final

KINDS = {"nudge": EventKind("nudge", urgency="next_pause", batch_seconds=0, max_per_hour=10)}
UNSAID = ["Third sentence.", "Fourth sentence."]


class TalkVoice(RecordingVoice):
    """Remembers pause, resume and replace; one live turn with sentences still to say."""

    def __init__(self, unsaid=UNSAID, live=True):
        super().__init__()
        self.unsaid = list(unsaid)
        self.live = live

    def queued(self, body_id):
        turn = next((c[1] for c in self.calls if c[0] == "spoken"), None)
        return (turn, list(self.unsaid)) if self.live else (None, [])

    def pause(self):
        self.calls.append(("pause",))

    def resume(self):
        self.calls.append(("resume",))

    def replace(self, turn, body_id, text):
        self.calls.append(("replace", turn, body_id, text))


class Scripted:
    """The first call is the running turn (it waits on `gate`); an interjection is a call that
    passes `max_tokens`. `choice` is the tool the interjection calls, if any."""

    model_id = "claude-sonnet-5-5"

    def __init__(self, choice=None):
        self.gate = asyncio.Event()
        self.choice = choice
        self.calls: list[dict] = []

    async def stream(self, system, messages, tools, max_tokens=None):
        self.calls.append(
            {"system": system, "messages": messages, "tools": tools, "max_tokens": max_tokens}
        )
        if max_tokens is None:
            await self.gate.wait()
            yield "main reply"
            yield Final([{"type": "text", "text": "main reply"}], "end_turn", SimpleNamespace())
            return
        content = []
        if self.choice is not None:
            name, args = self.choice
            content = [{"type": "tool_use", "id": "c1", "name": name, "input": args}]
        yield Final(content, "tool_use" if content else "end_turn", SimpleNamespace())

    @property
    def interjections(self):
        return [c for c in self.calls if c["max_tokens"] is not None]


async def talking(model, voice=None):
    """A spoken turn that is still running while the desktop plays its first sentences."""
    session, sent = make(model, kinds=KINDS)
    session.voice = voice = voice or TalkVoice()
    join(session, "desktop")
    read_aloud(session)
    await session.say("desktop", spoken_say("tell me a story"))
    await settle()
    session.dispatcher.set_speech_state("talking")
    session.post_event(Event("nudge", {"note": "Sam wrote back"}))
    await settle()
    return session, voice


async def at_the_break(session):
    session.dispatcher.set_speech_state("sentence_break")
    for _ in range(4):
        await settle()


async def finish(session, model):
    model.gate.set()
    await settle()
    if session._task is not None:
        await asyncio.wait({session._task})
    await settle()


def names(voice):
    return [c[0] for c in voice.calls if c[0] in ("pause", "resume", "replace")]


async def test_interjection_pauses_at_sentence_break():
    model = Scripted()
    session, voice = await talking(model)
    assert names(voice) == [] and model.interjections == []  # waits for the break
    await at_the_break(session)
    assert names(voice)[0] == "pause"
    assert len(model.interjections) == 1
    await finish(session, model)


async def test_no_choice_resumes_queue():
    model = Scripted(choice=None)
    session, voice = await talking(model)
    await at_the_break(session)
    assert names(voice) == ["pause", "resume"]  # nothing replaced
    await finish(session, model)


async def test_speech_continue_resumes_queue():
    model = Scripted(choice=("speech_continue", {}))
    session, voice = await talking(model)
    await at_the_break(session)
    assert names(voice) == ["pause", "resume"]
    await finish(session, model)


async def test_replace_clears_unsaid_and_speaks_new():
    model = Scripted(choice=("speech_replace", {"text": "Sam wrote back, want it now?"}))
    session, voice = await talking(model)
    await at_the_break(session)
    turn = next(c[1] for c in voice.calls if c[0] == "spoken")
    assert voice.calls.count(("replace", turn, "desktop", "Sam wrote back, want it now?")) == 1
    assert names(voice) == ["pause", "replace", "resume"]
    await finish(session, model)


async def test_interjection_uses_short_context_and_small_max_tokens():
    model = Scripted()
    session, voice = await talking(model)
    await at_the_break(session)
    (call,) = model.interjections
    assert call["max_tokens"] <= 400
    assert len(call["messages"]) == 1  # no chat history: the news and what is left to say
    text = call["messages"][0]["content"][0]["text"]
    assert "Sam wrote back" in text
    assert all(s in text for s in UNSAID)
    assert [t["name"] for t in call["tools"]] == ["speech_continue", "speech_replace"]
    await finish(session, model)


async def test_interjection_is_one_extra_call():
    model = Scripted(choice=("speech_replace", {"text": "Quick word first."}))
    session, voice = await talking(model)
    await at_the_break(session)
    await finish(session, model)
    assert len(model.calls) == 2  # the running turn's step, plus the interjection
    assert len(model.interjections) == 1


async def test_no_voice_or_nothing_to_borrow_waits_for_a_plain_wake():
    model = Scripted()
    session, voice = await talking(model, TalkVoice(live=False))
    await at_the_break(session)
    assert names(voice) == [] and model.interjections == []
    await finish(session, model)
    assert any("Event: nudge" in str(c["messages"]) for c in model.calls)  # told by a wake turn


def test_a_replace_with_no_words_is_a_continue():
    from brain.speech_tools import replacement

    def done(*blocks):
        return Final(list(blocks), "tool_use", SimpleNamespace())

    use = {"type": "tool_use", "id": "c", "name": "speech_replace"}
    assert replacement(done({**use, "input": {"text": " now. "}})) == "now."
    assert replacement(done({**use, "input": {"text": "  "}})) is None
    assert replacement(done({**use, "input": {}})) is None
    assert replacement(done({"type": "text", "text": "hm"})) is None


def test_the_short_request_has_a_small_cap_and_no_thinking():
    from brain.mind.turn import _request

    kw = _request("m", "s", [], [{"name": "t"}], max_tokens=300)
    assert kw["max_tokens"] == 300 and "thinking" not in kw and "context_management" not in kw
