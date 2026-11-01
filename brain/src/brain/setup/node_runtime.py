"""Tagalong's own Node: pick the official build for this machine.

Lives under `<TAGALONG_HOME>/runtime/node`; the system Node, PATH and global npm are never read
or changed. Hashes come from the official SHASUMS256.txt beside the release. Network and process
seams are passed in, so tests use fakes.
"""

from dataclasses import dataclass

DIST = "https://nodejs.org/dist"

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
