"""Tests for shape_chunk: silence trimmed, edges faded, a set gap after each chunk."""

import numpy as np

from brain.voice.shape import GAP_MS, KEEP_MS, PARAGRAPH_GAP_MS, shape_chunk

RATE = 24_000


def ms(n: float) -> int:
    return int(RATE * n / 1000)


def tone(seconds: float) -> np.ndarray:
    t = np.arange(int(RATE * seconds))
    return (np.sin(t * 0.3) * 12_000).astype(np.int16)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(RATE * seconds), dtype=np.int16)


def test_trims_both_edges():
    samples = np.concatenate([silence(0.5), tone(1.0), silence(0.5)])
    out = shape_chunk(samples, RATE, paragraph_end=False)
    expected = RATE + 2 * ms(KEEP_MS) + ms(GAP_MS)
    assert abs(len(out) - expected) <= 2
    assert out.dtype == np.int16


def test_fades_so_edges_are_zero():
    out = shape_chunk(tone(1.0), RATE, paragraph_end=False)
    assert out[0] == 0
    assert out[len(out) - ms(GAP_MS) - 1] == 0
    assert not out[len(out) - ms(GAP_MS) :].any()  # the gap is silence


def test_paragraph_gap_is_longer():
    short = shape_chunk(tone(1.0), RATE, paragraph_end=False)
    long = shape_chunk(tone(1.0), RATE, paragraph_end=True)
    assert len(long) - len(short) == ms(PARAGRAPH_GAP_MS) - ms(GAP_MS)


def test_all_silence_does_not_raise():
    out = shape_chunk(silence(0.5), RATE, paragraph_end=False)
    assert 0 < len(out) < ms(1000)
    assert not out.any()


def test_empty_input_is_just_the_gap():
    out = shape_chunk(np.zeros(0, dtype=np.int16), RATE, paragraph_end=False)
    assert len(out) == ms(GAP_MS)


def test_loud_start_is_not_cut():
    out = shape_chunk(tone(1.0), RATE, paragraph_end=False)
    assert len(out) == RATE + ms(GAP_MS)
