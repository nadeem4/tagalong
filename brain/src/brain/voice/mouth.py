"""Mouth: a spoken reply, sentence by sentence, as `speech` frames to the body that shows it.

One worker pulls sentences from one queue and synthesises each in a thread, so a slow voice
never stalls the websocket or the ears and two syntheses never overlap. While the voice is
loading or has failed the sentences go out as text only, and the body says them in its own system
voice. Audio is live-only and never stored.
"""

import asyncio
import base64
import io
import logging
import wave
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Literal, Protocol

import numpy as np

from brain.telemetry import timed
from brain.voice.speakable import SHORT_LINE, SpokenStream

log = logging.getLogger("brain")

DEFAULT_VOICE = "bm_george"
DEFAULT_SPEED = 1.0
State = Literal["talking", "sentence_break", "paused", "idle"]
KEPT_TURNS = 3  # sentence logs kept, so a late interruption can still be answered


class Tts(Protocol):
    def synth(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        """int16 samples and their sample rate."""
        ...


class _Sender(Protocol):
    def send_live(self, body_id: str, method: str, params: dict) -> bool: ...


class _Turn:
    def __init__(
        self, turn: str, body_id: str, voice: str, speed: float, system_voice: bool, enqueue
    ) -> None:
        self.turn = turn
        self.body_id = body_id
        self.system_voice = system_voice
        self.voice = voice
        self.speed = speed
        self.unsent: list[str] = []  # sentences made but not yet sent: still Scout's to say
        self.stream = SpokenStream(lambda line: enqueue(self, line))
        self.ended = False


class Mouth:
    """One queue of sentences for every body and one worker that says them in order, so two
    syntheses never overlap (the phonemizer is not thread-safe) and a pause or clear never has
    to cancel a synth thread it cannot stop."""

    def __init__(self, bodies: _Sender, load_tts: Callable[[], Awaitable[Tts]]) -> None:
        self._bodies = bodies
        self._load_tts = load_tts
        self._tts: Tts | None = None
        self._loading: asyncio.Task | None = None
        self._failed = False  # until the next spoken turn, which tries again
        self._synth = asyncio.Lock()  # Preview's sample shares the one synth with the worker
        self._turns: dict[str, _Turn] = {}
        self._queue: deque[tuple[str, str | None]] = deque()  # (turn, sentence); None: turn done
        self._go = asyncio.Event()  # set while the worker may take the next item
        self._worker: asyncio.Task | None = None
        self._paused = False
        self._saying = False
        self._last_body: str | None = None  # the body the last frame went to
        self.state: State = "idle"
        self.on_state: Callable[[str], None] | None = None
        # What each turn sent, in order. Apart from `_turns` because a turn is dropped once its
        # frames are out while the body may still be playing them.
        self._sent: dict[str, list[str]] = {}

    def sentences(self, turn: str) -> list[str]:
        """The sentences sent to the body for `turn` (frame `n` is index `n - 1`), then those
        made but not yet sent, so a speaker cut off mid-reply still knows what was left."""
        return [*self._sent.get(turn, []), *self.unsaid(turn)]

    def unsaid(self, turn: str) -> list[str]:
        """Sentences of a live `turn` made but not yet sent, in order."""
        live = self._turns.get(turn)
        return list(live.unsent) if live is not None else []

    def turns_on(self, body_id: str) -> list[str]:
        return [t for t, st in self._turns.items() if st.body_id == body_id]

    def spoken(
        self,
        turn: str,
        body_id: str | None,
        voice: str | None,
        speed: float | None,
        system_voice: bool = False,
    ) -> None:
        """The turn's reply will be read aloud on `body_id`, the body showing it. With
        `system_voice` the body speaks it itself: text only, and the voice is never loaded."""
        if body_id is None or turn in self._turns:
            return  # already speaking this turn; a cleared one is replaced
        self._failed = False
        voice = voice or DEFAULT_VOICE
        speed = speed or DEFAULT_SPEED
        self._turns[turn] = _Turn(turn, body_id, voice, speed, system_voice, self._enqueue)
        if self._worker is None or self._worker.done():
            self._worker = asyncio.get_running_loop().create_task(self._work())
        self._refresh()

    def reply(self, turn: str, params: dict) -> None:
        """A `reply` notification's params: a delta, or done."""
        st = self._turns.get(turn)
        if st is None or st.ended:
            return
        if params.get("done"):
            self._finish(st)
        elif delta := params.get("delta"):
            st.stream.push(delta)

    def end_turn(self, turn: str) -> None:
        """No more deltas will come (idempotent), so the speech can end."""
        st = self._turns.get(turn)
        if st is not None and not st.ended:
            self._finish(st)

    def pause(self) -> None:
        """Stop after the sentence being made is sent; what is queued waits for `resume`."""
        self._paused = True
        self._control("pause")
        self._poke()

    def resume(self) -> None:
        self._paused = False
        self._control("resume")
        self._poke()

    def _control(self, action: str) -> None:
        """Tell each body that plays a turn to hold or go on: sentences already sent sit in its
        player, so pausing only the queue would not stop the sound."""
        # A turn is dropped once its last sentence is sent while the body still plays it, so the
        # body of the last frame sent is a target too.
        live = (st.body_id for st in self._turns.values())
        targets = dict.fromkeys([*live, *([self._last_body] if self._last_body else [])])
        for body_id in targets:
            self._bodies.send_live(body_id, "speech_control", {"action": action})

    def clear(self, turn: str | None = None) -> None:
        """Drop what is queued for `turn` (every turn when None) and ignore its later deltas.
        What was made but not yet sent moves to the log first, so an interruption can still
        hand it over. The sentence being made is dropped when its synth ends."""
        for name in [turn] if turn is not None else list(self._turns):
            st = self._turns.pop(name, None)
            if st is not None:
                self._log(name).extend(st.unsent)
                st.unsent.clear()
        self._queue = deque(item for item in self._queue if item[0] in self._turns)
        self._poke()

    def _log(self, turn: str) -> list[str]:
        """The turn's sentence log, keeping only the newest KEPT_TURNS logs."""
        lines = self._sent.setdefault(turn, [])
        while len(self._sent) > KEPT_TURNS:
            del self._sent[next(iter(self._sent))]
        return lines

    async def sample(self, text: str, voice: str | None, speed: float | None) -> bytes:
        """One WAV for Settings' Preview. Waits for the voice to load; raises if it cannot."""
        if self._tts is None:
            await asyncio.shield(self._start_load())
        if self._tts is None:
            raise RuntimeError("the speaking voice is not available")
        tts = self._tts
        async with self._synth:
            samples, rate = await asyncio.to_thread(
                tts.synth, text, voice or DEFAULT_VOICE, speed or DEFAULT_SPEED
            )
        return _wav(samples, rate)

    def _finish(self, st: _Turn) -> None:
        st.ended = True
        st.stream.end()
        self._queue.append((st.turn, None))
        self._poke()

    def _enqueue(self, st: _Turn, line: str) -> None:
        st.unsent.append(line)
        self._queue.append((st.turn, line))
        self._poke()

    def _poke(self) -> None:
        if self._queue and not self._paused:
            self._go.set()
        else:
            self._go.clear()
        self._refresh()

    def _refresh(self) -> None:
        if self._paused:
            state: State = "paused"
        elif self._saying or self._queue:
            state = "talking"
        elif any(not st.ended for st in self._turns.values()):
            state = "sentence_break"
        else:
            state = "idle"
        if state != self.state:
            self.state = state
            if self.on_state is not None:
                self.on_state(state)

    async def close(self) -> None:
        """Stop the worker, so no task is left pending when the loop closes."""
        if self._worker is not None:
            self._worker.cancel()
            await asyncio.gather(self._worker, return_exceptions=True)

    async def _work(self) -> None:
        while True:
            await self._go.wait()
            try:
                await self._take_one()
            except Exception:  # one bad item must not end the speech for good
                log.exception("the mouth failed on a sentence")
            finally:
                self._saying = False
                self._poke()

    async def _take_one(self) -> None:
        turn, line = self._queue.popleft()
        st = self._turns.get(turn)
        if st is None:
            return
        if line is None:
            del self._turns[turn]
            self._send(st, {"turn": turn, "done": True})
            return
        taken = 1
        # Short lines already waiting are said together; one alone would come out clipped.
        while len(line) < SHORT_LINE and self._queue and self._queue[0][0] == turn:
            nxt = self._queue[0][1]
            if nxt is None:
                break
            self._queue.popleft()
            line = f"{line} {nxt}"
            taken += 1
        self._saying = True
        self._poke()
        try:
            await self._say(st, line)
        finally:
            if self._turns.get(turn) is st:
                del st.unsent[:taken]

    async def _say(self, st: _Turn, line: str) -> None:
        frame: dict = {"turn": st.turn, "text": line}
        tts = None if st.system_voice else self._tts_now()
        if tts is not None:
            try:
                async with self._synth:
                    with timed("voice_hop", op="synth"):
                        samples, rate = await asyncio.to_thread(tts.synth, line, st.voice, st.speed)
                pcm = samples.astype("<i2").tobytes()
                frame |= {"pcm": base64.b64encode(pcm).decode("ascii"), "sample_rate": rate}
            except Exception:
                log.warning("speech synthesis failed", exc_info=True)  # the body says it instead
        if self._turns.get(st.turn) is not st:
            return  # cleared while it was being made
        # Logged only once sent, so frame `n` and the log index agree; the log outlives the turn.
        lines = self._log(st.turn)
        lines.append(line)
        self._send(st, {**frame, "n": len(lines)})

    def _tts_now(self) -> Tts | None:
        """The voice if it is ready. Otherwise start loading it (once): the sentence goes out as
        text only, which already tells the body to use its own voice."""
        if self._tts is not None:
            return self._tts
        if not self._failed:
            self._start_load()
        return None

    def _start_load(self) -> asyncio.Task:
        if self._loading is None:
            self._loading = asyncio.ensure_future(self._load())
            self._loading.add_done_callback(lambda _t: setattr(self, "_loading", None))
        return self._loading

    async def _load(self) -> None:
        try:
            self._tts = await self._load_tts()
        except Exception:
            log.warning("the speaking voice failed to load", exc_info=True)
            self._failed = True

    def _send(self, st: _Turn, params: dict) -> None:
        self._last_body = st.body_id
        self._bodies.send_live(st.body_id, "speech", params)


def _wav(samples: np.ndarray, rate: int) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.astype("<i2").tobytes())
    return out.getvalue()
