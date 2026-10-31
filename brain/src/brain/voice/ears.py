"""Ears: one listening session turning 16 kHz mic frames into words.

Silero says speech or not, Moonshine gives the words so far, Smart Turn says whether the
person has finished. Synchronous on purpose: the service runs it in a worker thread, so a slow
decode never blocks the websocket. Ported from the desktop's local-ears.
"""

import logging
from collections.abc import Callable
from typing import Literal, NamedTuple, Protocol

import numpy as np

log = logging.getLogger("brain")

SAMPLE_RATE = 16_000
FRAME = 512  # 32 ms, the window Silero is fed
# 256 ms of quiet ends a stretch of speech and asks the end-of-turn model.
PAUSE_FRAMES = 8
# About 2 s more of quiet ends the turn whatever the model says.
GIVE_UP_FRAMES = 63
PARTIAL_EVERY_FRAMES = 10  # live words about three times a second
TURN_THRESHOLD = 0.5
# Speech that never goes quiet (noise) is closed as a stretch after about 30 s.
MAX_STRETCH_FRAMES = 938
# Silero hears speech a frame or three late: the 256 ms before it is fed in too.
PRE_ROLL_FRAMES = 8
TURN_SAMPLES = 8 * SAMPLE_RATE  # Smart Turn reads the last 8 s


class Vad(Protocol):
    def speech(self, frame: np.ndarray) -> bool: ...  # 512 float32 samples

    def reset(self) -> None: ...  # forget the recurrent state of the last session


class StreamingStt(Protocol):
    def accept(self, frame: np.ndarray) -> None: ...

    def text(self) -> str: ...

    def reset(self) -> None: ...


class EndOfTurn(Protocol):
    def complete(self, samples: np.ndarray) -> float: ...  # last 8 s, 0..1


class EarsParts(NamedTuple):
    vad: Vad
    stt: StreamingStt
    turn: EndOfTurn


Emit = Callable[[str, str | None], None]


class Ears:
    """Silence is ignored; the first speech starts a turn (`speech_start`); words show as they
    come (`partial`); each pause closes a stretch (`final`). Held: the turn ends at `finish`,
    even with nothing said. Always: it ends when the end-of-turn model is sure, or after a
    long silence. Nothing is kept once the turn is handed over."""

    def __init__(self, parts: EarsParts, mode: Literal["held", "always"], emit: Emit) -> None:
        self._parts = parts
        self._mode = mode
        self._emit = emit
        self._finished = False
        parts.vad.reset()  # the models are shared between sessions; their state is not
        self._reset()

    def frame(self, samples: np.ndarray) -> None:
        if self._finished:
            return
        parts = self._parts
        speech = parts.vad.speech(samples)
        if not speech and not self._in_speech:
            self._ring(samples)
        if not self._in_turn and not speech:
            return
        if speech:
            if not self._in_turn:
                self._in_turn = True
                self._emit("speech_start", None)
            if not self._in_speech:
                for before in self._pre_roll:
                    self._keep(before)
                    parts.stt.accept(before)
                self._pre_roll = []
            self._in_speech = True
            self._quiet = 0
            self._keep(samples)
            parts.stt.accept(samples)
            self._stretch += 1
            if self._stretch >= MAX_STRETCH_FRAMES:
                self._close_stretch(stopping=False)
                return
            self._since_partial += 1
            if self._since_partial >= PARTIAL_EVERY_FRAMES:
                self._since_partial = 0
                partial = " ".join([*self._heard, parts.stt.text()]).strip()
                if partial != "" and partial != self._last_partial:
                    self._last_partial = partial
                    self._emit("partial", partial)
            return
        self._quiet += 1
        if self._in_speech:
            self._keep(samples)
            parts.stt.accept(samples)
            if self._quiet == PAUSE_FRAMES:
                self._close_stretch(stopping=False)
            return
        if self._mode == "always" and self._quiet >= PAUSE_FRAMES + GIVE_UP_FRAMES:
            self._end_turn(held=False)

    def finish(self) -> None:
        """Listening stopped. Held: hand over the last words and end the turn, exactly once."""
        if self._finished:
            return
        self._finished = True
        if self._mode == "always":
            self._reset()
            return
        try:
            if self._in_speech:
                self._close_stretch(stopping=True)
        except Exception:
            log.warning("the speech model failed; ending the turn with what was heard", exc_info=True)
        finally:
            self._end_turn(held=True)

    def _close_stretch(self, *, stopping: bool) -> None:
        self._in_speech = False
        self._stretch = 0
        words = self._parts.stt.text().strip()
        self._parts.stt.reset()
        if words != "":
            self._heard.append(words)
            self._emit("final", words)
        if self._mode != "always" or stopping:
            return
        score = 1.0
        try:
            score = self._parts.turn.complete(self._last_seconds())
        except Exception:
            log.warning("the end-of-turn model failed; taking the turn as over", exc_info=True)
        if score >= TURN_THRESHOLD:
            self._end_turn(held=False)

    def _end_turn(self, *, held: bool) -> None:
        text = " ".join(self._heard).strip()
        self._reset()
        if text != "" or held:
            self._emit("turn_end", text)

    def _reset(self) -> None:
        self._in_turn = False
        self._in_speech = False
        self._quiet = 0
        self._since_partial = 0
        self._stretch = 0
        self._last_partial = ""
        self._heard: list[str] = []
        self._audio: list[np.ndarray] = []
        self._pre_roll: list[np.ndarray] = []
        self._parts.stt.reset()

    def _ring(self, samples: np.ndarray) -> None:
        self._pre_roll.append(samples)
        if len(self._pre_roll) > PRE_ROLL_FRAMES:
            self._pre_roll.pop(0)

    def _keep(self, samples: np.ndarray) -> None:
        self._audio.append(samples)
        total = sum(len(a) for a in self._audio)
        while total > TURN_SAMPLES and len(self._audio) > 1:
            total -= len(self._audio.pop(0))

    def _last_seconds(self) -> np.ndarray:
        return np.concatenate(self._audio)[-TURN_SAMPLES:]
