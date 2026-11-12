"""Interjections: news that may speak at the next pause borrows the speech queue while Scout talks.

The queue pauses at the sentence break, one short model call sees the news and the sentences
the body has not finished, and Scout picks continue or replace (no pick continues). The voice is
the real Mouth, and the body's progress arrives as the `ended n` it would report; only the model
and the speech synthesis are fakes.
"""

import asyncio
import copy
from types import SimpleNamespace

import pytest
from fake_voice import FakeTts
from test_sessions import join, make, read_aloud, settle, spoken_say

import brain.sessions as sessions_module
from brain.events import Event, EventKind
from brain.mind.turn import Final
from brain.voice.mouth import Mouth

KINDS = {"nudge": EventKind("nudge", urgency="next_pause", batch_seconds=0, max_per_hour=10)}
SENTENCES = [
    "The first part of the story is about a quiet harbour town.",
    "The second part is about the old lighthouse keeper's cat.",
    "The third part is about a storm that nobody saw coming.",
    "The fourth part is about how the town rebuilt together.",
]
HEARD = 2  # the body finished two sentences when the break came
SAID = "Sam wrote back, want it now?"


class Bodies:
    """Records the frames the Mouth sends to the body."""

    def __init__(self):
        self.frames: list[tuple[str, str, dict]] = []

    def send_live(self, body_id, method, params):
        self.frames.append((body_id, method, params))
        return True

    def controls(self):
        return [p["action"] for _, m, p in self.frames if m == "speech_control"]

    def said(self):
        return [p["text"] for _, m, p in self.frames if m == "speech" and p.get("text")]


class MouthVoice:
    """The session's voice seam over a real Mouth with a fake synthesiser."""

    def __init__(self):
        self.bodies = Bodies()

        async def load():
            return FakeTts()

        self.mouth = Mouth(self.bodies, load)

    def spoken(self, turn, body_id, voice, speed, system_voice=False):
        self.mouth.spoken(turn, body_id, voice, speed, system_voice)

    def reply(self, turn, body_id, params):
        self.mouth.reply(turn, params)

    def turn_ended(self, turn):
        self.mouth.end_turn(turn)

    def hush(self, body_id):
        for turn in self.mouth.turns_on(body_id):
            self.mouth.clear(turn)

    def sentences(self, turn):
        return self.mouth.sentences(turn)

    def speaking(self, turn, body_id):
        return self.mouth.speaking(turn, body_id)

    def pause(self):
        self.mouth.pause()

    def resume(self, tell=True):
        self.mouth.resume(tell)

    def replace(self, turn, body_id, text):
        return self.mouth.replace(turn, body_id, text)


class Scripted:
    """The first call is the running turn: it says the story, then waits on `gate`. An
    interjection is a call that passes `max_tokens`; `choice` is the tool it calls, if any, and
    `hold` (when set) keeps it waiting."""

    model_id = "claude-sonnet-5-5"

    def __init__(self, choice=None):
        self.gate = asyncio.Event()
        self.hold: asyncio.Event | None = None
        self.choice = choice
        self.calls: list[dict] = []

    async def stream(self, system, messages, tools, max_tokens=None):
        self.calls.append(
            {
                "system": system,
                "messages": copy.deepcopy(messages),
                "tools": tools,
                "max_tokens": max_tokens,
            }
        )
        if max_tokens is None:
            text = " ".join(SENTENCES) + " "
            yield text
            await self.gate.wait()
            yield Final([{"type": "text", "text": text}], "end_turn", SimpleNamespace())
            return
        if self.hold is not None:
            await self.hold.wait()
        content = []
        if self.choice is not None:
            name, args = self.choice
            content = [{"type": "tool_use", "id": "c1", "name": name, "input": args}]
        yield Final(content, "tool_use" if content else "end_turn", SimpleNamespace())

    @property
    def interjections(self):
        return [c for c in self.calls if c["max_tokens"] is not None]

    def plain_turns_with(self, text):
        return [c for c in self.calls if c["max_tokens"] is None and text in str(c["messages"])]


async def calm():
    """Real time for the Mouth's worker, which synthesises off the loop."""
    await asyncio.sleep(0.1)
    await settle()


async def talking(model):
    """A spoken turn still running while the desktop plays it; news arrives mid-speech."""
    session, _ = make(model, kinds=KINDS)
    session.voice = voice = MouthVoice()
    join(session, "desktop")
    read_aloud(session)
    await session.say("desktop", spoken_say("tell me a story"))
    await calm()
    session.dispatcher.set_speech_state("talking")
    session.post_event(Event("nudge", {"note": "Sam wrote back"}))
    await settle()
    return session, voice


async def at_the_break(session, heard=HEARD):
    turn = session._turn_id
    session.dispatcher.set_speech_state("sentence_break", "desktop", turn, heard)
    await calm()
    return turn


async def finish(session, model):
    model.gate.set()
    await settle()
    if session._task is not None:
        await asyncio.wait({session._task})
    await calm()


async def test_the_real_mouth_holds_all_four_sentences():
    model = Scripted()
    session, voice = await talking(model)
    assert voice.mouth.sentences(session._turn_id) == SENTENCES
    await finish(session, model)


async def test_interjection_waits_for_the_break_then_pauses_the_queue():
    model = Scripted()
    session, voice = await talking(model)
    assert "pause" not in voice.bodies.controls() and model.interjections == []
    await at_the_break(session)
    assert voice.bodies.controls()[0] == "pause" and len(model.interjections) == 1
    await finish(session, model)


async def test_the_call_sees_only_what_the_body_has_not_finished():
    model = Scripted()
    session, _ = await talking(model)
    await at_the_break(session)
    (call,) = model.interjections
    assert call["max_tokens"] <= 400
    assert len(call["messages"]) == 1  # no chat history: the news and what is left to say
    text = call["messages"][0]["content"][0]["text"]
    assert "Sam wrote back" in text
    assert all(s not in text for s in SENTENCES[:HEARD])  # the body already played these
    assert all(s in text for s in SENTENCES[HEARD:])
    assert [t["name"] for t in call["tools"]] == ["speech_continue", "speech_replace"]
    await finish(session, model)


@pytest.mark.parametrize(
    "choice", [None, ("speech_continue", {}), ("speech_replace", {"text": " "})]
)
async def test_continue_no_choice_or_empty_words_resumes_and_leaves_the_news_for_a_wake(choice):
    model = Scripted(choice=choice)
    session, voice = await talking(model)
    await at_the_break(session)
    assert voice.bodies.controls() == ["pause", "resume"]
    assert voice.bodies.said() == SENTENCES  # nothing was replaced
    await finish(session, model)
    assert model.plain_turns_with("Event: nudge")  # not told yet: a plain wake tells it


async def test_replace_clears_the_player_and_says_the_words_as_a_new_turn():
    model = Scripted(choice=("speech_replace", {"text": SAID}))
    session, voice = await talking(model)
    old = await at_the_break(session)
    clears = [p for _, m, p in voice.bodies.frames if m == "speech_control"]
    assert {"action": "clear", "turn": old} in clears
    await finish(session, model)
    frames = [p for _, m, p in voice.bodies.frames if m == "speech" and p.get("text") == SAID]
    assert len(frames) == 1 and frames[0]["turn"] != old
    assert voice.bodies.controls().count("pause") == 1


async def test_a_replace_counts_as_the_told_wake():
    model = Scripted(choice=("speech_replace", {"text": SAID}))
    session, _ = await talking(model)
    await at_the_break(session)
    await finish(session, model)
    assert len(model.calls) == 2  # the running turn, plus the interjection; no wake after
    assert not model.plain_turns_with("Event: nudge")


async def test_the_next_turn_is_told_what_was_cut_and_said_instead():
    model = Scripted(choice=("speech_replace", {"text": SAID}))
    session, _ = await talking(model)
    await at_the_break(session)
    await finish(session, model)
    model.gate.set()
    await session.say("desktop", spoken_say("go on"))
    await calm()
    await finish(session, model)
    (turn,) = model.plain_turns_with('kind="interjection"')
    text = str(turn["messages"])
    assert SAID in text and SENTENCES[HEARD] in text and SENTENCES[0] in text


async def test_the_person_talking_over_during_the_call_cancels_the_replace():
    model = Scripted(choice=("speech_replace", {"text": SAID}))
    model.hold = asyncio.Event()
    session, voice = await talking(model)
    turn = await at_the_break(session)
    session.interrupt(turn, HEARD)  # they spoke over Scout while the short call was out
    model.hold.set()
    await finish(session, model)
    assert SAID not in voice.bodies.said()  # no restarted turn
    assert voice.bodies.controls().count("resume") == 0  # their pause is left alone
    assert model.plain_turns_with("Event: nudge")  # the news waits for a plain wake


async def test_no_live_turn_means_no_replace_and_no_default_voice_restart():
    model = Scripted(choice=("speech_replace", {"text": SAID}))
    session, voice = await talking(model)
    voice.mouth.clear(session._turn_id)  # the owning turn is gone
    voice.bodies.frames.clear()
    await at_the_break(session)
    assert model.interjections == [] and voice.bodies.said() == []
    await finish(session, model)
    assert model.plain_turns_with("Event: nudge")


async def test_a_slow_call_times_out_resumes_and_keeps_the_news(monkeypatch):
    monkeypatch.setattr(sessions_module, "INTERJECTION_TIMEOUT_S", 0.05)
    model = Scripted(choice=("speech_replace", {"text": SAID}))
    model.hold = asyncio.Event()  # never released
    session, voice = await talking(model)
    await at_the_break(session)
    assert voice.bodies.controls() == ["pause", "resume"] and SAID not in voice.bodies.said()
    await finish(session, model)
    assert model.plain_turns_with("Event: nudge")


def test_the_timeout_is_short():
    assert sessions_module.INTERJECTION_TIMEOUT_S <= 5.0


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
