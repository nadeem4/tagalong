"""The real model loaders for voice. Only main.py imports this module; tests use the fakes.

Heavy libraries (onnxruntime, moonshine) are imported inside the adapters' `load`, so starting
the brain never pays for them until somebody first listens. The live model is the chosen row of
`stt_models.json`, loaded through its engine; the choice is read on each load, never mid-session.
"""

import asyncio
import logging
import urllib.request
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path

from brain.telemetry import timed
from brain.voice import cuda, engines, kokoro, silero, smart_turn, stt
from brain.voice.ears import EarsParts
from brain.voice.models import EARS_FILES, KOKORO_FILES, ensure_files
from brain.voice.service import LoadEars
from brain.voice.stt import FinalStt
from brain.voice.tts import Tts

log = logging.getLogger("brain")

CHUNK = 1 << 20
TIMEOUT = 30  # seconds
# Share of the loading bar: the small ONNX files first, then the speech model's own download.
ONNX_SHARE = 0.2
FETCH_SHARE = 0.5  # of the whole bar, when the NVIDIA libraries are fetched first


async def fetch(url: str) -> AsyncIterator[bytes]:
    # The timeout covers each read, so a stalled connection ends as an OSError, not a hang.
    response = await asyncio.to_thread(
        urllib.request.urlopen,
        urllib.request.Request(url, headers={"User-Agent": "tagalong"}),
        timeout=TIMEOUT,
    )
    try:
        while chunk := await asyncio.to_thread(response.read, CHUNK):
            yield chunk
    finally:
        response.close()


async def _load_final(
    model, folder: Path, on_progress: Callable[[float], None], cpu_ok: bool
) -> FinalStt | None:
    # The final model is an upgrade, never a need: if it cannot be had (offline, a file that
    # does not match its hash, no library, a card that cannot run it and no processor wanted)
    # the turn still ends with the live words.
    try:
        load_final = engines.ENGINES[model.engine].load_final
        assert load_final is not None
        await ensure_files(folder, list(model.files), fetch, on_progress)
        with timed("voice_hop", op="load_models"):
            return await asyncio.to_thread(load_final, model, folder, None, cpu_ok)
    except Exception:
        log.warning(
            "the final speech model could not be loaded; using the live words", exc_info=True
        )
        return None


def ears_loader(
    data_dir: Path,
    env_live: str | None = None,
    env_final: str | None = None,
    saved: Callable[[], tuple[str | None, str | None]] = lambda: (None, None),
) -> LoadEars:
    folder = data_dir / "voice"

    async def load_ears(on_progress: Callable[[float], None]) -> EarsParts:
        loop = asyncio.get_running_loop()
        chosen, final_row, base = await _choose(folder, env_live, env_final, saved, on_progress)
        saved_final = saved()[1]

        def report(f: float) -> None:
            on_progress(base + (1 - base) * f)

        engine = engines.ENGINES[chosen.engine]
        assert engine.load_live is not None  # the list only gives a live role to one that has it
        # The loading bar: ONNX files, then the live model, then (if chosen) the final model.
        onnx, live_end = (ONNX_SHARE, 1.0) if final_row is None else (0.1, 0.3)
        files = [*EARS_FILES, *chosen.files]
        await ensure_files(folder, files, fetch, lambda f: report(f * onnx))

        def from_thread(f: float) -> None:
            # Moonshine reports from its worker thread; the sockets and queues are the loop's.
            loop.call_soon_threadsafe(report, onnx + (live_end - onnx) * f)

        with timed("voice_hop", op="load_models"):  # one sample per ears load
            vad = await asyncio.to_thread(silero.load, folder / EARS_FILES[0].path)
            turn = await asyncio.to_thread(smart_turn.load, folder / EARS_FILES[1].path)
            live = await asyncio.to_thread(engine.load_live, chosen, folder, from_thread)
        final = None
        if final_row is not None:
            # A card-only row never lands on the processor, chosen or not; Auto's other rows
            # may, and a model the person chose may.
            cpu_ok = final_row.gpu != "required" and (
                final_row.id in (saved_final, env_final) or "cpu" in final_row.auto
            )
            final = await _load_final(final_row, folder, lambda f: report(0.3 + 0.7 * f), cpu_ok)
        return EarsParts(vad, live, turn, final)

    return load_ears


async def _choose(
    folder: Path,
    env_live: str | None,
    env_final: str | None,
    saved: Callable[[], tuple[str | None, str | None]],
    on_progress: Callable[[float], None],
):
    """Which live and final rows apply, after fetching the NVIDIA libraries when a card needs
    them. Returns (live row, final row or None, where the rest of the bar starts)."""
    # Read now, not at start: the choice Home saved applies from this load. The saved choice
    # comes first, then the env default, then Auto.
    saved_live, saved_final = saved()
    cuda_dir = folder / "cuda"
    await asyncio.to_thread(cuda.add_dll_directory, cuda_dir)  # before the library loads
    hardware = await asyncio.to_thread(stt.detect_hardware, cuda_dir)  # imports ctranslate2
    base = 0.0  # the fetch, when there is one, takes the first half of the bar

    def fetching(f: float) -> None:
        nonlocal base
        base = FETCH_SHARE
        on_progress(f * FETCH_SHARE)

    if hardware.card and not hardware.gpu:
        # A card without the NVIDIA libraries: fetch them (Windows only; a failure is one
        # warning, no retry for 24 h, and the processor), then look again.
        if await cuda.ensure_cuda(folder, fetch, fetching):
            await asyncio.to_thread(cuda.add_dll_directory, cuda_dir)
            hardware = await asyncio.to_thread(stt.detect_hardware, cuda_dir)
    picked = stt.resolve(saved_live, saved_final, env_live, env_final, hardware)
    final_row = picked.final
    if final_row is not None and final_row.gpu == "required" and not hardware.gpu:
        final_row = None  # a card-only model: nothing downloaded, nothing on the processor
    return picked.live, final_row, base


def ears_fetcher(
    data_dir: Path,
    env_live: str | None = None,
    env_final: str | None = None,
    saved: Callable[[], tuple[str | None, str | None]] = lambda: (None, None),
) -> Callable[[], Awaitable[None]]:
    """Download what the listening models need (the ONNX files, the chosen live and final files,
    the NVIDIA libraries when Auto would use the card) and load nothing."""
    folder = data_dir / "voice"

    async def fetch_ears() -> None:
        chosen, final_row, _ = await _choose(folder, env_live, env_final, saved, lambda _f: None)
        files = [*EARS_FILES, *chosen.files, *(final_row.files if final_row else ())]
        await ensure_files(folder, files, fetch, lambda _f: None)

    return fetch_ears


def tts_loader(data_dir: Path) -> Callable[[Callable[[float], None]], Awaitable[Tts]]:
    folder = data_dir / "voice"

    async def load_tts(on_progress: Callable[[float], None]) -> Tts:
        await ensure_files(folder, KOKORO_FILES, fetch, on_progress)
        with timed("voice_hop", op="load_models"):
            return await asyncio.to_thread(kokoro.load, folder)

    return load_tts
