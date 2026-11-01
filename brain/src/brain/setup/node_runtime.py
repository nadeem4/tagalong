"""Tagalong's own Node: pick the official build, download it checked, and put it in place.

Lives under `<TAGALONG_HOME>/runtime/node`; the system Node, PATH and global npm are never read
or changed. Hashes come from the official SHASUMS256.txt beside the release. Network and process
seams are passed in, so tests use fakes.
"""

import asyncio
import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from brain.setup.archive import safe_extract
from brain.setup.facts import NodePaths, node_paths
from brain.setup.net import GetJson
from brain.setup.paths import node_dir
from brain.voice.models import Fetch, Progress

DIST = "https://nodejs.org/dist"
MARKER = ".tagalong-node-version"  # which release is in node_dir, so no process is needed to ask

_NODE_OS = {"windows": "win", "linux": "linux", "macos": "darwin"}
_EXT = {"windows": "zip", "linux": "tar.xz", "macos": "tar.gz"}
# The `files` keys of index.json that mean "an official archive exists for this host".
_INDEX_KEY = {
    ("windows", "x64"): "win-x64-zip",
    ("windows", "arm64"): "win-arm64-zip",
    ("linux", "x64"): "linux-x64",
    ("linux", "arm64"): "linux-arm64",
    ("macos", "arm64"): "osx-arm64-tar",
}


class NodeBuildMissing(Exception):
    """No official Node archive for this computer."""


class NodeIntegrityError(Exception):
    """The downloaded Node did not match the official checksum, twice in a row."""


@dataclass(frozen=True)
class NodeBuild:
    version: str
    filename: str
    url: str


def archive_name(version: str, os_name: str, arch: str) -> str:
    return f"node-{version}-{_NODE_OS[os_name]}-{arch}.{_EXT[os_name]}"


def _major(version: str) -> int:
    return int(version.lstrip("v").split(".")[0])


def _key(version: str) -> tuple[int, ...]:
    return tuple(int(p) for p in version.lstrip("v").split("."))


def pick_build(index: list[dict], min_major: int, os_name: str, arch: str) -> NodeBuild | None:
    """The newest LTS release at or above `min_major` that has an archive for this host."""
    wanted = _INDEX_KEY.get((os_name, arch))
    if wanted is None:
        return None
    fits = [
        entry["version"]
        for entry in index
        if entry.get("lts")
        and wanted in entry.get("files", [])
        and _major(entry["version"]) >= min_major
    ]
    if not fits:
        return None
    version = max(fits, key=_key)
    name = archive_name(version, os_name, arch)
    return NodeBuild(version, name, f"{DIST}/{version}/{name}")


def _wanted_sum(sums: str, filename: str) -> str | None:
    for line in sums.splitlines():
        digest, _, name = line.strip().partition("  ")
        if name == filename:
            return digest
    return None


async def _download(part: Path, build: NodeBuild, want: str, fetch: Fetch) -> Path:
    """Stream the archive into `part`, hashing as it goes; one retry, then NodeIntegrityError."""
    part.mkdir(parents=True)
    target = part / build.filename
    for attempt in range(2):
        digest = hashlib.sha256()
        with target.open("wb") as out:
            async for chunk in fetch(build.url):
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() == want:
            return target
        if attempt == 1:
            raise NodeIntegrityError(build.filename)
    raise AssertionError("unreachable")


def _install(archive: Path, new: Path, node: Path, version: str) -> None:
    """Extract, then swap into place; the old Node goes only after the new one is complete."""
    safe_extract(archive, new)
    tops = [p for p in new.iterdir() if p.is_dir()]
    root = tops[0] if len(tops) == 1 else new
    (root / MARKER).write_text(version)
    old = node.with_name(node.name + ".old")
    shutil.rmtree(old, ignore_errors=True)
    if node.exists():
        node.rename(old)
    try:
        root.rename(node)
    except BaseException:
        if old.exists():
            old.rename(node)
        raise
    shutil.rmtree(old, ignore_errors=True)


def _installed_major(node: Path) -> int | None:
    try:
        return _major((node / MARKER).read_text().strip())
    except (OSError, ValueError):
        return None


async def ensure_node(
    home: Path,
    min_major: int,
    fetch: Fetch,
    get_json: GetJson,
    machine_os: str,
    machine_arch: str,
    on_progress: Progress,
) -> NodePaths:
    """Make sure Tagalong's own Node (major >= min_major) is under `home`, downloading if needed."""
    node = node_dir(home)
    have = node_paths(home)
    major = _installed_major(node)
    if have and major is not None and major >= min_major:
        on_progress(1.0)
        return have
    on_progress(0.0)
    index = json.loads(await get_json(f"{DIST}/index.json"))
    build = pick_build(index, min_major, machine_os, machine_arch)
    if build is None:
        raise NodeBuildMissing(f"{machine_os}-{machine_arch}")
    sums = (await get_json(f"{DIST}/{build.version}/SHASUMS256.txt")).decode()
    want = _wanted_sum(sums, build.filename)
    if want is None:
        raise NodeIntegrityError(f"no checksum listed for {build.filename}")
    on_progress(0.05)
    runtime = node.parent
    part, new = runtime / "node.part", runtime / "node.new"
    for leftover in (part, new):
        shutil.rmtree(leftover, ignore_errors=True)
    try:
        archive = await _download(part, build, want, fetch)
        on_progress(0.8)
        await asyncio.to_thread(_install, archive, new, node, build.version)
    finally:
        for leftover in (part, new):
            shutil.rmtree(leftover, ignore_errors=True)
    result = node_paths(home)
    if result is None:
        raise NodeBuildMissing(f"{build.filename} had no node and npm")
    on_progress(1.0)
    return result
