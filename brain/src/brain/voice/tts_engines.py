"""The text-to-speech engines by name: one `load` per engine that turns a roster row and the
voice folder into a `Tts`. A new engine is a module with a `load` plus an entry here and in
`tts.ENGINE_NAMES`. Each `load` imports its heavy library lazily.
"""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from brain.voice import kokoro, piper, supertonic
from brain.voice.tts import Tts, TtsVoice


@dataclass(frozen=True)
class TtsEngine:
    load: Callable[[TtsVoice, Path], Tts]


TTS_ENGINES: dict[str, TtsEngine] = {
    "kokoro": TtsEngine(kokoro.load_row),
    "piper": TtsEngine(piper.load),
    "supertonic": TtsEngine(supertonic.load),
}
