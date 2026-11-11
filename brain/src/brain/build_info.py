"""The brain's version and build id, which the desktop compares to its own.

The version is the installed package's; the build is the app version when packaged
(TAGALONG_BUILD) and a hash of the source files in a dev checkout. The hash recipe is mirrored
in the desktop's build-id.ts; the two share one fixture so they cannot drift.
"""

import hashlib
from importlib import metadata
from pathlib import Path


def app_version() -> str:
    try:
        return metadata.version("brain")
    except metadata.PackageNotFoundError:
        return "0.0.0"


def source_hash(root: Path) -> str:
    """First 12 hex chars of sha256 over every .py and .md under root, outside __pycache__."""
    files = [
        p
        for p in root.rglob("*")
        if p.is_file() and p.suffix in (".py", ".md") and "__pycache__" not in p.parts
    ]
    digest = hashlib.sha256()
    for path in sorted(files, key=lambda p: p.relative_to(root).as_posix()):
        digest.update(path.relative_to(root).as_posix().encode() + b"\0")
        digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()[:12]


def build_id(env_build: str | None, root: Path) -> str:
    return env_build or source_hash(root)
