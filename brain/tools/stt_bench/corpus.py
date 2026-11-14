"""The test set for the speech-model harness: Kokoro lines, and an optional folder of the
person's own clips (`name.wav` with `name.txt` holding what was said). A clip with no WAV is
skipped and named in the report, never silently dropped.
"""

from dataclasses import dataclass, field
from pathlib import Path

# What Scout hears most: its name, then a short ask. Voices differ in accent and pitch.
LINES = (
    "Scout, what time is it?",
    "Scout, how much disk space is left on drive C?",
    "Hey Scout, find the file called budget two thousand twenty six.",
    "Scout, what is three hundred and forty seven times twelve?",
    "Scout, open the downloads folder.",
)
VOICES = ("bm_george", "af_heart", "am_michael")


@dataclass(frozen=True)
class Clip:
    reference: str
    wav: Path | None = None  # a recorded clip; None means synthesize `reference` with `voice`
    voice: str | None = None
    tags: tuple[str, ...] = ()


@dataclass
class Corpus:
    items: list[Clip] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)  # one human line per thing left out


def load_folder(folder: Path) -> Corpus:
    corpus = Corpus()
    if not folder.is_dir():
        corpus.skipped.append(f"{folder}: no such folder")
        return corpus
    for ref in sorted(folder.glob("*.txt")):
        wav = ref.with_suffix(".wav")
        if not wav.is_file():
            corpus.skipped.append(f"{ref.name}: no {wav.name} beside it")
            continue
        corpus.items.append(Clip(ref.read_text(encoding="utf-8").strip(), wav, tags=("clip",)))
    return corpus


def kokoro_clips() -> list[Clip]:
    return [Clip(line, voice=v, tags=("kokoro", v)) for v in VOICES for line in LINES]
