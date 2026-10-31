"""VoiceService: the brain's listening, one session per body, behind the VoiceHooks seam.

`mic` frames queue per session; a worker task feeds them to Ears in a thread, so a slow decode
never stalls the websocket or another body. Models load on the first `listen` (a download may
be needed) and frames spoken meanwhile are kept. Events go out live-only: never stored or
replayed. Audio is never written anywhere.
"""

import asyncio
import logging
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Literal, Protocol

import numpy as np

from brain.voice.ears import FRAME, Ears, EarsParts
from brain.voice.models import ModelIntegrityError
from brain.voice.mouth import Mouth, Tts

log = logging.getLogger("brain")

MAX_BUFFER_SECONDS = 30  # frames kept while the models load; the oldest go first
_FINISH = None  # queue marker: no more audio

LoadEars = Callable[[Callable[[float], None]], Awaitable[EarsParts]]
LoadTts = Callable[[], Awaitable[Tts]]


class _Sender(Protocol):
    def send_live(self, body_id: str, method: str, params: dict) -> bool: ...


class _Session:
    def __init__(self, body_id: str, mode: Literal["held", "always"]) -> None:
        self.body_id = body_id
        self.mode = mode
        self.live = True  # false once superseded or stopped: no more events to the body
        self.queue: deque[np.ndarray | None] = deque()
        self.queued = 0
        self.arrived = asyncio.Event()
        self.pending: list[tuple[str, str | None]] = []  # events made in the thread
        self.task: asyncio.Task | None = None

    def push(self, samples: np.ndarray | None) -> None:
        self.queue.append(samples)
        if samples is not None:
            self.queued += len(samples)
            limit = MAX_BUFFER_SECONDS * 16_000
            while self.queued > limit and len(self.queue) > 1:
                dropped = self.queue.popleft()
                if dropped is None:  # never drop the end marker
                    self.queue.appendleft(None)
                    break
                self.queued -= len(dropped)
        self.arrived.set()

    def silence(self) -> None:
        self.live = False
        self.queue.clear()
        self.queued = 0
        self.push(_FINISH)

    async def next(self) -> np.ndarray | None:
        while not self.queue:
            self.arrived.clear()
            await self.arrived.wait()
        item = self.queue.popleft()
        if item is not None:
            self.queued -= len(item)
        return item


class VoiceService:
    """Implements VoiceHooks: the ears are here, the speaking is delegated to the Mouth."""

    def __init__(self, bodies: _Sender, load_ears: LoadEars, load_tts: LoadTts) -> None:
        self._bodies = bodies
        self._load_ears = load_ears
        self._mouth = Mouth(bodies, load_tts)
        self._sessions: dict[str, _Session] = {}
        self._parts: EarsParts | None = None
        self._loading: asyncio.Task | None = None
        self._lock = asyncio.Lock()  # the models hold state: one session uses them at a time

    def listen(self, body_id: str, mode: Literal["held", "always"]) -> None:
        # One listening session at a time, across bodies: a new listen ends the current one.
        for old in self._sessions.values():
            old.silence()
        self._sessions.clear()
        session = _Session(body_id, mode)
        self._sessions[body_id] = session
        session.task = asyncio.get_running_loop().create_task(self._work(session))

    def mic(self, body_id: str, pcm: bytes) -> None:
        session = self._sessions.get(body_id)
        if session is None or len(pcm) % 2:
            return
        session.push(np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0)

    def unlisten(self, body_id: str) -> None:
        session = self._sessions.pop(body_id, None)
        if session is None:
            return
        if session.mode == "held":
            session.push(_FINISH)  # the last words are kept, then one turn_end
        else:
            session.silence()

    def hush(self, body_id: str) -> None:
        self._mouth.hush(body_id)

    def spoken(self, turn: str, body_id: str, voice: str | None, speed: float | None) -> None:
        self._mouth.spoken(turn, body_id, voice, speed)

    def reply(self, turn: str, body_id: str | None, params: dict) -> None:
        self._mouth.reply(turn, params)

    def turn_ended(self, turn: str) -> None:
        self._mouth.end_turn(turn)

    async def sample(self, text: str, voice: str | None, speed: float | None) -> bytes:
        return await self._mouth.sample(text, voice, speed)

    def _send(self, session: _Session, method: str, params: dict) -> None:
        if session.live:
            self._bodies.send_live(session.body_id, method, params)

    def _flush(self, session: _Session) -> None:
        events, session.pending = session.pending, []
        for event, text in events:
            self._send(
                session,
                "heard",
                {"event": event} if text is None else {"event": event, "text": text},
            )

    async def _models(self, session: _Session) -> EarsParts:
        if self._parts is not None:
            return self._parts
        if self._loading is None:
            last = -1.0

            def progress(fraction: float) -> None:
                nonlocal last
                if fraction < 1 and fraction - last >= 0.02:  # a few dozen lines, not thousands
                    last = fraction
                    for other in list(self._sessions.values()):
                        self._send(other, "voice", {"status": "loading", "progress": fraction})

            self._loading = asyncio.ensure_future(self._load_ears(progress))
            self._loading.add_done_callback(lambda _t: setattr(self, "_loading", None))
        self._parts = await asyncio.shield(self._loading)
        return self._parts

    async def _work(self, session: _Session) -> None:
        try:
            try:
                parts = await self._models(session)
            except Exception as error:
                log.warning("voice models failed to load", exc_info=True)
                self._send(session, "voice", {"status": "failed", "message": _why(error)})
                return
            self._send(session, "voice", {"status": "ready"})
            async with self._lock:
                await self._listen(session, parts)
        finally:
            if self._sessions.get(session.body_id) is session:
                del self._sessions[session.body_id]

    async def _listen(self, session: _Session, parts: EarsParts) -> None:
        def emit(event: str, text: str | None) -> None:
            session.pending.append((event, text))

        ears = None
        try:
            ears = await asyncio.to_thread(Ears, parts, session.mode, emit)
            rest = np.zeros(0, dtype=np.float32)
            while True:
                chunk = await session.next()
                if chunk is _FINISH:
                    if session.live:
                        await asyncio.to_thread(ears.finish)
                        self._flush(session)
                    return
                rest = np.concatenate([rest, chunk])
                while len(rest) >= FRAME and session.live:
                    frame, rest = rest[:FRAME], rest[FRAME:]
                    await asyncio.to_thread(ears.frame, frame)
                    self._flush(session)
        except Exception:
            log.warning("listening failed", exc_info=True)
            self._parts = None  # the next listen loads the models afresh
            if session.mode == "held" and session.live:
                try:
                    if ears is None:
                        raise RuntimeError("the ears never started")
                    await asyncio.to_thread(ears.finish)
                except Exception:
                    session.pending.append(("turn_end", ""))
                self._flush(session)
            else:
                self._send(
                    session, "voice", {"status": "failed", "message": "Voice stopped working."}
                )


def _why(error: Exception) -> str:
    if isinstance(error, ModelIntegrityError):
        return "A voice model download was damaged. Try again in a moment."
    if isinstance(error, OSError):
        return "Could not download the voice models. Check your internet connection and try again."
    return "The voice models could not start."
