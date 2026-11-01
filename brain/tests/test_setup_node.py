"""Checks the private Node download: choosing a build, the checked fetch and the safe extract.

All on fakes: an index and checksum list as bytes, tiny archives built here, no network.
"""

import asyncio
import hashlib
import io
import json
import os
import tarfile
import urllib.request
import zipfile
from pathlib import Path

import pytest

from brain.setup.archive import UnsafeArchive, safe_extract
from brain.setup.facts import node_paths
from brain.setup.net import http_fetch
from brain.setup.node_runtime import (
    NodeBuildMissing,
    NodeIntegrityError,
    NodeInUse,
    archive_name,
    ensure_node,
    pick_build,
)

INDEX = json.loads((Path(__file__).parent / "fixtures" / "node-index.sample.json").read_text())
VERSION = "v22.12.0"


def test_picks_the_newest_lts_at_or_above_min_major():
    build = pick_build(INDEX, 22, "linux", "x64")
    assert build is not None
    assert build.version == VERSION
    assert build.filename == "node-v22.12.0-linux-x64.tar.xz"
    assert build.url == "https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz"


def test_skips_non_lts():
    assert pick_build(INDEX, 23, "linux", "x64") is None


def test_filename_per_os_and_arch_for_the_five_hosts():
    assert archive_name(VERSION, "windows", "x64") == "node-v22.12.0-win-x64.zip"
    assert archive_name(VERSION, "windows", "arm64") == "node-v22.12.0-win-arm64.zip"
    assert archive_name(VERSION, "linux", "x64") == "node-v22.12.0-linux-x64.tar.xz"
    assert archive_name(VERSION, "linux", "arm64") == "node-v22.12.0-linux-arm64.tar.xz"
    assert archive_name(VERSION, "macos", "arm64") == "node-v22.12.0-darwin-arm64.tar.gz"


def test_no_build_for_an_unsupported_arch_returns_none():
    assert pick_build(INDEX, 22, "macos", "x64") is None
    assert pick_build(INDEX, 22, "linux", "riscv") is None


# ---- download, verify, extract ----


def make_zip(extra: dict[str, bytes] | None = None) -> bytes:
    top = f"node-{VERSION}-win-x64"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(f"{top}/node.exe", b"node")
        z.writestr(f"{top}/node_modules/npm/bin/npm-cli.js", b"npm")
        for name, data in (extra or {}).items():
            z.writestr(name, data)
    return buf.getvalue()


def make_tar() -> bytes:
    top = f"node-{VERSION}-linux-x64"
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:xz") as t:
        for name, data in (
            (f"{top}/bin/node", b"node"),
            (f"{top}/lib/node_modules/npm/bin/npm-cli.js", b"npm"),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


class Net:
    """Fake nodejs.org: serves the index, checksum list and archive; records every fetch."""

    def __init__(self, archive: bytes, os_name="windows", listed: str | None = None):
        self.archive = archive
        self.name = archive_name(VERSION, os_name, "x64")
        self.listed = listed or hashlib.sha256(archive).hexdigest()
        self.fetched: list[str] = []
        self.break_midway = False

    async def get_json(self, url: str) -> bytes:
        self.fetched.append(url)
        if url.endswith("index.json"):
            return json.dumps(INDEX).encode()
        assert url.endswith("SHASUMS256.txt")
        return f"{self.listed}  {self.name}\n{'0' * 64}  other.zip\n".encode()

    async def fetch(self, url: str):
        self.fetched.append(url)
        assert url.endswith(self.name)
        half = len(self.archive) // 2
        yield self.archive[:half]
        if self.break_midway:
            raise OSError("connection reset")
        yield self.archive[half:]


async def run(home: Path, net: Net, os_name="windows", arch="x64", progress=None):
    return await ensure_node(
        home, 22, net.fetch, net.get_json, os_name, arch, progress or (lambda f: None)
    )


async def test_downloads_verifies_and_extracts_into_node_dir(tmp_path):
    paths = await run(tmp_path, Net(make_zip()))
    assert paths == node_paths(tmp_path)
    assert paths.node.read_bytes() == b"node"
    assert paths.npm_cli.name == "npm-cli.js"
    runtime = tmp_path / "runtime"
    assert not (runtime / "node.part").exists()
    assert not (runtime / "node.new").exists()


async def test_extracts_a_tar_xz_on_linux(tmp_path):
    paths = await run(tmp_path, Net(make_tar(), "linux"), "linux")
    assert paths.node == tmp_path / "runtime" / "node" / "bin" / "node"


async def test_reports_progress_from_0_to_1(tmp_path):
    seen: list[float] = []
    await run(tmp_path, Net(make_zip()), progress=seen.append)
    assert seen[0] == 0.0
    assert seen[-1] == 1.0
    assert seen == sorted(seen)


async def test_hash_mismatch_twice_raises_and_leaves_nothing(tmp_path):
    net = Net(make_zip(), listed="f" * 64)
    with pytest.raises(NodeIntegrityError):
        await run(tmp_path, net)
    assert len([u for u in net.fetched if u.endswith(".zip")]) == 2
    runtime = tmp_path / "runtime"
    assert not (runtime / "node").exists()
    assert not (runtime / "node.part").exists()
    assert not (runtime / "node.new").exists()


async def test_a_failed_download_leaves_an_existing_node_untouched(tmp_path):
    node = tmp_path / "runtime" / "node"
    node.mkdir(parents=True)
    (node / ".tagalong-node-version").write_text("v18.0.0")
    (node / "node.exe").write_bytes(b"old")
    net = Net(make_zip())
    net.break_midway = True
    with pytest.raises(OSError):
        await run(tmp_path, net)
    assert (node / "node.exe").read_bytes() == b"old"
    assert not (tmp_path / "runtime" / "node.part").exists()


async def test_a_dotdot_member_is_refused_and_nothing_is_written_outside(tmp_path):
    with pytest.raises(UnsafeArchive):
        await run(tmp_path, Net(make_zip({"../evil.txt": b"x"})))
    runtime = tmp_path / "runtime"
    assert not (runtime / "evil.txt").exists()
    assert not (tmp_path / "evil.txt").exists()
    assert not (runtime / "node").exists()
    assert not (runtime / "node.part").exists()
    assert not (runtime / "node.new").exists()


async def test_a_second_call_with_enough_version_fetches_nothing(tmp_path):
    await run(tmp_path, Net(make_zip()))
    seen: list[float] = []
    net = Net(make_zip())
    paths = await run(tmp_path, net, progress=seen.append)
    assert net.fetched == []
    assert seen == [1.0]
    assert paths == node_paths(tmp_path)


async def test_an_older_private_node_is_replaced_after_the_new_one_verifies(tmp_path):
    node = tmp_path / "runtime" / "node"
    node.mkdir(parents=True)
    (node / ".tagalong-node-version").write_text("v18.20.5")
    (node / "stale.txt").write_text("old")
    await run(tmp_path, Net(make_zip()))
    assert not (node / "stale.txt").exists()
    assert (node / ".tagalong-node-version").read_text() == VERSION
    assert not (tmp_path / "runtime" / "node.old").exists()


async def test_no_build_for_this_machine_raises(tmp_path):
    with pytest.raises(NodeBuildMissing):
        await run(tmp_path, Net(make_zip()), "macos", "x64")


async def test_the_system_environment_is_never_touched(tmp_path):
    before = dict(os.environ)
    await run(tmp_path, Net(make_zip()))
    assert dict(os.environ) == before


# ---- safe_extract on its own: refuse, and write nothing anywhere ----


def snapshot(root: Path) -> set[Path]:
    return {p for p in root.rglob("*")}


def tar_of(*members: tuple[tarfile.TarInfo, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as t:
        for info, data in members:
            t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def file_member(name: str) -> tuple[tarfile.TarInfo, bytes]:
    info = tarfile.TarInfo(name)
    info.size = 1
    return info, b"x"


def link_member(name: str, kind: bytes, target: str) -> tuple[tarfile.TarInfo, bytes]:
    info = tarfile.TarInfo(name)
    info.type = kind
    info.linkname = target
    return info, b""


def special_member(name: str, kind: bytes) -> tuple[tarfile.TarInfo, bytes]:
    info = tarfile.TarInfo(name)
    info.type = kind
    return info, b""


def zip_of(*names: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name in names:
            z.writestr(name, b"x")
    return buf.getvalue()


def refused(tmp_path: Path, data: bytes) -> None:
    """The archive is refused and neither the target nor anything beside it was written."""
    work = tmp_path / "work"
    work.mkdir(exist_ok=True)
    archive = work / "a.bin"
    archive.write_bytes(data)
    target = work / "out"
    before = snapshot(tmp_path)
    with pytest.raises(UnsafeArchive):
        safe_extract(archive, target)
    assert snapshot(tmp_path) == before
    assert not target.exists()


def test_refuses_a_tar_absolute_path(tmp_path):
    refused(tmp_path, tar_of(file_member("/etc/evil")))


def test_refuses_a_tar_dotdot_member(tmp_path):
    refused(tmp_path, tar_of(file_member("top/ok"), file_member("../evil")))


def test_refuses_a_zip_absolute_or_drive_path(tmp_path):
    refused(tmp_path, zip_of("top/ok", "C:/evil"))


def test_refuses_a_backslash_dotdot_name(tmp_path):
    refused(tmp_path, tar_of(file_member(r"..\..\x")))
    refused(tmp_path, zip_of(r"..\..\x"))


def test_refuses_a_symlink_that_escapes(tmp_path):
    refused(tmp_path, tar_of(link_member("top/link", tarfile.SYMTYPE, "../../outside")))


def test_refuses_a_backslash_symlink_that_escapes(tmp_path):
    refused(tmp_path, tar_of(link_member("top/link", tarfile.SYMTYPE, r"..\..\outside")))
    refused(tmp_path, tar_of(link_member("top/link", tarfile.SYMTYPE, r"\abs")))


def test_refuses_a_hardlink_that_escapes(tmp_path):
    refused(tmp_path, tar_of(link_member("top/hl", tarfile.LNKTYPE, "../../etc/passwd")))
    refused(tmp_path, tar_of(link_member("top/hl", tarfile.LNKTYPE, "/etc/passwd")))


def test_refuses_a_fifo_or_device_member(tmp_path):
    refused(tmp_path, tar_of(special_member("top/fifo", tarfile.FIFOTYPE)))
    refused(tmp_path, tar_of(special_member("top/dev", tarfile.CHRTYPE)))


def test_a_filter_error_becomes_unsafe_archive(tmp_path, monkeypatch):
    def boom(self, *args, **kwargs):
        raise tarfile.AbsoluteLinkError(tarfile.TarInfo("x"))

    monkeypatch.setattr(tarfile.TarFile, "extractall", boom)
    archive = tmp_path / "a.tar"
    archive.write_bytes(tar_of(file_member("top/ok")))
    with pytest.raises(UnsafeArchive):
        safe_extract(archive, tmp_path / "out")


def test_a_safe_archive_with_an_inside_link_extracts(tmp_path):
    archive = tmp_path / "a.tar"
    archive.write_bytes(
        tar_of(file_member("top/real"), link_member("top/bin/l", tarfile.SYMTYPE, "../real"))
    )
    safe_extract(archive, tmp_path / "out")
    assert (tmp_path / "out" / "top" / "real").exists()


# ---- the swap and concurrency ----


async def test_a_locked_swap_is_node_in_use_and_the_old_node_stays(tmp_path, monkeypatch):
    node = tmp_path / "runtime" / "node"
    node.mkdir(parents=True)
    (node / ".tagalong-node-version").write_text("v18.0.0")
    (node / "node.exe").write_bytes(b"old")
    real = Path.rename

    def locked(self, target):
        if self == node:
            raise PermissionError("in use")
        return real(self, target)

    monkeypatch.setattr(Path, "rename", locked)
    with pytest.raises(NodeInUse):
        await run(tmp_path, Net(make_zip()))
    assert (node / "node.exe").read_bytes() == b"old"
    assert not (tmp_path / "runtime" / "node.new").exists()


async def test_a_failed_move_into_place_restores_the_old_node(tmp_path, monkeypatch):
    node = tmp_path / "runtime" / "node"
    node.mkdir(parents=True)
    (node / ".tagalong-node-version").write_text("v18.0.0")
    (node / "node.exe").write_bytes(b"old")
    real = Path.rename

    def locked(self, target):
        if target == node and self.name != "node.old":
            raise PermissionError("in use")
        return real(self, target)

    monkeypatch.setattr(Path, "rename", locked)
    with pytest.raises(NodeInUse):
        await run(tmp_path, Net(make_zip()))
    assert (node / "node.exe").read_bytes() == b"old"


async def test_two_concurrent_calls_download_once(tmp_path):
    net = Net(make_zip())
    await asyncio.gather(run(tmp_path, net), run(tmp_path, net))
    assert len([u for u in net.fetched if u.endswith(".zip")]) == 1


# ---- the real Fetch, against a fake urlopen (no network at all) ----


class FakeResponse:
    def __init__(self, url="https://nodejs.org/x", status=200, size=3 * 1024 * 1024):
        self.url, self.status, self.left = url, status, size

    def read(self, n):
        got = min(n, self.left)
        self.left -= got
        return b"x" * got

    def close(self):
        pass


def serve(monkeypatch, response):
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: response)


async def test_http_fetch_streams_chunks(monkeypatch):
    serve(monkeypatch, FakeResponse())
    chunks = [c async for c in http_fetch("https://nodejs.org/x")]
    assert len(chunks) > 1
    assert sum(len(c) for c in chunks) == 3 * 1024 * 1024


async def test_http_fetch_raises_on_a_non_200(monkeypatch):
    serve(monkeypatch, FakeResponse(status=404))
    with pytest.raises(OSError):
        [c async for c in http_fetch("https://nodejs.org/x")]


async def test_http_fetch_refuses_a_redirect_to_plain_http(monkeypatch):
    serve(monkeypatch, FakeResponse(url="http://evil.example/x"))
    with pytest.raises(OSError):
        [c async for c in http_fetch("https://nodejs.org/x")]
