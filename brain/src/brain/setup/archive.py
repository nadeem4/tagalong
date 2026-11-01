"""Safe archive extraction: refuse any member that could land outside the target.

Absolute paths, drive letters, `..` and links pointing out are all refused before anything is
written. Shared by the Node download and, later, expert binary downloads.
"""

import tarfile
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath


class UnsafeArchive(Exception):
    """An archive member would be written outside the target folder."""


def _check_name(name: str) -> None:
    posix, win = PurePosixPath(name), PureWindowsPath(name)
    if posix.is_absolute() or win.is_absolute() or win.drive or win.root:
        raise UnsafeArchive(name)
    if ".." in posix.parts or ".." in win.parts:
        raise UnsafeArchive(name)


def _check_link(name: str, link: str) -> None:
    """A link may point inside the archive only; resolve it relative to its own folder."""
    _check_name(name)
    if PurePosixPath(link).is_absolute() or PureWindowsPath(link).drive:
        raise UnsafeArchive(f"{name} -> {link}")
    depth = len(PurePosixPath(name).parts) - 1
    for part in PurePosixPath(link).parts:
        depth += -1 if part == ".." else 0 if part == "." else 1
        if depth < 0:
            raise UnsafeArchive(f"{name} -> {link}")


def safe_extract(archive: Path, target: Path) -> None:
    """Extract a .zip, .tar.gz or .tar.xz into `target`, or raise having written nothing."""
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                _check_name(name)
            target.mkdir(parents=True, exist_ok=True)
            z.extractall(target)
        return
    with tarfile.open(archive) as t:
        for member in t.getmembers():
            _check_name(member.name)
            if member.issym() or member.islnk():
                _check_link(member.name, member.linkname)
            elif member.isdev():
                raise UnsafeArchive(member.name)
        target.mkdir(parents=True, exist_ok=True)
        t.extractall(target, filter="data")
