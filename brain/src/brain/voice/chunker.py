"""Chunker: sentences grouped into the chunks the voice speaks whole.

A voice reads a few sentences better than one at a time (the tune carries across), but the first
words must come fast. The numbers are module constants so the listening test can tune them.
Pure: no asyncio and no knowledge of the engine.
"""

from collections.abc import Callable
from dataclasses import dataclass

FIRST_MIN_WORDS = 4  # the first chunk is a complete sentence of at least this many words
TARGET_WORDS = 30  # later chunks grow by whole sentences until they reach this
MAX_WORDS = 45  # a hard cap: past it a sentence starts the next chunk, or is cut
LONE_WORDS = 3  # 1-3 words alone come out clipped, so they join their neighbour


@dataclass(frozen=True)
class Chunk:
    text: str
    paragraph_end: bool


class Chunker:
    def __init__(self, emit: Callable[[Chunk], None]) -> None:
        self._emit = emit
        self._held: list[str] = []
        self._held_words = 0
        self._held_paragraph = False
        self._sent_any = False

    def push(self, sentence: str, paragraph_end: bool = False) -> None:
        words = sentence.split()
        if not words:
            return
        # One sentence over the cap is cut at its last comma or semicolon before the cap, else at
        # the last space, so a long unpunctuated run is never held for ever.
        while len(words) > MAX_WORDS:
            self._flush(False)
            cut = _cut_point(words)
            self._emit_text(" ".join(words[:cut]), False)
            words = words[cut:]
        if self._held and self._held_words + len(words) > MAX_WORDS:
            self._flush(False)
        self._held.append(" ".join(words))
        self._held_words += len(words)
        if paragraph_end:
            self._held_paragraph = True
        if self._held_paragraph:
            if self._held_words > LONE_WORDS:
                self._flush(True)
        elif not self._sent_any:
            if self._held_words >= FIRST_MIN_WORDS:
                self._flush(False)
        elif self._held_words >= TARGET_WORDS:
            self._flush(False)

    def end(self) -> None:
        self._flush(self._held_paragraph)

    def _flush(self, paragraph_end: bool) -> None:
        if not self._held:
            return
        text = " ".join(self._held)
        self._held, self._held_words, self._held_paragraph = [], 0, False
        self._emit_text(text, paragraph_end)

    def _emit_text(self, text: str, paragraph_end: bool) -> None:
        self._sent_any = True
        self._emit(Chunk(text, paragraph_end))


def _cut_point(words: list[str]) -> int:
    """How many of the first MAX_WORDS words make the chunk: up to the last one ending a comma
    or semicolon, else all MAX_WORDS."""
    for i in range(MAX_WORDS - 1, -1, -1):
        if words[i].endswith((",", ";")):
            return i + 1
    return MAX_WORDS
