"""Tests for Ears, the listening state machine: held and always, on fake models.

Ported from the desktop's local-ears tests; each frame is 32 ms and loud means speech.
"""

import pytest
from fake_voice import LOUD, QUIET, LevelVad, WordStt, parts, soft

from brain.voice.ears import GIVE_UP_FRAMES, MAX_STRETCH_FRAMES, PAUSE_FRAMES, PRE_ROLL_FRAMES, Ears


def hear(mode, p):
    events: list[str] = []
    ears = Ears(
        p, mode, lambda event, text: events.append(event if text is None else f"{event}:{text}")
    )
    return ears, events


def feed(ears, frame, times):
    for _ in range(times):
        ears.frame(frame)


def words(n):
    return " ".join(["word"] * n)


def test_silence_emits_nothing():
    ears, events = hear("always", parts())
    feed(ears, QUIET, 30)
    assert events == []


def test_first_speech_emits_speech_start_once():
    ears, events = hear("held", parts())
    feed(ears, LOUD, 5)
    assert events.count("speech_start") == 1 and events[0] == "speech_start"


def test_partial_every_ten_frames_only_when_text_changes():
    p = parts()
    ears, events = hear("held", p)
    feed(ears, LOUD, 10)
    assert events == ["speech_start", f"partial:{words(10)}"]
    p.stt.words = 10  # same text again: nothing new to say
    p.stt.accept = lambda frame: None
    feed(ears, LOUD, 10)
    assert [e for e in events if e.startswith("partial")] == [f"partial:{words(10)}"]


def test_pause_closes_stretch_and_emits_final():
    ears, events = hear("held", parts())
    feed(ears, LOUD, 3)
    feed(ears, QUIET, PAUSE_FRAMES)
    assert events[-1] == f"final:{words(3)}"


def test_always_turn_ends_when_end_of_turn_scores_over_threshold():
    ears, events = hear("always", parts(0.9))
    feed(ears, LOUD, 10)
    feed(ears, QUIET, PAUSE_FRAMES)
    assert events[-2:] == [f"final:{words(10)}", f"turn_end:{words(10)}"]


def test_always_keeps_listening_when_score_low_until_give_up_frames():
    p = parts(0.0)
    ears, events = hear("always", p)
    feed(ears, LOUD, 2)
    feed(ears, QUIET, PAUSE_FRAMES)
    assert not any(e.startswith("turn_end") for e in events)
    feed(ears, QUIET, GIVE_UP_FRAMES - 1)
    assert not any(e.startswith("turn_end") for e in events)
    feed(ears, QUIET, 1)
    assert events[-1] == f"turn_end:{words(2)}"


def test_always_joins_two_stretches_in_one_turn():
    ears, events = hear("always", parts(0.1, 0.9))
    feed(ears, LOUD, 2)
    feed(ears, QUIET, PAUSE_FRAMES)
    feed(ears, LOUD, 1)
    feed(ears, QUIET, PAUSE_FRAMES)
    assert [e for e in events if e.startswith("turn_end")] == ["turn_end:word word word"]


def test_held_finish_emits_last_words_then_one_turn_end():
    ears, events = hear("held", parts())
    feed(ears, LOUD, 2)  # still talking when the key is let go
    ears.finish()
    assert events[-2:] == [f"final:{words(2)}", f"turn_end:{words(2)}"]


def test_held_never_asks_end_of_turn_model():
    p = parts()
    ears, events = hear("held", p)
    feed(ears, LOUD, 2)
    feed(ears, QUIET, GIVE_UP_FRAMES + PAUSE_FRAMES)
    assert not any(e.startswith("turn_end") for e in events)
    ears.finish()
    assert p.turn.calls == []
    assert events[-1] == f"turn_end:{words(2)}"


def test_held_finish_with_nothing_said_still_ends_the_turn_empty():
    ears, events = hear("held", parts())
    feed(ears, QUIET, 5)
    ears.finish()
    assert events == ["turn_end:"]


def test_always_finish_drops_a_half_heard_turn():
    ears, events = hear("always", parts())
    feed(ears, LOUD, 3)
    ears.finish()
    feed(ears, QUIET, PAUSE_FRAMES)
    assert not any(e.startswith(("final", "turn_end")) for e in events)


def test_finish_twice_emits_one_turn_end():
    ears, events = hear("held", parts())
    feed(ears, LOUD, 2)
    ears.finish()
    ears.finish()
    assert sum(e.startswith("turn_end") for e in events) == 1


def test_stretch_over_max_frames_is_closed():
    ears, events = hear("always", parts())
    feed(ears, LOUD, MAX_STRETCH_FRAMES)
    assert any(e.startswith("final:") for e in events)
    assert any(e.startswith("turn_end:") for e in events)


def test_end_of_turn_model_error_counts_as_turn_over():
    ears, events = hear("always", parts(fail_turn=True))
    feed(ears, LOUD, 1)
    feed(ears, QUIET, PAUSE_FRAMES)
    assert events[-1] == "turn_end:word"


def test_held_finish_keeps_words_when_the_speech_model_fails():
    p = parts()
    ears, events = hear("held", p)
    feed(ears, LOUD, 2)
    p.stt.fail = True
    ears.finish()
    assert events[-1].startswith("turn_end:")


def test_pre_roll_frames_reach_stt_before_first_speech_frame():
    p = parts()
    ears, _ = hear("always", p)
    feed(ears, soft(0.05), 1)
    feed(ears, soft(0.06), 1)
    feed(ears, soft(0.07), 1)
    feed(ears, LOUD, 1)
    assert [round(x, 2) for x in p.stt.fed[:4]] == [0.05, 0.06, 0.07, 0.3]


def test_pre_roll_keeps_only_the_last_frames():
    p = parts()
    ears, _ = hear("always", p)
    feed(ears, soft(0.05), 20)
    feed(ears, LOUD, 1)
    assert PRE_ROLL_FRAMES == 8
    assert next(i for i, x in enumerate(p.stt.fed) if x >= 0.1) == PRE_ROLL_FRAMES


def test_nothing_is_fed_while_nobody_speaks():
    p = parts()
    ears, _ = hear("always", p)
    feed(ears, soft(0.05), 20)
    assert p.stt.fed == []


def test_audio_does_not_carry_from_one_turn_into_the_next():
    p = parts()
    ears, events = hear("always", p)
    feed(ears, soft(0.05), 3)
    feed(ears, LOUD, 2)
    feed(ears, soft(0.02), PAUSE_FRAMES)
    assert sum(e.startswith("turn_end") for e in events) == 1
    before = len(p.stt.fed)
    feed(ears, soft(0.08), 1)
    feed(ears, LOUD, 1)
    assert [round(x, 2) for x in p.stt.fed[before:]] == [0.08, 0.3]


def test_end_of_turn_model_hears_at_most_eight_seconds():
    p = parts(0.9)
    ears, _ = hear("always", p)
    feed(ears, LOUD, 400)  # 12.8 s without a pause
    feed(ears, QUIET, PAUSE_FRAMES)
    assert p.turn.calls == [8 * 16000]


def test_a_new_ears_resets_the_vad_state():
    vad = LevelVad()
    hear("held", parts(vad=vad))
    assert vad.resets == 1


def test_a_vad_error_propagates_so_the_service_can_end_the_session():
    ears, _ = hear("held", parts(vad=LevelVad(fail_on=3)))
    feed(ears, LOUD, 2)
    with pytest.raises(RuntimeError):
        ears.frame(LOUD)


def test_unused_word_stt_has_no_words():
    assert WordStt().text() == ""
