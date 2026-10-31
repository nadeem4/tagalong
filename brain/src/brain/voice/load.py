"""The real model loaders for voice. Only main.py imports this module; tests use the fakes.

Heavy libraries (onnxruntime, moonshine) are imported inside the adapters' `load`, so starting
the brain never pays for them until somebody first listens.
"""

import asyncio
import urllib.request
from collections.abc import AsyncIterator, Callable
from pathlib import Path

from brain.voice import moonshine, silero, smart_turn
from brain.voice.ears import EarsParts
from brain.voice.models import EARS_FILES, ensure_files

CHUNK = 1 << 20
# Share of the loading bar: the two small ONNX files first, then Moonshine's own download.
ONNX_SHARE = 0.2


async def fetch(url: str) -> AsyncIterator[bytes]:
    response = await asyncio.to_thread(
        urllib.request.urlopen, urllib.request.Request(url, headers={"User-Agent": "tagalong"})
    )
    try:
        while chunk := await asyncio.to_thread(response.read, CHUNK):
            yield chunk
    finally:
        response.close()


def ears_loader(data_dir: Path) -> Callable[[Callable[[float], None]], object]:
    folder = data_dir / "voice"

    async def load_ears(on_progress: Callable[[float], None]) -> EarsParts:
        await ensure_files(folder, EARS_FILES, fetch, lambda f: on_progress(f * ONNX_SHARE))
        vad = await asyncio.to_thread(silero.load, folder / EARS_FILES[0].path)
        turn = await asyncio.to_thread(smart_turn.load, folder / EARS_FILES[1].path)
        stt = await asyncio.to_thread(
            moonshine.load, folder, lambda f: on_progress(ONNX_SHARE + (1 - ONNX_SHARE) * f)
        )
        return EarsParts(vad, stt, turn)

    return load_ears
