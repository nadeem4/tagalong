"""Tests for Mouth: a spoken reply goes out sentence by sentence, never stalling the loop."""

import asyncio
import base64
import threading

import numpy as np
from fake_voice import FakeTts

from brain.voice.mouth import Mouth
from brain.voice.shape import shape_chunk
from brain.voice.tts import SAMPLE_TEXT, voice_by_id

ALAN = voice_by_id("piper-alan")
GEORGE = voice_by_id("kokoro-george")

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


def mouth(sent, tts=None, *, load=None, steps=()):
    tts = tts or FakeTts()

    async def load_tts(voice, on_progress):
        for step in steps:
            on_progress(step)
        if load is not None:
            return await load()
        return tts

    return Mouth(sent, load_tts, lambda: ALAN, lambda _v: True), tts


async def settle(times: int = 12):
    for _ in range(times):
        await asyncio.sleep(0.005)


async def ready(m: Mouth):
    """Load the voice by speaking one throwaway turn, so later turns come out as audio."""
    m.spoken("warm", "d", None)
    m.reply("warm", {"delta": ONE + " "})
    m.reply("warm", {"done": True})
    await settle()


async def test_two_sentences_give_two_speech_then_done_in_order():
    sent = Sent()
    m, tts = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", 1.2)
    m.reply("t", {"delta": f"{ONE} {TWO}"})
    m.reply("t", {"done": True})
    await settle()
    out = sent.speech()
    assert [p.get("text") for p in out] == [ONE, TWO, None]
    assert out[-1] == {"turn": "t", "done": True}
    assert out[0]["sample_rate"] == 24_000
    assert len(base64.b64decode(out[0]["pcm"])) == 8640  # quiet audio is just the 180 ms gap
    assert tts.calls[-1] == (TWO, "alan", 1.2)


async def test_first_sentence_goes_before_the_second_delta_arrives():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} Then"})
    await settle()
    assert [p["text"] for p in sent.speech()] == [ONE]
    m.reply("t", {"delta": " more."})
    m.reply("t", {"done": True})
    await settle()
    assert [p.get("text") for p in sent.speech()] == [ONE, "Then more.", None]


async def test_short_sentences_are_grouped_into_one_chunk():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": "Done. All green. Shall I push? "})
    m.reply("t", {"done": True})
    await settle()
    assert [p.get("text") for p in sent.speech()] == ["Done. All green. Shall I push?", None]


async def test_the_chosen_voice_and_default_speed_when_the_say_gave_none():
    sent = Sent()
    m, tts = mouth(sent)
    await ready(m)
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} Then"})
    await settle()
    assert tts.calls[-1][1:] == ("alan", 1.0)


async def test_text_only_while_the_voice_loads_then_audio_once_ready():
    sent = Sent()
    gate = asyncio.Event()
    tts = FakeTts()

    async def slow():
        await gate.wait()
        return tts

    m, _ = mouth(sent, load=slow)
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} Then"})
    await settle()
    assert [("pcm" in p) for p in sent.speech()] == [False]
    gate.set()
    await settle()
    m.reply("t", {"delta": " more words follow."})
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
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {TWO} "})
    m.reply("t", {"done": True})
    await settle()
    assert [("pcm" in p) for p in sent.speech()] == [False, False, False]
    assert sent.voice() == []
    assert attempts["n"] == 1
    m.spoken("u", "d", None)
    m.reply("u", {"delta": f"{ONE} Then"})
    await settle()
    assert attempts["n"] == 2


async def test_the_system_voice_gets_text_only_and_kokoro_is_never_loaded():
    sent = Sent()
    attempts = {"n": 0}

    async def load():
        attempts["n"] += 1
        return FakeTts()

    m, _ = mouth(sent, load=load)
    m.spoken("t", "d", 1.2, True)
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
    m.spoken("a", "d", None)
    m.spoken("b", "e", None)
    for turn in ("a", "b"):
        m.reply(turn, {"delta": f"{ONE} {TWO} "})
        m.reply(turn, {"done": True})
    sample = asyncio.create_task(m.sample(ALAN.id, None))
    await asyncio.sleep(0.5)
    await sample
    assert tts.max_active == 1


async def test_a_turn_cleared_then_spoken_again_speaks_again():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.03))
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {TWO} "})
    await asyncio.sleep(0.01)
    m.clear("t")
    m.spoken("t", "d", None)  # a joined spoken say after the barge-in
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
    m.spoken("t", "d", None)
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} Then"})
    m.reply("t", {"done": True})
    await settle()
    assert [p.get("done") for p in sent.speech() if "text" not in p].count(True) == 1


async def test_clear_drops_only_that_turn():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    sent.frames.clear()
    m.spoken("a", "d", None)
    m.spoken("b", "e", None)
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
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {TWO} {ONE} "})
    await asyncio.sleep(0.01)
    m.clear()  # a hush mid-synth
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{TWO} {ONE} "})
    m.reply("t", {"done": True})
    await asyncio.sleep(0.4)
    assert tts.max_active == 1


async def test_pause_keeps_unsaid_sentences():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {big('a')} {big('b')} Next"})
    await asyncio.sleep(0.02)
    m.pause()
    await asyncio.sleep(0.3)
    assert [p.get("text") for p in sent.speech()] == [ONE]  # the one in flight was sent
    assert m.unsaid("t") == [big("a"), big("b")]


async def test_resume_continues_in_order():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.03))
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
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
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} Then"})
    await asyncio.sleep(0.15)  # the first sentence is out and the reply is still open
    m.pause()
    m.resume()
    m.reply("t", {"delta": " more."})
    m.reply("t", {"done": True})
    await asyncio.sleep(0.3)
    assert seen == ["sentence_break", "talking", "sentence_break", "paused", "sentence_break",
                    "talking", "idle"]  # fmt: skip


async def test_pause_and_resume_tell_the_body_that_plays_the_turn():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.03))
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.pause()
    m.resume()
    controls = [(b, p) for b, meth, p in sent.frames if meth == "speech_control"]
    assert controls == [("d", {"action": "pause"}), ("d", {"action": "resume"})]


async def test_pause_still_reaches_the_body_after_the_last_sentence_was_sent():
    sent = Sent()
    m, _ = mouth(sent, FakeTts())
    await ready(m)
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} "})
    m.reply("t", {"done": True})
    await asyncio.sleep(0.2)  # every frame is out, the turn is dropped, the body still plays
    sent.frames.clear()
    m.pause()
    assert [(b, p) for b, meth, p in sent.frames if meth == "speech_control"] == [
        ("d", {"action": "pause"})
    ]


async def test_pause_with_nothing_spoken_sends_no_control():
    sent = Sent()
    m, _ = mouth(sent, FakeTts())  # nothing was ever sent, so nobody plays anything
    m.pause()
    m.resume()
    assert sent.frames == []
    assert m.state == "idle"


async def test_no_displaying_body_sends_nothing():
    sent = Sent()
    m, tts = mouth(sent)
    m.spoken("t", None, None)
    m.reply("t", {"delta": f"{ONE} "})
    m.reply("t", {"done": True})
    await settle()
    assert sent.frames == [] and tts.calls == []


async def test_a_delta_after_done_is_ignored():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
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
    m.spoken("t", "d", None)
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
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} Then"})
    ticks = 0
    for _ in range(8):  # the loop keeps ticking while the thread sleeps
        await asyncio.sleep(0.005)
        ticks += 1
    await settle()
    assert ticks == 8 and tts.threads and threading.get_ident() not in tts.threads


async def test_sample_is_a_wav_made_with_the_given_voice():
    sent = Sent()
    m, tts = mouth(sent)
    wav = await m.sample(ALAN.id, 0.9)
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    assert tts.calls == [(SAMPLE_TEXT, "alan", 0.9)]


async def test_speech_frames_are_numbered_from_one():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {TWO}"})
    m.reply("t", {"done": True})
    await settle()
    out = sent.speech()
    assert [p.get("n") for p in out] == [1, 2, None]


async def test_sentences_returns_what_was_sent_in_order():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {TWO}"})
    m.reply("t", {"done": True})
    await settle()
    assert m.sentences("t") == [ONE, TWO]


async def test_sentences_survive_clear():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    m.spoken("t", "d", None)
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
        m.spoken(f"t{i}", "d", None)
        m.reply(f"t{i}", {"delta": f"{ONE} "})
        m.reply(f"t{i}", {"done": True})
        await settle()
    assert m.sentences("t0") == []
    assert m.sentences("t3") == [ONE]


async def test_sentences_include_those_made_but_not_yet_sent():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {big('a')} {big('b')}"})
    m.reply("t", {"done": True})
    await asyncio.sleep(0.01)
    assert m.sentences("t")[:2] == [ONE, big("a")]
    assert len(m.sentences("t")) == 3
    m.clear()


async def test_unsent_sentences_survive_clear():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {big('a')} {big('b')}"})
    m.reply("t", {"done": True})
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
    m.spoken("a", "d", None)
    m.reply("a", {"delta": f"{ONE} Then"})
    await settle()
    m.spoken("b", "d", None)
    m.reply("b", {"delta": f"{TWO} "})
    m.reply("b", {"done": True})
    await settle()
    assert [p.get("text") for p in sent.speech() if p["turn"] == "b"] == [TWO, None]


async def test_close_ends_the_worker():
    m, _ = mouth(Sent())
    m.spoken("t", "d", None)
    worker = m._worker
    await m.close()
    assert worker is not None and worker.done()


async def test_clear_trims_the_sentence_log_too():
    m, _ = mouth(Sent())
    for i in range(5):
        m.spoken(f"t{i}", "d", None)
        m._turns[f"t{i}"].unsent.append("x")
        m.clear(f"t{i}")
    assert m.sentences("t0") == [] and m.sentences("t4") == ["x"]


async def test_replace_clears_the_body_and_says_the_new_text_as_a_turn_of_its_own():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", 1.2)
    m.pause()  # an interjection holds the queue
    m.reply("t", {"delta": f"{ONE} {TWO} "})
    new = m.replace("t", "d", "Sam wrote back.")
    m.reply("t", {"delta": "More from the old reply. "})  # the turn still writing: not said
    m.resume()
    m.reply("t", {"done": True})
    await settle()
    controls = [p for b, meth, p in sent.frames if meth == "speech_control"]
    assert {"action": "clear", "turn": "t"} in controls  # the player holds sent sentences
    assert new is not None and new != "t"  # the body silences a cleared turn id for good
    said = [(p["turn"], p["text"]) for p in sent.speech() if p.get("text")]
    assert said == [(new, "Sam wrote back.")]  # nothing of the old turn is said
    assert m.unsaid("t") == []


async def test_replace_of_a_turn_that_is_gone_says_nothing():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    assert m.replace("gone", "d", "Quick word first.") is None
    await settle()
    assert sent.frames == []


async def test_speaking_is_true_only_for_a_live_turn_on_that_body():
    m, _ = mouth(Sent())
    m.spoken("t", "d", None)
    assert m.speaking("t", "d") and not m.speaking("t", "other") and not m.speaking("x", "d")


async def test_resume_without_telling_leaves_the_body_player_alone():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.03))
    await ready(m)
    m.spoken("t", "d", None)
    m.pause()
    sent.frames.clear()
    m.resume(tell=False)  # the person paused it
    assert [f for f in sent.frames if f[1] == "speech_control"] == []


async def test_prefetch_loads_the_voice_without_a_sentence_and_reports_progress():
    sent = Sent()
    seen: list[dict] = []
    m, _ = mouth(sent, steps=(0.0, 0.5, 1.0))
    m.on_download = lambda: seen.append(dict(m.download))
    assert m.download == {"voice": "piper-alan", "status": "idle", "progress": 0.0}
    m.prefetch()
    await settle()
    assert [d["status"] for d in seen][0] == "downloading"
    assert [d["progress"] for d in seen if d["status"] == "downloading"] == [0.0, 0.5]
    assert m.download == {"voice": "piper-alan", "status": "ready", "progress": 1.0}
    assert sent.frames == []  # nothing was said


async def test_system_voice_until_ready_then_kokoro_from_the_next_sentence():
    sent = Sent()
    gate = asyncio.Event()
    tts = FakeTts()

    async def slow():
        await gate.wait()
        return tts

    m, _ = mouth(sent, load=slow, steps=(0.3,))
    m.prefetch()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} Then"})
    await settle()
    assert m.download["status"] == "downloading"
    gate.set()
    await settle()
    m.reply("t", {"delta": " more words follow."})
    m.reply("t", {"done": True})
    await settle()
    assert [("pcm" in p) for p in sent.speech()] == [False, True, False]


async def test_a_failed_download_says_so_keeps_the_system_voice_and_retries_on_request():
    sent = Sent()
    attempts = {"n": 0}
    tts = FakeTts()

    async def flaky():
        attempts["n"] += 1
        if attempts["n"] <= 2:  # the prefetch, then the spoken turn that tries again
            raise OSError("no network")
        return tts

    m, _ = mouth(sent, load=flaky, steps=(0.5,))
    m.prefetch()
    await settle()
    assert m.download["status"] == "failed"
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} "})
    m.reply("t", {"done": True})
    await settle()
    assert [("pcm" in p) for p in sent.speech()][0] is False  # still spoken, by the system
    seen: list[str] = []
    m.on_download = lambda: seen.append(str(m.download["status"]))
    m.retry()
    await settle()
    assert seen[0] == "downloading" and seen[-1] == "ready"
    assert m.download["status"] == "ready"
    assert attempts["n"] == 3


async def test_a_cached_voice_never_flashes_downloading():
    sent = Sent()
    seen: list[str] = []
    m, _ = mouth(sent, steps=(1.0,))
    m.on_download = lambda: seen.append(str(m.download["status"]))
    m.prefetch()
    await settle()
    assert seen == ["ready"]


def big(tag: str) -> str:
    """A 30-word sentence: a chunk of its own."""
    return f"Part {tag} " + "word " * 27 + "ends."


SECOND = "I also read the long notes twice over."
THIRD = "Then I wrote the short summary for you."


async def test_a_reply_goes_out_as_chunks():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {SECOND} {THIRD}"})
    m.reply("t", {"done": True})
    await settle()
    out = sent.speech()
    assert [(p.get("n"), p.get("text")) for p in out] == [
        (1, ONE),
        (2, f"{SECOND} {THIRD}"),
        (None, None),
    ]


async def test_every_frame_text_is_a_whole_chunk():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {big('a')} {big('b')}"})
    m.reply("t", {"done": True})
    await settle()
    assert [p.get("text") for p in sent.speech()] == [ONE, big("a"), big("b"), None]


async def test_unsaid_after_a_cut_includes_the_interrupted_chunk():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {big('a')} {big('b')}"})
    m.reply("t", {"done": True})
    await asyncio.sleep(0.08)  # chunk 1 is out, chunk 2 is being made
    m.clear()
    await asyncio.sleep(0.2)
    assert [p.get("n") for p in sent.speech()] == [1]
    assert m.sentences("t") == [ONE, big("a"), big("b")]


async def test_text_the_chunker_still_holds_survives_a_cut():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} {SECOND} {THIRD} Last."})  # the last three wait for a chunk
    await asyncio.sleep(0.02)
    m.clear()
    assert m.sentences("t") == [ONE, f"{SECOND} {THIRD} Last."]  # "Last." was still in the stream


async def test_paragraph_end_is_carried_with_the_chunk():
    sent = Sent()
    m, _ = mouth(sent)
    m.spoken("t", "d", None)
    m.pause()  # keep the chunk in the queue to look at it
    m.reply("t", {"delta": f"{ONE}\n\n{SECOND}"})
    assert [c.paragraph_end for _, c in m._queue] == [True]


async def test_a_cut_keeps_text_the_splitter_still_holds():
    sent = Sent()
    m, _ = mouth(sent, FakeTts(sleep=0.05))
    await ready(m)
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE} Then there is more to say"})  # no mark yet: held in the stream
    await asyncio.sleep(0.02)
    m.clear()
    assert m.sentences("t")[-1] == "Then there is more to say"


class ToneTts:
    """One second of tone padded with half a second of silence each side, at 24 kHz."""

    def __init__(self) -> None:
        self.texts: list[str] = []

    def synth(self, text: str, voice: str, speed: float):
        self.texts.append(text)
        tone = (np.sin(np.arange(24_000) * 0.3) * 12_000).astype(np.int16)
        pad = np.zeros(12_000, dtype=np.int16)
        return np.concatenate([pad, tone, pad]), 24_000


async def test_the_voice_is_given_the_ear_text_and_the_audio_is_shaped():
    sent = Sent()
    tts = ToneTts()
    m, _ = mouth(sent, tts)
    await ready(m)
    sent.frames.clear()
    tts.texts.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": "We meet at 3:30."})
    m.reply("t", {"done": True})
    await settle()
    out = sent.speech()
    assert tts.texts == ["We meet at three thirty."]
    assert out[0]["text"] == "We meet at three thirty."
    raw, _rate = tts.synth("x", "v", 1.0)
    expected = shape_chunk(raw, 24_000, paragraph_end=False)
    assert len(base64.b64decode(out[0]["pcm"])) == len(expected) * 2


async def test_an_aside_alone_sends_no_frame():
    sent = Sent()
    m, _ = mouth(sent)
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": "(see below)"})
    m.reply("t", {"done": True})
    await settle()
    assert [p.get("text") for p in sent.speech()] == [None]


async def test_a_paragraph_end_chunk_has_the_longer_gap():
    sent = Sent()
    m, _ = mouth(sent, ToneTts())
    await ready(m)
    sent.frames.clear()
    m.spoken("t", "d", None)
    m.reply("t", {"delta": f"{ONE}\n\n"})
    m.reply("t", {"delta": f"{TWO}"})
    m.reply("t", {"done": True})
    await settle()
    first, second = sent.speech()[:2]
    longer = len(base64.b64decode(first["pcm"])) - len(base64.b64decode(second["pcm"]))
    assert longer == (24_000 * (450 - 180) // 1000) * 2


# --- the chosen voice: loaded latest-pick-only, with fallback ---------------------------------


class Voices:
    """A controllable `load_tts`: each load waits on its own future, so a test decides when
    (and whether) a voice arrives."""

    def __init__(self) -> None:
        self.pick = ALAN
        self.futures: dict[str, asyncio.Future] = {}
        self.tts = {ALAN.id: FakeTts(), GEORGE.id: FakeTts()}
        self.loads: list[str] = []

    async def load(self, voice, on_progress):
        self.loads.append(voice.id)
        self.futures[voice.id] = asyncio.get_running_loop().create_future()
        await self.futures[voice.id]
        return self.tts[voice.id]

    def mouth(self, sent) -> Mouth:
        return Mouth(sent, self.load, lambda: self.pick)

    def arrive(self, voice) -> None:
        self.futures[voice.id].set_result(None)


async def say(m: Mouth, turn: str, text: str = ONE) -> None:
    m.spoken(turn, "d", None)
    m.reply(turn, {"delta": text + " Then"})
    m.reply(turn, {"done": True})
    await settle()


async def test_first_run_with_nothing_ready_sends_text_only_then_switches():
    sent, v = Sent(), Voices()
    m = v.mouth(sent)
    await say(m, "a")
    assert ["pcm" in p for p in sent.speech() if p.get("text")] == [False, False]
    v.arrive(ALAN)
    await settle()
    sent.frames.clear()
    await say(m, "b")
    assert all("pcm" in p for p in sent.speech() if p.get("text"))


async def test_a_new_pick_while_downloading_cancels_the_old_load():
    sent, v = Sent(), Voices()
    m = v.mouth(sent)
    await say(m, "a")  # starts loading ALAN
    first = v.futures[ALAN.id]
    v.pick = GEORGE
    m.choose(GEORGE)
    await settle()
    assert first.cancelled()
    assert v.loads == [ALAN.id, GEORGE.id]
    assert m.download["voice"] == GEORGE.id and m.download["status"] != "failed"
    v.arrive(GEORGE)
    await settle()
    assert m.download == {"voice": GEORGE.id, "status": "ready", "progress": 1.0}


async def test_speech_continues_in_the_ready_voice_while_the_new_one_downloads():
    sent, v = Sent(), Voices()
    m = v.mouth(sent)
    await say(m, "a")
    v.arrive(ALAN)
    await settle()
    v.pick = GEORGE
    m.choose(GEORGE)
    await settle()
    await say(m, "b")
    assert v.tts[ALAN.id].calls and not v.tts[GEORGE.id].calls
    v.arrive(GEORGE)
    await settle()
    await say(m, "c")
    assert v.tts[GEORGE.id].calls[-1][1] == "bm_george"


async def test_a_pick_of_an_already_loaded_voice_is_instant():
    sent, v = Sent(), Voices()
    m = v.mouth(sent)
    await say(m, "a")
    v.arrive(ALAN)
    await settle()
    v.pick = GEORGE
    m.choose(GEORGE)
    await settle()
    v.arrive(GEORGE)
    await settle()
    v.pick = ALAN
    m.choose(ALAN)
    await say(m, "b")
    assert v.loads == [ALAN.id, GEORGE.id]  # no third load
    assert v.tts[ALAN.id].calls[-1][1] == "alan"
    assert m.download["status"] == "ready" and m.download["voice"] == ALAN.id


async def test_failed_load_reports_failed_and_retry_works():
    sent = Sent()
    attempts = {"n": 0}

    async def load(voice, on_progress):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise OSError("offline")
        return FakeTts()

    m = Mouth(sent, load, lambda: ALAN)
    await say(m, "a")
    assert m.download == {"voice": ALAN.id, "status": "failed", "progress": 0.0}
    m.retry()
    await settle()
    assert m.download["status"] == "ready" and attempts["n"] == 2


async def test_voice_never_switches_inside_a_chunk():
    sent, v = Sent(), Voices()
    v.tts[ALAN.id] = FakeTts(sleep=0.05)
    m = v.mouth(sent)
    await say(m, "a")
    v.arrive(ALAN)
    await settle()
    v.pick = GEORGE
    m.choose(GEORGE)
    await settle()
    v.arrive(GEORGE)
    await settle()
    v.pick = ALAN
    m.choose(ALAN)
    m.spoken("b", "d", None)
    m.reply("b", {"delta": f"{ONE} {TWO} "})
    await asyncio.sleep(0.02)  # the first chunk is being made in ALAN
    v.pick = GEORGE
    m.choose(GEORGE)
    m.reply("b", {"done": True})
    await settle(40)
    assert v.tts[ALAN.id].calls[-1][0] == ONE  # that chunk stayed ALAN's
    assert v.tts[GEORGE.id].calls[-1][0] == TWO  # the next one switched


async def test_a_synth_error_in_one_chunk_does_not_stop_the_turns_speech():
    class Flaky:
        def __init__(self):
            self.calls = 0

        def synth(self, text, voice, speed):
            self.calls += 1
            if self.calls == 1:
                raise ValueError("unsupported character")
            return np.full(100, 7, dtype=np.int16), 24_000

    async def load(voice, progress):
        return Flaky()

    sent = Sent()
    m = Mouth(sent, load, lambda: ALAN)
    await ready(m)  # loads the voice; nothing is synthesised yet
    sent.frames.clear()
    await say(m, "a", f"{ONE} {TWO}")
    spoken = [p for p in sent.speech() if p.get("text")]
    assert "pcm" not in spoken[0] and "pcm" in spoken[-1]  # the bad chunk went out as text
    assert sent.speech()[-1] == {"turn": "a", "done": True}
