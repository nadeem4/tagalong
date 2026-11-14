"""The NVIDIA libraries the final speech model needs to use the graphics card, fetched on demand.

CTranslate2 on Windows needs cuBLAS 12 and cuDNN 9 DLLs. They are two pinned PyPI wheels
(`cuda_wheels.json`, url, size, SHA-256, checked like the model files). Only each wheel's
`bin/*.dll` is kept, in `<TAGALONG_HOME>/voice/cuda`; the wheel is deleted after. Any failure
is one warning and the processor. Linux uses its system CUDA, so nothing happens there.
"""

import asyncio
import json
import logging
import os
import sys
import zipfile
from pathlib import Path, PurePosixPath

from brain.setup.archive import check_name
from brain.voice.models import Fetch, ModelFile, Progress, ensure_files

log = logging.getLogger("brain")

WHEELS_FILE = Path(__file__).with_name("cuda_wheels.json")
DLLS = ("cublas64_12.dll", "cudnn64_9.dll")


def load_wheels() -> list[ModelFile]:
    return [ModelFile(**r) for r in json.loads(WHEELS_FILE.read_text(encoding="utf-8"))]


def libs_present(folder: Path) -> bool:
    return all((folder / dll).is_file() for dll in DLLS)


def add_dll_directory(folder: Path) -> None:
    # Python 3.8+ on Windows no longer searches PATH for a library's own DLLs.
    if sys.platform == "win32" and folder.is_dir():
        os.add_dll_directory(str(folder))


def extract_dlls(archive: Path, target: Path) -> None:
    """Write each `bin/*.dll` of the wheel flat into `target`, or raise having written nothing."""
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        for name in names:
            check_name(name)
        dlls = [n for n in names if n.endswith(".dll") and PurePosixPath(n).parent.name == "bin"]
        target.mkdir(parents=True, exist_ok=True)
        for name in dlls:
            final = target / PurePosixPath(name).name
            part = final.with_name(final.name + ".part")
            part.write_bytes(z.read(name))
            part.replace(final)


async def ensure_cuda(voice: Path, fetch: Fetch, on_progress: Progress) -> bool:
    """Make `<voice>/cuda` hold the libraries. False (after one warning) when it could not."""
    if sys.platform != "win32":
        return False
    wheels = load_wheels()
    target = voice / "cuda"
    try:
        await ensure_files(voice, wheels, fetch, on_progress)
        for w in wheels:
            await asyncio.to_thread(extract_dlls, voice / w.path, target)
            (voice / w.path).unlink(missing_ok=True)
        return libs_present(target)
    except Exception:
        log.warning(
            "the NVIDIA libraries could not be fetched; the final model will use the processor",
            exc_info=True,
        )
        for w in wheels:
            (voice / w.path).unlink(missing_ok=True)
        return False
