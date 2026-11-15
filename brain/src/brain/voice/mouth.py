"""Mouth: a spoken reply, chunk by chunk, as `speech` frames to the body that shows it.

A chunk is a few whole sentences (`chunker.py`). One worker pulls chunks from one queue and
synthesises each in a thread, so a slow voice never stalls the websocket or the ears and two
syntheses never overlap. The voice is the one Home chose (`chosen`): a new pick loads in the
background, latest pick only, while chunks go on in the most recently ready voice; with none ready
(first run, offline) they go out as text only and the body says them in its own system voice. The
switch happens between chunks, never inside one. `download` is the fetch for Home's status line
(the voice, idle, downloading, ready or failed, and a 0..1 progress). Audio is live-only.
"""

import asyncio
import base64
import io
import logging
import uuid
import wave
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Literal, Protocol

import numpy as np

from brain.telemetry import timed
from brain.voice import NoSample
from brain.voice.chunker import Chunk, Chunker
from brain.voice.shape import shape_chunk
from brain.voice.speakable import SpokenStream
from brain.voice.tts import SAMPLE_TEXT, Tts, TtsVoice, voice_by_id

log = logging.getLogger("brain")

DEFAULT_SPEED = 1.0
State = Literal["talking", "sentence_break", "paused", "idle"]
Download = dict[str, float | str]  # {"voice": id, "status": idle|..|failed, "progress": 0..1}
KEPT_TURNS = 3  # chunk logs kept, so a late interruption can still be answered


LoadTts = Callable[[TtsVoice, Callable[[float], None]], Awaitable[Tts]]  # row, progress
Clip = Callable[[TtsVoice], Awaitable[bytes | None]]  # the voice's release sample, fetched once


class _Sender(Protocol):
    def send_live(self, body_id: str, method: str, params: dict) -> bool: ...


class _Turn:
    def __init__(self, turn: str, body_id: str, speed: float, system_voice: bool, enqueue) -> None:
        self.turn = turn
        self.body_id = body_id
        self.system_voice = system_voice
        self.speed = speed
        self.unsent: list[str] = []  # chunks made but not yet sent: still Scout's to say
        self.muted = False  # its writer is still going, but what it writes is no longer said
        self.chunker = Chunker(lambda chunk: enqueue(self, chunk))
        self.stream = SpokenStream(self.chunker.push)
        self.ended = False


class Mouth:
    """One queue of chunks for every body and one worker that says them in order, so two
    syntheses never overlap (the phonemizer is not thread-safe) and a pause or clear never has
    to cancel a synth thread it cannot stop."""

    def __init__(
        self,
        bodies: _Sender,
        load_tts: LoadTts,
        chosen: Callable[[], TtsVoice],
        installed: Callable[[TtsVoice], bool] = lambda _v: False,
        clip: Clip | None = None,
    ) -> None:
        self._bodies = bodies
        self._load_tts = load_tts
        self._chosen = chosen
        self._installed = installed  # files on disk: a sample can be made live without a fetch
        self._clip = clip
        self._ready: dict[str, tuple[TtsVoice, Tts]] = {}
        self._last_ready: str | None = None  # the voice chunks fall back to while a pick loads
        self._loading: asyncio.Task | None = None
        self._loading_id: str | None = None
        self._failed = False  # until the next spoken turn, which tries again
        self.download: Download = {"voice": chosen().id, "status": "idle", "progress": 0.0}
        self.on_download: Callable[[], None] | None = None
        self._synth = asyncio.Lock()  # Preview's sample shares the one synth with the worker
        self._turns: dict[str, _Turn] = {}
        self._queue: deque[tuple[str, Chunk | None]] = deque()  # (turn, chunk); None: turn done
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
        """The chunks sent to the body for `turn` (frame `n` is index `n - 1`), then those made
        but not yet sent, so a speaker cut off mid-reply still knows what was left."""
        return [*self._sent.get(turn, []), *self.unsaid(turn)]

    def unsaid(self, turn: str) -> list[str]:
        """Chunks of a live `turn` made but not yet sent, in order."""
        live = self._turns.get(turn)
        return list(live.unsent) if live is not None else []

    def turns_on(self, body_id: str) -> list[str]:
        return [t for t, st in self._turns.items() if st.body_id == body_id]

    def spoken(
        self,
        turn: str,
        body_id: str | None,
        speed: float | None,
        system_voice: bool = False,
    ) -> None:
        """The turn's reply will be read aloud on `body_id`, the body showing it. With
        `system_voice` the body speaks it itself: text only, and the voice is never loaded."""
        if body_id is None or turn in self._turns:
            return  # already speaking this turn; a cleared one is replaced
        self._failed = False
        speed = speed or DEFAULT_SPEED
        self._turns[turn] = _Turn(turn, body_id, speed, system_voice, self._enqueue)
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
        elif (delta := params.get("delta")) and not st.muted:
            st.stream.push(delta)

    def end_turn(self, turn: str) -> None:
        """No more deltas will come (idempotent), so the speech can end."""
        st = self._turns.get(turn)
        if st is not None and not st.ended:
            self._finish(st)

    def speaking(self, turn: str, body_id: str) -> bool:
        """`turn` is still live on `body_id`: it owns the queue and can be replaced."""
        st = self._turns.get(turn)
        return st is not None and st.body_id == body_id

    def replace(self, turn: str, body_id: str, text: str) -> str | None:
        """Drop what `turn` has not said (the body is told to clear it too, since chunks
        already sent sit in its player) and say `text` in the same voice as a turn of its own,
        whose id is returned. The old turn is muted, not ended: its writer still owns it. None
        when `turn` is no longer live, so nothing is said in a voice it cannot name."""
        st = self._turns.get(turn)
        if st is None or st.body_id != body_id:
            return None
        st.unsent.clear()
        self._queue = deque(i for i in self._queue if i[0] != turn or i[1] is None)
        st.muted = True
        self._bodies.send_live(body_id, "speech_control", {"action": "clear", "turn": turn})
        new = f"{turn}-{uuid.uuid4().hex[:8]}"  # the body silences a cleared turn id for good
        self.spoken(new, body_id, st.speed, st.system_voice)
        self.reply(new, {"delta": text})
        self.end_turn(new)
        return new

    def pause(self) -> None:
        """Stop after the chunk being made is sent; what is queued waits for `resume`."""
        self._paused = True
        self._control("pause")
        self._poke()

    def resume(self, tell: bool = True) -> None:
        """Carry on. `tell=False` keeps the body's player as it is: the person paused it."""
        self._paused = False
        if tell:
            self._control("resume")
        self._poke()

    def _control(self, action: str) -> None:
        """Tell each body that plays a turn to hold or go on: chunks already sent sit in its
        player, so pausing only the queue would not stop the sound."""
        # A turn is dropped once its last chunk is sent while the body still plays it, so the
        # body of the last frame sent is a target too.
        live = (st.body_id for st in self._turns.values())
        targets = dict.fromkeys([*live, *([self._last_body] if self._last_body else [])])
        for body_id in targets:
            self._bodies.send_live(body_id, "speech_control", {"action": action})

    def clear(self, turn: str | None = None) -> None:
        """Drop what is queued for `turn` (every turn when None) and ignore its later deltas.
        What was made but not yet sent moves to the log first, so an interruption can still
        hand it over, and so does what the chunker still holds. The chunk being made is dropped
        when its synth ends."""
        for name in [turn] if turn is not None else list(self._turns):
            st = self._turns.pop(name, None)
            if st is not None:
                st.stream.end()  # text the splitter still holds goes on to the chunker
                st.chunker.end()
                self._log(name).extend(st.unsent)
                st.unsent.clear()
        self._queue = deque(item for item in self._queue if item[0] in self._turns)
        self._poke()

    def _log(self, turn: str) -> list[str]:
        """The turn's chunk log, keeping only the newest KEPT_TURNS logs."""
        lines = self._sent.setdefault(turn, [])
        while len(self._sent) > KEPT_TURNS:
            del self._sent[next(iter(self._sent))]
        return lines

    async def sample(self, voice_id: str, speed: float | None) -> bytes:
        """One WAV of SAMPLE_TEXT for Home's Play. Live when the voice is installed; otherwise
        the release clip (fetched once, then cached); NoSample when there is neither."""
        voice = voice_by_id(voice_id)
        if voice is None:
            raise ValueError(f"unknown voice {voice_id!r}")
        ready = self._ready.get(voice.id)
        if ready is None and self._loading is not None and voice.id == self._loading_id:
            # The chosen voice is mid-load: wait for that one load, never start a second.
            try:
                await asyncio.shield(self._loading)
            except Exception:
                pass  # a failed load falls through to the clip
            ready = self._ready.get(voice.id)
        if ready is None and await asyncio.to_thread(self._installed, voice):  # hashes big files
            tts = await self._load_tts(voice, lambda _f: None)  # files are here: no download
            ready = (voice, tts)
            if voice.id == self._chosen().id:
                self._ready[voice.id] = ready  # else a Play must not keep a voice in memory
        if ready is not None:
            tts = ready[1]
            async with self._synth:
                samples, rate = await asyncio.to_thread(
                    tts.synth, SAMPLE_TEXT, voice.voice, speed or DEFAULT_SPEED
                )
            return wav_bytes(shape_chunk(samples, rate, paragraph_end=False), rate)
        clip = await self._clip(voice) if self._clip is not None else None
        if clip is None:
            raise NoSample(voice.id)
        return clip

    def _finish(self, st: _Turn) -> None:
        st.ended = True
        st.stream.end()
        st.chunker.end()
        self._queue.append((st.turn, None))
        self._poke()

    def _enqueue(self, st: _Turn, chunk: Chunk) -> None:
        if st.muted:
            return  # text the stream or chunker still held when the turn was replaced
        st.unsent.append(chunk.text)
        self._queue.append((st.turn, chunk))
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
                log.exception("the mouth failed on a chunk")
            finally:
                self._saying = False
                self._poke()

    async def _take_one(self) -> None:
        turn, chunk = self._queue.popleft()
        st = self._turns.get(turn)
        if st is None:
            return
        if chunk is None:
            del self._turns[turn]
            self._send(st, {"turn": turn, "done": True})
            return
        self._saying = True
        self._poke()
        try:
            await self._say(st, chunk.text, chunk.paragraph_end)
        finally:
            if self._turns.get(turn) is st:
                del st.unsent[:1]

    async def _say(self, st: _Turn, line: str, paragraph_end: bool) -> None:
        frame: dict = {"turn": st.turn, "text": line}
        # The voice is fixed here, so a pick made while this chunk is made waits for the next.
        now = None if st.system_voice else self._voice_now()
        if now is not None:
            voice, tts = now
            try:
                async with self._synth:
                    with timed("voice_hop", op="synth"):
                        samples, rate = await asyncio.to_thread(
                            tts.synth, line, voice.voice, st.speed
                        )
                pcm = shape_chunk(samples, rate, paragraph_end).astype("<i2").tobytes()
                frame |= {"pcm": base64.b64encode(pcm).decode("ascii"), "sample_rate": rate}
            except Exception:
                # One chunk the voice cannot say (an odd character) goes out as text, the body
                # says it, and the turn's speech goes on.
                log.warning("speech synthesis failed", exc_info=True)
        if self._turns.get(st.turn) is not st:
            return  # cleared while it was being made
        # Logged only once sent, so frame `n` and the log index agree; the log outlives the turn.
        lines = self._log(st.turn)
        lines.append(line)
        self._send(st, {**frame, "n": len(lines)})

    def _voice_now(self) -> tuple[TtsVoice, Tts] | None:
        """The chosen voice if it is ready; else start loading it (once) and use the most
        recently ready one; else None, and the chunk goes out as text only."""
        row = self._chosen()
        if row.id in self._ready:
            return self._ready[row.id]
        self._ensure(row)
        return self._ready.get(self._last_ready) if self._last_ready else None

    def _ensure(self, row: TtsVoice) -> None:
        """Load `row` unless it is loading or failed. Latest pick only: a load of another voice
        is cancelled first (its `.part` file goes with it)."""
        if self._failed or self._loading_id == row.id:
            return
        self._cancel_load()
        self._loading_id = row.id
        if self.download["voice"] != row.id:  # a different voice: the status line moves on
            self._set_download(row.id, "idle", 0.0)
        task = asyncio.ensure_future(self._load(row))
        self._loading = task

        def done(t: asyncio.Task) -> None:
            if self._loading is t:
                self._loading, self._loading_id = None, None

        task.add_done_callback(done)

    def _cancel_load(self) -> None:
        if self._loading is not None and not self._loading.done():
            self._loading.cancel()
        self._loading, self._loading_id = None, None

    def choose(self, voice: TtsVoice) -> None:
        """Home picked `voice`. Ready: it is current from the next chunk. Otherwise it loads."""
        self._failed = False
        if voice.id in self._ready:
            self._cancel_load()
            self._set_download(voice.id, "ready", 1.0)
        else:
            self._ensure(voice)

    def prefetch(self) -> None:
        """Start fetching the chosen voice now (the first-run tour), without a chunk to say."""
        row = self._chosen()
        if row.id not in self._ready:
            self._ensure(row)

    def retry(self) -> None:
        """Home's retry after a failed download: the chosen voice again."""
        row = self._chosen()
        if row.id not in self._ready:
            self._failed = False
            self._ensure(row)

    def _set_download(self, voice: str, status: str, progress: float) -> None:
        new = {"voice": voice, "status": status, "progress": progress}
        if self.download == new:
            return
        self.download = new
        if self.on_download is not None:
            self.on_download()

    async def _load(self, row: TtsVoice) -> None:
        last = -1.0

        def progress(fraction: float) -> None:
            nonlocal last
            # Only while there is something left to fetch: a cached voice goes idle to ready.
            if fraction < 1 and fraction - last >= 0.02:  # a few dozen updates, not thousands
                last = fraction
                self._set_download(row.id, "downloading", max(fraction, 0.0))

        try:
            tts = await self._load_tts(row, progress)
            self._ready[row.id] = (row, tts)
            self._last_ready = row.id
            self._set_download(row.id, "ready", 1.0)
        except Exception:  # a cancelled load is a BaseException: the new pick owns the status
            log.warning("the speaking voice failed to load", exc_info=True)
            self._failed = True
            self._set_download(row.id, "failed", 0.0)

    def _send(self, st: _Turn, params: dict) -> None:
        self._last_body = st.body_id
        self._bodies.send_live(st.body_id, "speech", params)


def wav_bytes(samples: np.ndarray, rate: int) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.astype("<i2").tobytes())
    return out.getvalue()
