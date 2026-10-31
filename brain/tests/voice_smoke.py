"""Hand check of the speaking voice against the real Kokoro model. Not collected by pytest.

Run: uv run python tests/voice_smoke.py [DATA_DIR] [OUT.wav]
Downloads the model into DATA_DIR/voice if missing (default ~/.tagalong), then prints the load
time, the time to the first audio of a sentence and the real-time factor, and writes a WAV.
"""

import asyncio
import sys
import time
from pathlib import Path

import numpy as np

from brain.voice.load import tts_loader
from brain.voice.mouth import _wav

SENTENCES = [
    "Hello, I am Scout. How can I help you today?",
    "The build finished and every single test passed.",
]


async def main() -> None:
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / ".tagalong"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("voice_smoke.wav")
    t0 = time.perf_counter()
    tts = await tts_loader(data_dir)()
    print(f"load: {time.perf_counter() - t0:.2f} s")
    pieces = []
    for text in SENTENCES:
        t0 = time.perf_counter()
        samples, rate = await asyncio.to_thread(tts.synth, text, "bm_george", 1.0)
        took = time.perf_counter() - t0
        print(
            f"synth: {took * 1000:.0f} ms for {len(samples) / rate:.1f} s of audio "
            f"(real-time factor {took / (len(samples) / rate):.2f}), {rate} Hz {samples.dtype}"
        )
        pieces.append(samples)
    out.write_bytes(_wav(np.concatenate(pieces), rate))
    print(f"wrote {out}")


asyncio.run(main())
