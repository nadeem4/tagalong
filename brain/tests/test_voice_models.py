"""Tests for the pinned model file cache: checked download, retry, sharing, progress."""

import asyncio
import hashlib
import re

import pytest

from brain.voice.models import (
    EARS_FILES,
    ModelFile,
    ModelIntegrityError,
    ensure_files,
    files_present,
)


def file_for(path: str, data: bytes) -> ModelFile:
    return ModelFile(
        f"https://example.test/{path}", path, len(data), hashlib.sha256(data).hexdigest()
    )


class Net:
    """A fake network: serves `bodies` by url in two chunks, counting fetches."""

    def __init__(self, bodies: dict[str, list[bytes]]) -> None:
        self.bodies = bodies  # a list is consumed one entry per fetch (last one repeats)
        self.fetched: list[str] = []
        self.gate: asyncio.Event | None = None

    async def __call__(self, url: str):
        self.fetched.append(url)
        queue = self.bodies[url]
        data = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(data, Exception):
            raise data
        if self.gate is not None:
            await self.gate.wait()
        half = len(data) // 2
        yield data[:half]
        yield data[half:]


def test_ears_files_are_pinned_to_a_commit():
    assert len(EARS_FILES) == 2
    for f in EARS_FILES:
        assert re.search(r"/resolve/[0-9a-f]{40}/", f.url), f.url
        assert re.fullmatch(r"[0-9a-f]{64}", f.sha256)
        assert f.bytes > 0


async def test_good_download_is_renamed_from_part_and_progress_ends_at_one(tmp_path):
    a, b = b"a" * 40, b"b" * 60
    fa, fb = file_for("x/a.bin", a), file_for("x/b.bin", b)
    net = Net({fa.url: [a], fb.url: [b]})
    seen: list[float] = []
    await ensure_files(tmp_path, [fa, fb], net, seen.append)
    assert (tmp_path / "x/a.bin").read_bytes() == a and (tmp_path / "x/b.bin").read_bytes() == b
    assert list(tmp_path.rglob("*.part")) == []
    assert seen[-1] == 1 and max(seen) <= 1 and seen == sorted(seen)
    assert files_present(tmp_path, [fa, fb])


async def test_a_bad_hash_is_deleted_and_fetched_once_more(tmp_path):
    good = b"g" * 20
    f = file_for("m.bin", good)
    net = Net({f.url: [b"x" * 20, good]})
    await ensure_files(tmp_path, [f], net, lambda p: None)
    assert (tmp_path / "m.bin").read_bytes() == good
    assert len(net.fetched) == 2


async def test_two_bad_copies_raise_and_leave_no_part(tmp_path):
    f = file_for("m.bin", b"g" * 20)
    net = Net({f.url: [b"x" * 20]})
    with pytest.raises(ModelIntegrityError):
        await ensure_files(tmp_path, [f], net, lambda p: None)
    assert list(tmp_path.rglob("*")) == [] or all(p.is_dir() for p in tmp_path.rglob("*"))
    assert not (tmp_path / "m.bin").exists()


async def test_a_fetch_error_leaves_no_part_and_the_next_try_works(tmp_path):
    good = b"g" * 20
    f = file_for("m.bin", good)
    net = Net({f.url: [OSError("offline"), good]})
    with pytest.raises(OSError):
        await ensure_files(tmp_path, [f], net, lambda p: None)
    assert list(tmp_path.rglob("*.part")) == []
    await ensure_files(tmp_path, [f], net, lambda p: None)
    assert (tmp_path / "m.bin").read_bytes() == good


async def test_a_good_file_on_disk_is_not_fetched(tmp_path):
    data = b"d" * 30
    f = file_for("m.bin", data)
    (tmp_path / "m.bin").write_bytes(data)
    net = Net({})
    seen: list[float] = []
    await ensure_files(tmp_path, [f], net, seen.append)
    assert net.fetched == [] and seen == [1]


async def test_a_damaged_file_on_disk_is_replaced(tmp_path):
    data = b"d" * 30
    f = file_for("m.bin", data)
    (tmp_path / "m.bin").write_bytes(b"broken")
    await ensure_files(tmp_path, [f], Net({f.url: [data]}), lambda p: None)
    assert (tmp_path / "m.bin").read_bytes() == data


async def test_progress_counts_files_already_good_from_the_start(tmp_path):
    a, b = b"a" * 50, b"b" * 50
    fa, fb = file_for("a.bin", a), file_for("b.bin", b)
    (tmp_path / "a.bin").write_bytes(a)
    seen: list[float] = []
    await ensure_files(tmp_path, [fa, fb], Net({fb.url: [b]}), seen.append)
    assert seen[0] == 0.5 and seen[-1] == 1


async def test_two_concurrent_calls_share_one_download(tmp_path):
    data = b"s" * 20
    f = file_for("m.bin", data)
    net = Net({f.url: [data]})
    net.gate = asyncio.Event()
    first: list[float] = []
    second: list[float] = []
    one = asyncio.create_task(ensure_files(tmp_path, [f], net, first.append))
    await asyncio.sleep(0.01)
    two = asyncio.create_task(ensure_files(tmp_path, [f], net, second.append))
    await asyncio.sleep(0.01)
    net.gate.set()
    await asyncio.gather(one, two)
    assert net.fetched == [f.url]
    assert first[-1] == 1 and second[-1] == 1
