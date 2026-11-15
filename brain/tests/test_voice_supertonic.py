"""The Supertonic adapter on a stub engine: float wav to int16, styles loaded once by name."""

import numpy as np

from brain.voice.supertonic import Adapter


class StubSupertonic:
    sample_rate = 44100

    def __init__(self) -> None:
        self.styles: list[str] = []
        self.calls: list[tuple[str, object, float]] = []

    def get_voice_style(self, name: str) -> str:
        self.styles.append(name)
        return f"style-{name}"

    def synthesize(self, text: str, voice_style: object, speed: float = 1.0, **_: object):
        self.calls.append((text, voice_style, speed))
        return np.array([[0.0, 0.5, -2.0]], dtype=np.float32), np.array([0.1])


def test_supertonic_returns_int16_and_rate() -> None:
    samples, rate = Adapter(StubSupertonic()).synth("Hi", "M1", 1.0)
    assert samples.dtype == np.dtype("<i2")
    assert samples.tolist() == [0, 16383, -32767]  # clipped, scaled, one channel flattened
    assert rate == 44100


def test_supertonic_loads_each_style_once_and_passes_speed() -> None:
    stub = StubSupertonic()
    adapter = Adapter(stub)
    adapter.synth("a", "M1", 1.0)
    adapter.synth("b", "M1", 1.2)
    assert stub.styles == ["M1"]
    assert stub.calls == [("a", "style-M1", 1.0), ("b", "style-M1", 1.2)]
