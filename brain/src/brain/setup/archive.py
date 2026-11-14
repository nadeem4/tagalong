"""Safe archive extraction: refuse any member that could land outside the target.

Absolute paths, drive letters, `..`, backslash tricks, links pointing out and device files are
all refused by a check of every member before any file is written. Shared by the Node download
and, later, expert binary downloads.
"""

import tarfile
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath


class UnsafeArchive(Exception):
    """An archive member would be written outside the target folder."""


def check_name(name: str) -> None:
    posix, win = PurePosixPath(name), PureWindowsPath(name)
    if posix.is_absolute() or win.is_absolute() or win.drive or win.root:
        raise UnsafeArchive(name)
    if ".." in posix.parts or ".." in win.parts:
        raise UnsafeArchive(name)


def _check_link(name: str, link: str) -> None:
    """A symlink may point inside the archive only; resolve it relative to its own folder."""
    link = link.replace("\\", "/")
    win = PureWindowsPath(link)
    if PurePosixPath(link).is_absolute() or win.drive or win.root:
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
                check_name(name)
            target.mkdir(parents=True, exist_ok=True)
            z.extractall(target)
        return
    with tarfile.open(archive) as t:
        for member in t.getmembers():
            check_name(member.name)
            if member.issym():
                _check_link(member.name, member.linkname)
            elif member.islnk():  # a hard link names another member, from the archive root
                check_name(member.linkname)
            elif member.isdev():
                raise UnsafeArchive(member.name)
        target.mkdir(parents=True, exist_ok=True)
        try:
            t.extractall(target, filter="data")
        except tarfile.FilterError as e:
            raise UnsafeArchive(str(e)) from e
