"""The engine registry: every roster row has an adapter; Kokoro rows load through it."""

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from brain.voice import tts_engines
from brain.voice.tts import ENGINE_NAMES, load_voices, voice_by_id


def test_every_roster_engine_has_an_adapter() -> None:
    assert set(tts_engines.TTS_ENGINES) == set(ENGINE_NAMES)
    for v in load_voices():
        assert v.engine in tts_engines.TTS_ENGINES


def test_kokoro_rows_load_through_the_registry(monkeypatch, tmp_path: Path) -> None:
    made: list[tuple[str, str]] = []
    spoken: list[str] = []

    class StubKokoro:
        def __init__(self, model: str, voices: str) -> None:
            made.append((Path(model).name, Path(voices).name))

        def get_voices(self) -> list[str]:
            return ["bm_george", "bm_fable"]

        def create(self, text: str, voice: str, speed: float, lang: str):
            spoken.append(voice)
            return np.zeros(3, dtype=np.float32), 24000

    monkeypatch.setitem(sys.modules, "kokoro_onnx", SimpleNamespace(Kokoro=StubKokoro))
    row = voice_by_id("kokoro-george")
    assert row is not None
    adapter = tts_engines.TTS_ENGINES[row.engine].load(row, tmp_path)
    samples, rate = adapter.synth("Hi", row.voice, 1.0)
    assert made == [("kokoro-v1.0.int8.onnx", "voices-v1.0.bin")]
    assert (len(samples), rate) == (3, 24000)
    assert spoken == ["bm_george"]
