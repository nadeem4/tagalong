"""Kokoro (int8) text-to-speech through `kokoro-onnx`, as the Mouth's `Tts`.

The engine is handed to `Adapter`, so tests use a stub and never import the library; `load`
imports it lazily. Output is 24 kHz, turned from float to int16 for `speech` frames. An unknown
voice id speaks with the fallback voice rather than failing the sentence. Not unit tested
against the real model; covered by tests/voice_smoke.py, run by hand.
"""

from pathlib import Path
from typing import Protocol

import numpy as np

from brain.voice.models import KOKORO_FILES

FALLBACK_VOICE = "bm_george"


class _Engine(Protocol):
    def get_voices(self) -> list[str]: ...

    def create(self, text: str, voice: str, speed: float, lang: str): ...


class Adapter:
    def __init__(self, engine: _Engine) -> None:
        self._engine = engine
        self._voices = set(engine.get_voices())

    def synth(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        if voice not in self._voices:
            voice = FALLBACK_VOICE
        lang = "en-gb" if voice.startswith("b") else "en-us"  # b = British, a = American
        audio, rate = self._engine.create(text, voice=voice, speed=speed, lang=lang)
        return (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2"), rate


def load(folder: Path) -> Adapter:
    from kokoro_onnx import Kokoro

    model, voices = (folder / f.path for f in KOKORO_FILES)
    return Adapter(Kokoro(str(model), str(voices)))
