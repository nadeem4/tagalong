"""Hand check of every roster voice against the real models. Not collected by pytest.

Run: uv run python tests/voice_smoke.py [DATA_DIR] [OUT_DIR]
Downloads each voice into DATA_DIR/voice if missing (default ~/.tagalong), then prints the load
time, the time to the first audio of a sentence and the real-time factor, and writes
OUT_DIR/<voice id>.wav to listen to.
"""

import asyncio
import sys
import time
from pathlib import Path

import numpy as np

from brain.voice.load import fetch
from brain.voice.models import ensure_files
from brain.voice.mouth import _wav
from brain.voice.shape import shape_chunk
from brain.voice.tts import load_voices
from brain.voice.tts_engines import TTS_ENGINES

SENTENCES = [
    "Hello, I am Scout. How can I help you today?",
    "The build finished and every single test passed.",
]


async def main() -> None:
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / ".tagalong"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("voice_smoke")
    out.mkdir(parents=True, exist_ok=True)
    folder = data_dir / "voice"
    for row in load_voices():
        print(f"== {row.id} ({row.engine})")
        await ensure_files(folder, list(row.files), fetch, lambda _p: None)
        t0 = time.perf_counter()
        tts = await asyncio.to_thread(TTS_ENGINES[row.engine].load, row, folder)
        print(f"load: {time.perf_counter() - t0:.2f} s")
        pieces = []
        for text in SENTENCES:
            t0 = time.perf_counter()
            samples, rate = await asyncio.to_thread(tts.synth, text, row.voice, 1.0)
            took = time.perf_counter() - t0
            print(
                f"synth: {took * 1000:.0f} ms for {len(samples) / rate:.1f} s of audio "
                f"(real-time factor {took / (len(samples) / rate):.2f}), {rate} Hz {samples.dtype}"
            )
            shaped = shape_chunk(samples, rate, paragraph_end=False)
            print(f"chunk: {len(samples) / rate:.2f} s raw, {len(shaped) / rate:.2f} s shaped")
            pieces.append(shaped)
        (out / f"{row.id}.wav").write_bytes(_wav(np.concatenate(pieces), rate))
    print(f"wrote {out}")


asyncio.run(main())
