"""Measure the speech models: `uv run python -m tools.stt_bench` from brain/.

Dev-only, run by hand, never in CI. It DOWNLOADS the candidate models (into the voice folder
under TAGALONG_HOME, size and hash checked like the app does) and Kokoro, then reports per model:
word error rate, how often "Scout" survives, CPU and GPU load while decoding, the delay after the
end of a turn (final models), and Silero's idle CPU. `MODES` is the plug-in point: a later `wake`
mode adds one function here. Heavy imports stay inside functions so importing this is free.
"""

import argparse
import asyncio
import os
import subprocess
import threading
import time
import wave
from pathlib import Path

import numpy as np

from tools.stt_bench.corpus import Clip, kokoro_clips, load_folder
from tools.stt_bench.metrics import mix_noise, name_kept, wer

RATE = 16_000
FRAME = 512  # Silero's window; live models take any size


def resample(audio: np.ndarray, rate: int) -> np.ndarray:
    if rate == RATE:
        return audio.astype(np.float32)
    n = int(len(audio) * RATE / rate)
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(
        np.float32
    )


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as f:
        raw = np.frombuffer(f.readframes(f.getnframes()), "<i2").astype(np.float32) / 32768
        return resample(raw.reshape(-1, f.getnchannels()).mean(axis=1), f.getframerate())


def _download(files: list, folder: Path) -> None:
    from brain.voice.load import fetch
    from brain.voice.models import ensure_files

    asyncio.run(ensure_files(folder, files, fetch, lambda _f: None))


def audio_for(clips: list[Clip], home: Path, snr: float) -> list[tuple[Clip, np.ndarray]]:
    """Every clip as 16 kHz float audio; Kokoro clips are spoken now, all get noise at `snr`."""
    folder = home / "voice"
    tts = None
    out = []
    for i, clip in enumerate(clips):
        if clip.wav is not None:
            audio = read_wav(clip.wav)
        else:
            if tts is None:
                from brain.voice import kokoro
                from brain.voice.models import KOKORO_FILES

                _download(list(KOKORO_FILES), folder)
                tts = kokoro.load(folder)
            pcm, rate = tts.synth(clip.reference, clip.voice or "bm_george", 1.0)
            audio = resample(pcm.astype(np.float32) / 32768, rate)
        out.append((clip, mix_noise(audio, snr, seed=i) if snr < 100 else audio))
    return out


class GpuWatch:
    """Peak GPU use from nvidia-smi while a block runs; None when there is no such tool."""

    def __init__(self) -> None:
        self.peak: float | None = None
        self._stop = threading.Event()

    def _poll(self) -> None:
        query = ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"]
        while not self._stop.is_set():
            try:
                out = subprocess.run(query, capture_output=True, text=True, timeout=5)
                self.peak = max(self.peak or 0.0, float(out.stdout.split()[0]))
            except (OSError, IndexError, ValueError, subprocess.SubprocessError):
                return
            self._stop.wait(0.25)

    def __enter__(self) -> "GpuWatch":
        threading.Thread(target=self._poll, daemon=True).start()
        return self

    def __exit__(self, *_exc) -> None:
        self._stop.set()


def decode(model, engine, folder: Path, audio) -> tuple[list[str], float, float, float | None]:
    """Transcripts, mean CPU cores busy, mean seconds per clip, peak GPU percent."""
    if model.role in ("live", "both"):
        live = engine.load_live(model, folder, None)

        def run(a: np.ndarray) -> str:
            live.reset()
            for i in range(0, len(a), FRAME):
                live.accept(a[i : i + FRAME])
            return live.finish()
    else:
        run = engine.load_final(model, folder, None).transcribe
    run(audio[0][1][:RATE])  # warm up so load cost is not counted as decode
    texts: list[str] = []
    per_clip: list[float] = []
    wall0, cpu0 = time.perf_counter(), time.process_time()
    with GpuWatch() as gpu:
        for _clip, a in audio:
            t0 = time.perf_counter()
            texts.append(run(a))
            per_clip.append(time.perf_counter() - t0)
    wall, cpu = time.perf_counter() - wall0, time.process_time() - cpu0
    return texts, cpu / wall, sum(per_clip) / len(per_clip), gpu.peak


def idle_cpu(home: Path, seconds: int) -> float:
    """Silero on silence, as in Always mode: CPU cores busy at real-time pace (cost per second)."""
    from brain.voice import silero
    from brain.voice.models import EARS_FILES

    folder = home / "voice"
    _download(list(EARS_FILES), folder)
    vad = silero.load(folder / EARS_FILES[0].path)
    silence = np.zeros(FRAME, np.float32)
    cpu0 = time.process_time()
    for _ in range(seconds * RATE // FRAME):
        vad.speech(silence)
    return (time.process_time() - cpu0) / seconds


def run_stt(args: argparse.Namespace) -> None:
    from brain.voice import engines, stt

    home = Path(os.environ.get("TAGALONG_HOME") or Path.home() / ".tagalong")
    corpus = [] if args.no_kokoro else kokoro_clips()
    for folder in args.clips:
        found = load_folder(folder)
        corpus += found.items
        for line in found.skipped:
            print(f"skipped: {line}")
    if not corpus:
        raise SystemExit("nothing to measure: no clips and Kokoro lines are off")
    audio = audio_for(corpus, home, args.snr)
    print(f"{len(audio)} clips, noise at {args.snr} dB SNR\n")
    print("| model | role | WER | name kept | CPU cores | GPU peak % | s per clip |")
    print("|---|---|---|---|---|---|---|")
    for model in stt.load_models():
        if args.models and model.id not in args.models:
            continue
        _download(list(model.files), home / "voice")
        engine = engines.ENGINES[model.engine]
        texts, cpu, delay, gpu = decode(model, engine, home / "voice", audio)
        rates = [wer(c.reference, t) for (c, _a), t in zip(audio, texts, strict=True)]
        gpu_text = "n/a" if gpu is None else f"{gpu:.0f}"
        print(
            f"| {model.id} | {model.role} | {np.mean(rates):.3f} | "
            f"{np.mean([name_kept(t) for t in texts]):.0%} | {cpu:.2f} | {gpu_text} | {delay:.2f} |"
        )
    if args.idle_seconds:
        print(f"\nidle (Silero on silence): {idle_cpu(home, args.idle_seconds):.3f} cores")


MODES = {"stt": run_stt}


def main() -> None:
    p = argparse.ArgumentParser(description="Measure the speech models.")
    p.add_argument("--mode", choices=sorted(MODES), default="stt")
    p.add_argument("--models", nargs="*", help="model ids from stt_models.json (default: all)")
    p.add_argument("--clips", type=Path, nargs="*", default=[], help="folders of name.wav+name.txt")
    p.add_argument("--no-kokoro", action="store_true", help="only the --clips folders")
    p.add_argument("--snr", type=float, default=15.0, help="noise SNR in dB (100+ = none)")
    p.add_argument("--idle-seconds", type=int, default=60, help="0 skips the idle measure")
    args = p.parse_args()
    MODES[args.mode](args)


if __name__ == "__main__":
    main()
