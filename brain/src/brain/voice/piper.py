"""Piper text-to-speech through `piper-tts` (GPL-3.0, run in-process like espeak-ng), as a `Tts`.

The voice object is handed to `Adapter`, so tests use a stub and never import the library; `load`
imports it lazily. Piper yields one int16 chunk per sentence; they are joined into one clip at the
voice's rate. Speed becomes Piper's `length_scale`: the voice's own scale divided by speed (below 1
is faster). Not unit tested against a real voice; covered by tests/voice_smoke.py, run by hand.
"""

from pathlib import Path
from typing import Any, Protocol

import numpy as np

from brain.voice.tts import Tts, TtsVoice


class _Voice(Protocol):
    config: Any  # has `sample_rate`; the rate to give an empty clip

    def synthesize(self, text: str, syn_config: Any = None): ...


class Adapter:
    def __init__(self, engine: _Voice) -> None:
        self._engine = engine

    def synth(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        from piper import SynthesisConfig  # a small dataclass; imported here to keep load cheap

        # `voice` is unused: one Piper voice is one loaded model.
        # Scale the voice's own pace (each voice ships its own length_scale), never replace it.
        config = SynthesisConfig(length_scale=self._engine.config.length_scale / speed)
        chunks = list(self._engine.synthesize(text, syn_config=config))
        if not chunks:
            return np.zeros(0, dtype="<i2"), self._engine.config.sample_rate
        audio = np.concatenate([c.audio_int16_array for c in chunks]).astype("<i2")
        return audio, chunks[0].sample_rate


def load(voice: TtsVoice, folder: Path) -> Tts:
    from piper import PiperVoice

    model = next(folder / f.path for f in voice.files if f.path.endswith(".onnx"))
    config = next(folder / f.path for f in voice.files if f.path.endswith(".onnx.json"))
    return Adapter(PiperVoice.load(model, config_path=config))
