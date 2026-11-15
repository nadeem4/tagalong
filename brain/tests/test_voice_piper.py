"""The Piper adapter on a stub engine: chunks joined into one int16 clip, speed as length scale."""

from types import SimpleNamespace

import numpy as np

from brain.voice.piper import Adapter


class StubPiper:
    def __init__(self, chunks: list[np.ndarray], length_scale: float = 1.0) -> None:
        self.chunks = chunks
        self.config = SimpleNamespace(sample_rate=22050, length_scale=length_scale)
        self.seen: list[tuple[str, float | None]] = []

    def synthesize(self, text: str, syn_config=None):
        self.seen.append((text, syn_config.length_scale))
        for c in self.chunks:
            yield SimpleNamespace(audio_int16_array=c, sample_rate=22050)


def test_piper_joins_chunks_into_int16() -> None:
    a, b = np.array([1, 2], dtype="<i2"), np.array([3], dtype="<i2")
    samples, rate = Adapter(StubPiper([a, b])).synth("Hi. There.", "alan", 1.0)
    assert samples.dtype == np.dtype("<i2")
    assert samples.tolist() == [1, 2, 3]
    assert rate == 22050


def test_piper_speed_sets_length_scale() -> None:
    stub = StubPiper([np.zeros(2, dtype="<i2")])
    Adapter(stub).synth("Hi", "alan", 0.5)
    assert stub.seen == [("Hi", 2.0)]


def test_piper_with_no_chunks_is_an_empty_clip_at_the_voice_rate() -> None:
    samples, rate = Adapter(StubPiper([])).synth("", "alan", 1.0)
    assert len(samples) == 0 and samples.dtype == np.dtype("<i2")
    assert rate == 22050


def test_piper_scales_the_voices_own_length_scale() -> None:
    stub = StubPiper([np.zeros(2, dtype="<i2")], length_scale=1.2)
    Adapter(stub).synth("Hi", "alan", 2.0)
    assert stub.seen == [("Hi", 0.6)]
