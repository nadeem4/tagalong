"""Mouth: a spoken reply, sentence by sentence, as `speech` frames to the body that shows it.

One task per spoken turn pulls sentences from a queue and synthesises each in a thread, so a
slow voice never stalls the websocket or the ears. While the voice is loading or has failed the
sentences go out as text only, and the body says them in its own system voice. Audio is live-only
and never stored.
"""

import asyncio
import base64
import io
import logging
import wave
from collections.abc import Awaitable, Callable
from typing import Protocol

import numpy as np

from brain.voice.speakable import SHORT_LINE, SpokenStream

log = logging.getLogger("brain")

DEFAULT_VOICE = "bm_george"
DEFAULT_SPEED = 1.0


class Tts(Protocol):
    def synth(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        """int16 samples and their sample rate."""
        ...


class _Sender(Protocol):
    def send_live(self, body_id: str, method: str, params: dict) -> bool: ...


class _Turn:
    def __init__(self, body_id: str, voice: str, speed: float) -> None:
        self.body_id = body_id
        self.voice = voice
        self.speed = speed
        self.queue: asyncio.Queue[str | None] = asyncio.Queue()  # None: no more sentences
        self.stream = SpokenStream(self.queue.put_nowait)
        self.ended = False
        self.hushed = False
        self.task: asyncio.Task | None = None


class Mouth:
    def __init__(self, bodies: _Sender, load_tts: Callable[[], Awaitable[Tts]]) -> None:
        self._bodies = bodies
        self._load_tts = load_tts
        self._tts: Tts | None = None
        self._loading: asyncio.Task | None = None
        self._failed = False  # until the next spoken turn, which tries again
        self._told: set[str] = set()  # bodies sent `loading` for the load under way
        self._turns: dict[str, _Turn] = {}

    def spoken(
        self, turn: str, body_id: str | None, voice: str | None, speed: float | None
    ) -> None:
        """The turn's reply will be read aloud on `body_id`, the body showing it."""
        if body_id is None or turn in self._turns:
            return
        self._failed = False
        st = _Turn(body_id, voice or DEFAULT_VOICE, speed or DEFAULT_SPEED)
        st.task = asyncio.get_running_loop().create_task(self._run(turn, st))
        self._turns[turn] = st

    def reply(self, turn: str, params: dict) -> None:
        """A `reply` notification's params: a delta, or done."""
        st = self._turns.get(turn)
        if st is None or st.ended or st.hushed:
            return
        if params.get("done"):
            self._finish(st)
        elif delta := params.get("delta"):
            st.stream.push(delta)

    def end_turn(self, turn: str) -> None:
        """No more deltas will come (idempotent), so the speech can end."""
        st = self._turns.get(turn)
        if st is not None and not st.ended and not st.hushed:
            self._finish(st)

    def hush(self, body_id: str) -> None:
        """Barge-in: stop every turn spoken on this body and drop what is queued."""
        for st in self._turns.values():
            if st.body_id == body_id and not st.hushed:
                st.hushed = True
                if st.task is not None:
                    st.task.cancel()

    async def sample(self, text: str, voice: str | None, speed: float | None) -> bytes:
        """One WAV for Settings' Preview. Waits for the voice to load; raises if it cannot."""
        if self._tts is None:
            await asyncio.shield(self._start_load())
        if self._tts is None:
            raise RuntimeError("the speaking voice is not available")
        tts = self._tts
        samples, rate = await asyncio.to_thread(
            tts.synth, text, voice or DEFAULT_VOICE, speed or DEFAULT_SPEED
        )
        return _wav(samples, rate)

    def _finish(self, st: _Turn) -> None:
        st.ended = True
        st.stream.end()
        st.queue.put_nowait(None)

    async def _run(self, turn: str, st: _Turn) -> None:
        try:
            while True:
                line = await st.queue.get()
                if line is None:
                    break
                # Short lines already waiting are said together; one alone would come out clipped.
                while len(line) < SHORT_LINE and not st.queue.empty():
                    nxt = st.queue.get_nowait()
                    if nxt is None:
                        st.queue.put_nowait(None)
                        break
                    line = f"{line} {nxt}"
                await self._say(turn, st, line)
            self._send(st, {"turn": turn, "done": True})
        finally:
            self._turns.pop(turn, None)

    async def _say(self, turn: str, st: _Turn, line: str) -> None:
        frame: dict = {"turn": turn, "text": line}
        tts = self._tts_now(st.body_id)
        if tts is not None:
            try:
                samples, rate = await asyncio.to_thread(tts.synth, line, st.voice, st.speed)
                pcm = samples.astype("<i2").tobytes()
                frame |= {"pcm": base64.b64encode(pcm).decode("ascii"), "sample_rate": rate}
            except Exception:
                log.warning("speech synthesis failed", exc_info=True)  # the body says it instead
        self._send(st, frame)

    def _tts_now(self, body_id: str) -> Tts | None:
        """The voice if it is ready. Otherwise start loading it (once) and say so to this body."""
        if self._tts is not None:
            return self._tts
        if self._failed:
            return None
        self._start_load()
        if body_id not in self._told:
            self._told.add(body_id)
            self._bodies.send_live(body_id, "voice", {"status": "loading"})
        return None

    def _start_load(self) -> asyncio.Task:
        if self._loading is None:
            self._loading = asyncio.ensure_future(self._load())
            self._loading.add_done_callback(lambda _t: setattr(self, "_loading", None))
        return self._loading

    async def _load(self) -> None:
        try:
            self._tts = await self._load_tts()
            outcome: dict = {"status": "ready"}
        except Exception:
            log.warning("the speaking voice failed to load", exc_info=True)
            self._failed = True
            outcome = {
                "status": "failed",
                "message": "The speaking voice could not start; using the system voice.",
            }
        told, self._told = self._told, set()
        for body_id in told:
            self._bodies.send_live(body_id, "voice", outcome)

    def _send(self, st: _Turn, params: dict) -> None:
        if not st.hushed:
            self._bodies.send_live(st.body_id, "speech", params)


def _wav(samples: np.ndarray, rate: int) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.astype("<i2").tobytes())
    return out.getvalue()
