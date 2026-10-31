"""Tests for Smart Turn's feature code: numpy only, no onnxruntime."""

import numpy as np

from brain.voice import smart_turn

SECOND = 16_000


def tone(seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * SECOND)) / SECOND
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def test_features_have_the_model_shape_and_are_finite_for_silence():
    out = smart_turn.features(np.zeros(SECOND, dtype=np.float32))
    assert out.shape == (80, 800) and out.dtype == np.float32
    assert np.isfinite(out).all()


def test_ten_seconds_are_cut_to_the_last_eight():
    audio = tone(10)
    assert np.array_equal(smart_turn.features(audio), smart_turn.features(audio[-8 * SECOND :]))


def test_the_same_input_gives_the_same_features():
    audio = tone(3)
    assert np.array_equal(smart_turn.features(audio), smart_turn.features(audio.copy()))


def test_short_input_is_left_padded_with_silence():
    short = smart_turn.features(tone(2))
    # The first five seconds are padding: every column is the same constant, then the tone starts.
    assert np.allclose(short[:, :500], short[:, :1])
    assert not np.allclose(short[:, -100:], short[:, :1])


def test_speech_shows_in_the_low_mels_more_than_the_high_ones():
    out = smart_turn.features(tone(8))
    assert out[:20].mean() > out[60:].mean()


def test_empty_input_is_all_silence():
    out = smart_turn.features(np.zeros(0, dtype=np.float32))
    assert out.shape == (80, 800) and np.isfinite(out).all()
