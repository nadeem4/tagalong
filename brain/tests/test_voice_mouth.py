"""Tests for Mouth: a spoken reply goes out sentence by sentence, never stalling the loop."""

import asyncio
import base64
import threading

from fake_voice import FakeTts

from brain.voice.mouth import Mouth

ONE = "The build finished and every single test passed."
TWO = "I also checked the docs and they are up to date."


class Sent:
    def __init__(self) -> None:
        self.frames: list[tuple[str, str, dict]] = []

    def send_live(self, body_id: str, method: str, params: dict) -> bool:
        self.frames.append((body_id, method, params))
        return True

    def speech(self, body_id: str = "d") -> list[dict]:
        return [p for b, m, p in self.frames if b == body_id and m == "speech"]

    def voice(self, body_id: str = "d") -> list[dict]:
        return [p for b, m, p in self.frames if b == body_id and m == "voice"]


def mouth(sent, tts=None, *, load=None):
    tts = tts or FakeTts()

    async def load_tts():
        if load is not None:
            return await load()
        return tts

    return Mouth(sent, load_tts), tts


async def settle(times: int = 12):
    for _ in range(times):
        await asyncio.sleep(0.005)


async def ready(m: Mouth):
    """Load the voice by speaking one throwaway turn, so later turns come out as audio."""
    m.spoken("warm", "d", None, None)
    m.reply("warm", {"delta": ONE + " "})
    m.reply("warm", {"done": True})
    await settle()


async def test_two_sentences_give_two_speech_then_done_in_order():
    sent = Sent()
    m, tts = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", "af_bella", 1.2)
    m.reply("t", {"delta": f"{ONE} {TWO}"})
    m.reply("t", {"done": True})
    await settle()
    out = sent.speech()
    assert [p.get("text") for p in out] == [ONE, TWO, None]
    assert out[-1] == {"turn": "t", "done": True}
    assert out[0]["sample_rate"] == 24_000
    assert len(base64.b64decode(out[0]["pcm"])) == 200  # 100 int16 samples
    assert tts.calls[-1] == (TWO, "af_bella", 1.2)


async def test_first_sentence_goes_before_the_second_delta_arrives():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} Then"})
    await settle()
    assert [p["text"] for p in sent.speech()] == [ONE]
    m.reply("t", {"delta": " more."})
    m.reply("t", {"done": True})
    await settle()
    assert [p.get("text") for p in sent.speech()] == [ONE, "Then more.", None]


async def test_short_sentences_queued_together_are_said_as_one():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": "Done. All green. Shall I push? "})
    m.reply("t", {"done": True})
    await settle()
    assert [p.get("text") for p in sent.speech()] == ["Done. All green. Shall I push?", None]


async def test_default_voice_and_speed_when_the_say_gave_none():
    sent = Sent()
    m, tts = mouth(sent)
    await ready(m)
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} "})
    await settle()
    assert tts.calls[-1][1:] == ("bm_george", 1.0)


async def test_text_only_while_the_voice_loads_then_audio_once_ready():
    sent = Sent()
    gate = asyncio.Event()
    tts = FakeTts()

    async def slow():
        await gate.wait()
        return tts

    m, _ = mouth(sent, load=slow)
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} "})
    await settle()
    assert [("pcm" in p) for p in sent.speech()] == [False]
    gate.set()
    await settle()
    m.reply("t", {"delta": f"{TWO} "})
    m.reply("t", {"done": True})
    await settle()
    assert [("pcm" in p) for p in sent.speech()] == [False, True, False]
    assert not [1 for _, method, _ in sent.frames if method == "voice"]  # that is the ears' channel


async def test_a_failed_load_stays_text_only_and_is_retried_next_turn():
    sent = Sent()
    attempts = {"n": 0}

    async def broken():
        attempts["n"] += 1
        raise OSError("no network")

    m, _ = mouth(sent, load=broken)
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} {TWO} "})
    m.reply("t", {"done": True})
    await settle()
    assert [("pcm" in p) for p in sent.speech()] == [False, False, False]
    assert sent.voice() == []
    assert attempts["n"] == 1
    m.spoken("u", "d", None, None)
    m.reply("u", {"delta": f"{ONE} "})
    await settle()
    assert attempts["n"] == 2


async def test_the_system_voice_gets_text_only_and_kokoro_is_never_loaded():
    sent = Sent()
    attempts = {"n": 0}

    async def load():
        attempts["n"] += 1
        return FakeTts()

    m, _ = mouth(sent, load=load)
    m.spoken("t", "d", "af_bella", 1.2, True)
    m.reply("t", {"delta": f"{ONE} {TWO} "})
    m.reply("t", {"done": True})
    await settle()
    out = sent.speech()
    assert [p.get("text") for p in out] == [ONE, TWO, None]
    assert not [1 for p in out if "pcm" in p]
    assert attempts["n"] == 0


async def test_two_turns_never_synthesise_at_once():
    sent = Sent()
    m, tts = mouth(sent, FakeTts(sleep=0.03))
    await ready(m)
    m.spoken("a", "d", None, None)
    m.spoken("b", "e", None, None)
    for turn in ("a", "b"):
        m.reply(turn, {"delta": f"{ONE} {TWO} "})
        m.reply(turn, {"done": True})
    sample = asyncio.create_task(m.sample("Hello there", None, None))
    await asyncio.sleep(0.5)
    await sample
    assert tts.max_active == 1


async def test_a_turn_cleared_then_spoken_again_speaks_again():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.03))
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} {TWO} "})
    await asyncio.sleep(0.01)
    m.clear("t")
    m.spoken("t", "d", None, None)  # a joined spoken say after the barge-in
    m.reply("t", {"delta": "Back again with more words. "})
    m.reply("t", {"done": True})
    await asyncio.sleep(0.3)
    texts = [p.get("text") for p in sent.speech()]
    assert "Back again with more words." in texts
    assert sent.speech()[-1] == {"turn": "t", "done": True}


async def test_spoken_twice_on_a_live_turn_is_one_turn():
    sent = Sent()
    m, tts = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None, None)
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} "})
    m.reply("t", {"done": True})
    await settle()
    assert [p.get("done") for p in sent.speech() if "text" not in p].count(True) == 1


async def test_clear_drops_only_that_turn():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    sent.frames.clear()
    m.spoken("a", "d", None, None)
    m.spoken("b", "e", None, None)
    for turn in ("a", "b"):
        m.reply(turn, {"delta": f"{ONE} {TWO} {ONE} "})
    await asyncio.sleep(0.02)
    m.clear("a")
    m.reply("a", {"delta": "Late words here. "})
    m.reply("a", {"done": True})
    await asyncio.sleep(0.4)
    assert len(sent.speech("d")) <= 1  # at most the one already being made
    assert not any(p.get("done") for p in sent.speech("d"))
    m.reply("b", {"done": True})
    await asyncio.sleep(0.5)
    assert [p.get("text") for p in sent.speech("e")][-1] is None


async def test_never_two_synths_at_once():
    sent = Sent()
    m, tts = mouth(sent, FakeTts(sleep=0.03))
    await ready(m)
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} {TWO} {ONE} "})
    await asyncio.sleep(0.01)
    m.clear()  # a hush mid-synth
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{TWO} {ONE} "})
    m.reply("t", {"done": True})
    await asyncio.sleep(0.4)
    assert tts.max_active == 1


async def test_pause_keeps_unsaid_sentences():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} {TWO} Third one is here too. "})
    await asyncio.sleep(0.02)
    m.pause()
    await asyncio.sleep(0.3)
    assert [p.get("text") for p in sent.speech()] == [ONE]  # the one in flight was sent
    assert m.unsaid("t") == [TWO, "Third one is here too."]


async def test_resume_continues_in_order():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.03))
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} {TWO} "})
    m.reply("t", {"done": True})
    await asyncio.sleep(0.01)
    m.pause()
    await asyncio.sleep(0.2)
    m.resume()
    await asyncio.sleep(0.3)
    assert [p.get("text") for p in sent.speech()] == [ONE, TWO, None]
    assert m.unsaid("t") == []


async def test_state_callback_sequence():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.03))
    await ready(m)
    seen: list[str] = []
    m.on_state = seen.append
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} Then"})
    await asyncio.sleep(0.15)  # the first sentence is out and the reply is still open
    m.pause()
    m.resume()
    m.reply("t", {"delta": " more."})
    m.reply("t", {"done": True})
    await asyncio.sleep(0.3)
    assert seen == ["sentence_break", "talking", "sentence_break", "paused", "sentence_break",
                    "talking", "idle"]  # fmt: skip
    assert m.state == "idle"


async def test_no_displaying_body_sends_nothing():
    sent = Sent()
    m, tts = mouth(sent)
    m.spoken("t", None, None, None)
    m.reply("t", {"delta": f"{ONE} "})
    m.reply("t", {"done": True})
    await settle()
    assert sent.frames == [] and tts.calls == []


async def test_a_delta_after_done_is_ignored():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} "})
    m.reply("t", {"done": True})
    m.reply("t", {"delta": f"{TWO} "})
    await settle()
    assert [p.get("text") for p in sent.speech()] == [ONE, None]


async def test_end_turn_finishes_a_reply_that_never_said_done():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": ONE})
    m.end_turn("t")
    m.end_turn("t")
    await settle()
    assert [p.get("text") for p in sent.speech()] == [ONE, None]


async def test_synthesis_runs_off_the_event_loop():
    sent = Sent()
    m, tts = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    tts.threads.clear()
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} "})
    ticks = 0
    for _ in range(8):  # the loop keeps ticking while the thread sleeps
        await asyncio.sleep(0.005)
        ticks += 1
    await settle()
    assert ticks == 8 and tts.threads and threading.get_ident() not in tts.threads


async def test_sample_is_a_wav_made_with_the_given_voice():
    sent = Sent()
    m, tts = mouth(sent)
    wav = await m.sample("Hello there.", "af_bella", 0.9)
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    assert tts.calls == [("Hello there.", "af_bella", 0.9)]


async def test_speech_frames_are_numbered_from_one():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} {TWO}"})
    m.reply("t", {"done": True})
    await settle()
    out = sent.speech()
    assert [p.get("n") for p in out] == [1, 2, None]


async def test_sentences_returns_what_was_sent_in_order():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} {TWO}"})
    m.reply("t", {"done": True})
    await settle()
    assert m.sentences("t") == [ONE, TWO]


async def test_sentences_survive_clear():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} {TWO}"})
    m.reply("t", {"done": True})
    await settle()
    m.clear()
    assert m.sentences("t") == [ONE, TWO]


async def test_sentences_of_an_unknown_turn_is_empty():
    m, _ = mouth(Sent())
    assert m.sentences("nope") == []


async def test_only_the_newest_three_turns_are_kept():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    for i in range(4):
        m.spoken(f"t{i}", "d", None, None)
        m.reply(f"t{i}", {"delta": f"{ONE} "})
        m.reply(f"t{i}", {"done": True})
        await settle()
    assert m.sentences("t0") == []
    assert m.sentences("t3") == [ONE]


async def test_sentences_include_those_made_but_not_yet_sent():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} {TWO} Third one is here too. "})
    await asyncio.sleep(0.01)
    assert m.sentences("t")[:2] == [ONE, TWO]
    assert len(m.sentences("t")) == 3
    m.clear()


async def test_unsent_sentences_survive_clear():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    m.spoken("t", "d", None, None)
    m.reply("t", {"delta": f"{ONE} {TWO} Third one is here too. "})
    await asyncio.sleep(0.01)
    before = m.sentences("t")
    assert len(before) == 3
    m.clear()
    await settle()
    assert m.sentences("t") == before  # sent and unsent alike, each once


async def test_worker_survives_a_send_error():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    real = sent.send_live
    calls = {"n": 0}

    def flaky(body_id, method, params):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OSError("socket gone")
        return real(body_id, method, params)

    sent.send_live = flaky
    m.spoken("a", "d", None, None)
    m.reply("a", {"delta": f"{ONE} "})
    await settle()
    m.spoken("b", "d", None, None)
    m.reply("b", {"delta": f"{TWO} "})
    m.reply("b", {"done": True})
    await settle()
    assert [p.get("text") for p in sent.speech() if p["turn"] == "b"] == [TWO, None]


async def test_close_ends_the_worker():
    m, _ = mouth(Sent())
    m.spoken("t", "d", None, None)
    worker = m._worker
    await m.close()
    assert worker is not None and worker.done()


async def test_clear_trims_the_sentence_log_too():
    m, _ = mouth(Sent())
    for i in range(5):
        m.spoken(f"t{i}", "d", None, None)
        m._turns[f"t{i}"].unsent.append("x")
        m.clear(f"t{i}")
    assert m.sentences("t0") == [] and m.sentences("t4") == ["x"]
