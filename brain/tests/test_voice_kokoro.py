"""Tests for the Kokoro adapter, with a stub engine so the real library is never imported."""

import numpy as np

from brain.voice.kokoro import FALLBACK_VOICE, Adapter


class StubEngine:
    def __init__(self, samples: np.ndarray) -> None:
        self.samples = samples
        self.asked: list[tuple[str, str, float, str]] = []

    def get_voices(self) -> list[str]:
        return ["bm_george", "af_bella"]

    def create(self, text: str, voice: str, speed: float, lang: str):
        self.asked.append((text, voice, speed, lang))
        return self.samples, 24_000


def test_synth_returns_int16_samples_and_the_sample_rate():
    engine = StubEngine(np.array([0.0, 0.5, -0.5, 1.5], dtype=np.float32))
    samples, rate = Adapter(engine).synth("Hi.", "af_bella", 1.1)
    assert rate == 24_000
    assert samples.dtype == np.int16
    assert samples.tolist() == [0, 16383, -16383, 32767]  # louder than full scale is clipped
    assert engine.asked == [("Hi.", "af_bella", 1.1, "en-us")]


def test_a_british_voice_speaks_british_english():
    engine = StubEngine(np.zeros(3, dtype=np.float32))
    Adapter(engine).synth("Hi.", "bm_george", 1.0)
    assert engine.asked[0][3] == "en-gb"


def test_unknown_voice_falls_back():
    engine = StubEngine(np.zeros(3, dtype=np.float32))
    Adapter(engine).synth("Hi.", "nobody", 1.0)
    assert engine.asked[0][1] == FALLBACK_VOICE == "bm_george"
