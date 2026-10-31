"""Pinned model files and their checked download, into `<TAGALONG_HOME>/voice`.

Each file is a URL pinned to one commit, an exact size and a SHA-256, so a changed or damaged
download can never be used. Written to `.part` and renamed only once the hash matches. The
network is a seam (`fetch`) so tests never touch it. Moonshine fetches its own files.
"""

import asyncio
import hashlib
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from pathlib import Path

Fetch = Callable[[str], AsyncIterator[bytes]]
Progress = Callable[[float], None]

_HF = "https://huggingface.co"


@dataclass(frozen=True)
class ModelFile:
    url: str  # pinned to one commit, never `main`
    path: str  # under the voice folder
    bytes: int
    sha256: str


class ModelIntegrityError(Exception):
    """A downloaded file did not match its pinned SHA-256, twice in a row."""


EARS_FILES = [
    ModelFile(
        f"{_HF}/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx",
        "ears/silero-vad/model.onnx",
        2_243_022,
        "a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808",
    ),
    ModelFile(
        f"{_HF}/pipecat-ai/smart-turn-v3/resolve/f766f81d3cfdf7737ac64aad813d91bbfd56bf93/smart-turn-v3.2-cpu.onnx",
        "ears/smart-turn-v3/smart-turn-v3.2-cpu.onnx",
        8_679_182,
        "2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f",
    ),
]


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


async def _verified(target: Path, file: ModelFile) -> bool:
    if not target.exists():
        return False
    if await asyncio.to_thread(_sha256_of, target) == file.sha256:
        return True
    target.unlink(missing_ok=True)
    return False


async def _download(
    target: Path, file: ModelFile, fetch: Fetch, on_bytes: Callable[[int], None]
) -> None:
    part = target.with_name(target.name + ".part")
    target.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(2):
        digest = hashlib.sha256()
        got = 0
        try:
            with part.open("wb") as out:
                async for chunk in fetch(file.url):
                    digest.update(chunk)
                    out.write(chunk)
                    got += len(chunk)
                    on_bytes(len(chunk))
        except BaseException:
            part.unlink(missing_ok=True)
            raise
        if digest.hexdigest() == file.sha256:
            part.replace(target)
            return
        part.unlink(missing_ok=True)
        on_bytes(-got)  # the next attempt counts again from zero
        if attempt == 1:
            raise ModelIntegrityError(file.path)


async def ensure_files(
    folder: Path, files: list[ModelFile], fetch: Fetch, on_progress: Progress
) -> None:
    missing = [f for f in files if not await _verified(folder / f.path, f)]
    if not missing:
        on_progress(1.0)
        return
    total = sum(f.bytes for f in files)
    done = total - sum(f.bytes for f in missing)
    if done > 0:
        on_progress(done / total)

    def on_bytes(count: int) -> None:
        nonlocal done
        done += count
        on_progress(min(max(done / total, 0.0), 1.0))

    for file in missing:
        await _download(folder / file.path, file, fetch, on_bytes)
    on_progress(1.0)
