"""Text-to-speech voices as data: the roster (`tts_models.json`) and the `Tts` protocol every
engine adapter meets. Voices are rows, engines are code: a new voice of a known engine is a row;
a new engine is one module plus rows. Heavy libraries load only inside an adapter's `load`.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import numpy as np

from brain.voice.models import ModelFile

LIST_FILE = Path(__file__).with_name("tts_models.json")
AUTO = "auto"
# The engines `tts_engines.TTS_ENGINES` has an adapter for (a test keeps the two in step).
ENGINE_NAMES = ("kokoro", "piper", "supertonic")
RUNTIMES = ("brain", "helper")
# The one line every sample clip says; short and plain so every engine reads it as written.
SAMPLE_TEXT = "Hi, I'm Scout. This is how I sound."
SHA256 = re.compile(r"[0-9a-f]{64}")


class Tts(Protocol):
    def synth(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        """int16 samples and their sample rate; `voice` is the row's engine-native name."""
        ...


@dataclass(frozen=True)
class TtsVoice:
    id: str
    label: str
    descriptor: str
    engine: str
    voice: str  # the engine's own name for it
    files: tuple[ModelFile, ...]
    size_mb: int
    sample: ModelFile | None  # the release clip; None until the hand script has made them
    licence: str
    runtime: Literal["brain", "helper"]
    auto: bool


def _row(raw: dict, index: int = 0) -> TtsVoice:
    try:
        return _build(raw)
    except KeyError as missing:
        name = raw.get("id") or f"#{index}"
        raise ValueError(f"text-to-speech voice {name!r}: missing {missing.args[0]!r}") from None


def _build(raw: dict) -> TtsVoice:
    where = f"text-to-speech voice {raw.get('id')!r}"
    if raw["engine"] not in ENGINE_NAMES:
        raise ValueError(f"{where}: unknown engine {raw['engine']!r}")
    if raw["runtime"] not in RUNTIMES:
        raise ValueError(f"{where}: unknown runtime {raw['runtime']!r}")
    if raw["runtime"] != "brain":
        raise ValueError(f"{where}: runtime {raw['runtime']!r} has no engine yet")
    files = tuple(ModelFile(**f) for f in raw["files"])
    if any(not SHA256.fullmatch(f.sha256) or f.bytes <= 0 for f in files):
        raise ValueError(f"{where}: every file needs a 64-digit lowercase hex sha256 and a size")
    if not raw["licence"]:
        raise ValueError(f"{where}: a voice needs its licence")
    sample = ModelFile(**raw["sample"]) if raw["sample"] else None
    return TtsVoice(
        raw["id"],
        raw["label"],
        raw["descriptor"],
        raw["engine"],
        raw["voice"],
        files,
        raw["size_mb"],
        sample,
        raw["licence"],
        raw["runtime"],
        bool(raw["auto"]),
    )


def load_voices(text: str | None = None) -> tuple[TtsVoice, ...]:
    raw = json.loads(text if text is not None else LIST_FILE.read_text(encoding="utf-8"))
    rows = tuple(_row(r, i) for i, r in enumerate(raw))
    ids = [v.id for v in rows]
    for i in ids:
        if ids.count(i) > 1:
            raise ValueError(f"text-to-speech voice {i!r} is listed twice")
    autos = [v.id for v in rows if v.auto]
    if len(autos) != 1:
        raise ValueError(f"the voice list needs exactly one auto row, found {autos}")
    return rows


def voice_by_id(voice_id: str) -> TtsVoice | None:
    return next((v for v in load_voices() if v.id == voice_id), None)


def auto_voice() -> TtsVoice:
    return next(v for v in load_voices() if v.auto)
