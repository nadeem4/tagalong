"""Supertonic text-to-speech through the `supertonic` package (MIT code, OpenRAIL-M weights).

The call used: `TTS(model="supertonic", model_dir=..., auto_download=False)` over the files the
brain pinned and downloaded itself, `get_voice_style("M1")` once per style, then
`synthesize(text, voice_style=..., speed=...)` giving a float32 (1, n) wave. The engine is handed
to `Adapter`, so tests use a stub; `load` imports the package lazily. Not unit tested against the
real model; covered by tests/voice_smoke.py, run by hand.
"""

from pathlib import Path
from typing import Any, Protocol

import numpy as np

from brain.voice.tts import Tts, TtsVoice


class _Engine(Protocol):
    sample_rate: int

    def get_voice_style(self, name: str) -> Any: ...

    def synthesize(self, text: str, voice_style: Any, speed: float = ...): ...


class Adapter:
    def __init__(self, engine: _Engine) -> None:
        self._engine = engine
        self._styles: dict[str, Any] = {}

    def synth(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        if voice not in self._styles:
            self._styles[voice] = self._engine.get_voice_style(voice)
        wav, _ = self._engine.synthesize(text, voice_style=self._styles[voice], speed=speed)
        samples = (np.clip(np.asarray(wav).reshape(-1), -1.0, 1.0) * 32767).astype("<i2")
        return samples, self._engine.sample_rate


def load(voice: TtsVoice, folder: Path) -> Tts:
    from supertonic import TTS

    # The package wants the folder that holds onnx/ and voice_styles/.
    config = next(f.path for f in voice.files if f.path.endswith("onnx/tts.json"))
    model_dir = (folder / config).parent.parent
    return Adapter(TTS(model="supertonic", model_dir=model_dir, auto_download=False))
