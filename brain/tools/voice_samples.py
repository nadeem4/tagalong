"""Make the sample clip of every roster voice. Hand run, never in CI.

Run from brain/: uv run python tools/voice_samples.py OUT_DIR [DATA_DIR]
It DOWNLOADS each voice's pinned files into DATA_DIR/voice (default ~/.tagalong), says
`SAMPLE_TEXT` with every voice, writes OUT_DIR/<id>.wav and prints each file's size and sha256,
ready to paste into `tts_models.json` once the WAVs are uploaded to the `voice-samples-v1` release.
"""

import asyncio
import hashlib
import sys
from pathlib import Path

from brain.voice.load import fetch
from brain.voice.models import ensure_files
from brain.voice.mouth import wav_bytes
from brain.voice.tts import SAMPLE_TEXT, load_voices
from brain.voice.tts_engines import TTS_ENGINES


async def main() -> None:
    out = Path(sys.argv[1])
    data_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / ".tagalong"
    folder = data_dir / "voice"
    out.mkdir(parents=True, exist_ok=True)
    for row in load_voices():
        await ensure_files(folder, list(row.files), fetch, lambda _p: None)
        tts = await asyncio.to_thread(TTS_ENGINES[row.engine].load, row, folder)
        samples, rate = await asyncio.to_thread(tts.synth, SAMPLE_TEXT, row.voice, 1.0)
        data = wav_bytes(samples, rate)
        (out / f"{row.id}.wav").write_bytes(data)
        print(f"{row.id}: {len(data)} bytes sha256 {hashlib.sha256(data).hexdigest()}")


asyncio.run(main())
