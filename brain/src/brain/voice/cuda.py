"""The NVIDIA libraries the final speech model needs to use the graphics card, fetched on demand.

CTranslate2 on Windows needs cuBLAS 12 and cuDNN 9 DLLs. They are two pinned PyPI wheels
(`cuda_wheels.json`, url, size, SHA-256, checked like the model files; cuDNN is the version
CTranslate2 itself ships). Each wheel is fetched, its `bin/*.dll` extracted into
`<TAGALONG_HOME>/voice/cuda`, and the wheel deleted, one after the other. A failure is one warning
and the processor, and no retry for 24 hours. `probe_cuda` tries the card once in a child process,
because a missing cuDNN sub-library can kill the process instead of raising. Linux uses its system
CUDA, so nothing is fetched there.
"""

import asyncio
import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import zipfile
from collections.abc import Callable, MutableMapping
from pathlib import Path, PurePosixPath

from brain.setup.archive import check_name
from brain.voice.models import Fetch, ModelFile, Progress, ensure_files

log = logging.getLogger("brain")

WHEELS_FILE = Path(__file__).with_name("cuda_wheels.json")
DLLS = ("cublas64_12.dll", "cudnn64_9.dll")
RETRY_AFTER = 24 * 3600  # seconds a failed fetch waits before the next try
PROBE_TIMEOUT = 180  # seconds; the first CUDA load compiles kernels
FAILED = "failed.json"
PROBED = "probe.json"

# Loads the model on the card and decodes one second of silence, as the real load does.
PROBE_CODE = """
import os, sys
import numpy as np
os.environ["PATH"] = sys.argv[2] + os.pathsep + os.environ.get("PATH", "")
if hasattr(os, "add_dll_directory") and os.path.isdir(sys.argv[2]):
    os.add_dll_directory(sys.argv[2])
from faster_whisper import WhisperModel
m = WhisperModel(sys.argv[1], device="cuda", compute_type="float16")
list(m.transcribe(np.zeros(16000, np.float32), language="en", beam_size=1)[0])
"""


def load_wheels() -> list[ModelFile]:
    return [ModelFile(**r) for r in json.loads(WHEELS_FILE.read_text(encoding="utf-8"))]


def libs_present(folder: Path) -> bool:
    return all((folder / dll).is_file() for dll in DLLS)


def add_dll_directory(folder: Path, environ: MutableMapping[str, str] | None = None) -> None:
    """Make `folder` findable by the NVIDIA libraries; call before CTranslate2 loads.

    Python no longer searches PATH for an extension's own DLLs, so `os.add_dll_directory` covers
    those; but cuBLAS and the cuDNN sub-libraries are opened later with LoadLibrary, which
    ignores it and reads PATH, so the folder goes first there too.
    """
    env = os.environ if environ is None else environ
    if sys.platform != "win32" or not folder.is_dir():
        return
    head = str(folder)
    rest = [p for p in env.get("PATH", "").split(os.pathsep) if p and p != head]
    env["PATH"] = os.pathsep.join([head, *rest])
    os.add_dll_directory(head)


def extract_dlls(archive: Path, target: Path) -> None:
    """Write each `bin/*.dll` of the wheel flat into `target` (streamed, a DLL is large); a name
    that escapes raises before anything is written."""
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        for name in names:
            check_name(name)
        dlls = [n for n in names if n.endswith(".dll") and PurePosixPath(n).parent.name == "bin"]
        target.mkdir(parents=True, exist_ok=True)
        for name in dlls:
            final = target / PurePosixPath(name).name
            part = final.with_name(final.name + ".part")
            with z.open(name) as src, part.open("wb") as out:
                shutil.copyfileobj(src, out)
            part.replace(final)


def _failed_recently(target: Path) -> bool:
    try:
        when = json.loads((target / FAILED).read_text(encoding="utf-8"))["at"]
        return time.time() - float(when) < RETRY_AFTER
    except (OSError, ValueError, KeyError, TypeError):
        return False


def _mark(target: Path, failed: bool) -> None:
    marker = target / FAILED
    if not failed:
        marker.unlink(missing_ok=True)
        return
    target.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps({"at": time.time()}), encoding="utf-8")


async def ensure_cuda(voice: Path, fetch: Fetch, on_progress: Progress) -> bool:
    """Make `<voice>/cuda` hold the libraries. False (after one warning) when it could not."""
    if sys.platform != "win32":
        return False
    target = voice / "cuda"
    if _failed_recently(target):
        return False
    wheels = load_wheels()
    ok = False
    try:
        for i, (w, dll) in enumerate(
            zip(wheels, DLLS, strict=True)
        ):  # wheels are listed in DLLS order
            if (target / dll).is_file():
                on_progress((i + 1) / len(wheels))
                continue
            # A verified wheel stays until it is extracted (a bad hash is deleted by the fetch);
            # the next is not fetched before that.
            await ensure_files(voice, [w], fetch, lambda f, i=i: on_progress((i + f) / len(wheels)))
            await asyncio.to_thread(extract_dlls, voice / w.path, target)
            (voice / w.path).unlink(missing_ok=True)
        ok = libs_present(target)
        if not ok:
            log.warning("the NVIDIA libraries are still not present after the fetch")
    except Exception:
        log.warning(
            "the NVIDIA libraries could not be fetched; the final model will use the processor",
            exc_info=True,
        )
    await asyncio.to_thread(_mark, target, not ok)
    return ok


def _key() -> str:
    return hashlib.sha256("".join(w.sha256 for w in load_wheels()).encode()).hexdigest()


def _cached_answer(cache: Path, key: str) -> bool | None:
    """The kept answer; None when absent, for other wheels, or a False a day old."""
    try:
        saved = json.loads(cache.read_text(encoding="utf-8"))
        if saved["key"] != key:
            return None
        if not saved["ok"] and time.time() - float(saved["at"]) >= RETRY_AFTER:
            return None
        return bool(saved["ok"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def probe_cuda(
    voice: Path, model_dir: str, run: Callable[..., "subprocess.CompletedProcess"] = subprocess.run
) -> bool:
    """Whether the card can run the final model, tried once in a child process. A clean answer is
    kept under `<voice>/cuda`, keyed by the wheels (a False for 24 hours), so it is not repeated
    on every start; a timeout or a child that would not start is not kept.
    Blocking: callers are already off the event loop."""
    cache = voice / "cuda" / PROBED
    key = _key()
    saved = _cached_answer(cache, key)
    if saved is not None:
        return saved
    cmd = [sys.executable, "-c", PROBE_CODE, model_dir, str(voice / "cuda")]
    try:
        done = run(cmd, capture_output=True, timeout=PROBE_TIMEOUT)
    except (OSError, subprocess.SubprocessError):
        log.warning("the CUDA probe did not finish", exc_info=True)
        return False
    ok = done.returncode == 0
    if not ok:
        tail = (getattr(done, "stderr", b"") or b"").decode("utf-8", "replace").splitlines()[-5:]
        log.warning("the CUDA probe failed (exit %s): %s", done.returncode, " | ".join(tail))
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"key": key, "ok": ok, "at": time.time()}), encoding="utf-8")
    return ok
