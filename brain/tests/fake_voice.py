"""Stand-ins for the voice models, so no test loads Silero, Moonshine or Smart Turn.

A loud frame (first sample not 0) is speech and one word; a quiet frame is silence.
`FRAME` is one 32 ms window, the size the real models are fed.
"""

import numpy as np

from brain.voice.ears import EarsParts

FRAME = 512
LOUD = np.full(FRAME, 0.3, dtype=np.float32)
QUIET = np.zeros(FRAME, dtype=np.float32)


def soft(level: float) -> np.ndarray:
    return np.full(FRAME, level, dtype=np.float32)


class LevelVad:
    """Hears speech at or above `threshold`; `fail_on` raises on that call number (1-based)."""

    def __init__(self, threshold: float = 0.1, fail_on: int | None = None) -> None:
        self.threshold = threshold
        self.fail_on = fail_on
        self.calls = 0
        self.resets = 0

    def speech(self, frame: np.ndarray) -> bool:
        self.calls += 1
        if self.calls == self.fail_on:
            raise RuntimeError("vad broke")
        return bool(frame[0] >= self.threshold)

    def reset(self) -> None:
        self.resets += 1


class WordStt:
    """One 'word' per frame it was fed with sound; records every frame level it accepted."""

    def __init__(self) -> None:
        self.fed: list[float] = []
        self.words = 0
        self.fail = False
        self.sleep = 0.0

    def accept(self, frame: np.ndarray) -> None:
        self.fed.append(float(frame[0]))
        if frame[0] != 0:
            self.words += 1

    def text(self) -> str:
        if self.sleep:
            import time

            time.sleep(self.sleep)
        if self.fail:
            raise RuntimeError("stt broke")
        return " ".join(["word"] * self.words)

    def reset(self) -> None:
        self.words = 0


class FixedTurn:
    """Scores each pause from a list (the last score repeats); `fail` raises instead."""

    def __init__(self, *scores: float, fail: bool = False) -> None:
        self.scores = list(scores) or [0.9]
        self.fail = fail
        self.calls: list[int] = []  # samples handed in on each call

    def complete(self, samples: np.ndarray) -> float:
        self.calls.append(len(samples))
        if self.fail:
            raise RuntimeError("onnx")
        return self.scores.pop(0) if len(self.scores) > 1 else self.scores[0]


def parts(*scores: float, vad: LevelVad | None = None, fail_turn: bool = False) -> EarsParts:
    return EarsParts(vad or LevelVad(), WordStt(), FixedTurn(*scores, fail=fail_turn))
