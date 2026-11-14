"""Tests for the NVIDIA libraries fetched on demand: pinned rows, DLL-only extract, the DLL
directory, and every failure ending as one warning and the processor. Fakes only, no network."""

import hashlib
import io
import logging
import sys
import types
import zipfile

import pytest

from brain.setup.archive import UnsafeArchive
from brain.voice import cuda, stt
from brain.voice.models import ModelFile


def wheel(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in members.items():
            z.writestr(name, data)
    return buf.getvalue()


def row(path: str, data: bytes) -> ModelFile:
    return ModelFile(f"https://x.test/{path}", path, len(data), hashlib.sha256(data).hexdigest())


GOOD = wheel(
    {
        "nvidia/cublas/bin/cublas64_12.dll": b"blas",
        "nvidia/cublas/lib/x.lib": b"no",
        "nvidia/cublas/include/h.h": b"no",
    }
)
DNN = wheel({"nvidia/cudnn/bin/cudnn64_9.dll": b"dnn"})


def fetcher(bodies: dict[str, bytes]):
    async def fetch(url):
        yield bodies[url]

    return fetch


@pytest.fixture
def windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")


def rows(*pairs):
    return [row(p, d) for p, d in pairs]


def test_pinned_rows_are_complete():
    got = cuda.load_wheels()
    assert [w.path.split("/")[-1].split("-")[0] for w in got] == [
        "nvidia_cublas_cu12",
        "nvidia_cudnn_cu12",
    ]
    assert all(w.url.startswith("https://files.pythonhosted.org/") for w in got)
    assert all(len(w.sha256) == 64 and w.bytes > 1_000_000 for w in got)


def test_extract_keeps_only_bin_dlls(tmp_path):
    archive = tmp_path / "w.whl"
    archive.write_bytes(GOOD)
    cuda.extract_dlls(archive, tmp_path / "cuda")
    assert [p.name for p in (tmp_path / "cuda").iterdir()] == ["cublas64_12.dll"]


def test_extract_refuses_a_path_that_escapes(tmp_path):
    archive = tmp_path / "w.whl"
    archive.write_bytes(wheel({"../evil/bin/x.dll": b"x"}))
    with pytest.raises(UnsafeArchive):
        cuda.extract_dlls(archive, tmp_path / "cuda")
    assert not (tmp_path / "cuda").exists()


def test_add_dll_directory_is_called_on_windows(monkeypatch, tmp_path, windows):
    seen = []
    monkeypatch.setattr(cuda.os, "add_dll_directory", lambda p: seen.append(p), raising=False)
    cuda.add_dll_directory(tmp_path / "cuda")
    assert seen == []  # nothing there yet
    (tmp_path / "cuda").mkdir()
    cuda.add_dll_directory(tmp_path / "cuda")
    assert seen == [str(tmp_path / "cuda")]


def test_add_dll_directory_does_nothing_off_windows(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(cuda.os, "add_dll_directory", lambda p: 1 / 0, raising=False)
    (tmp_path / "cuda").mkdir()
    cuda.add_dll_directory(tmp_path / "cuda")


async def test_ensure_cuda_downloads_extracts_and_cleans_up(monkeypatch, tmp_path, windows):
    listed = rows(("cuda/wheels/a.whl", GOOD), ("cuda/wheels/b.whl", DNN))
    monkeypatch.setattr(cuda, "load_wheels", lambda: listed)
    net = fetcher({listed[0].url: GOOD, listed[1].url: DNN})
    progress = []
    assert await cuda.ensure_cuda(tmp_path, net, progress.append) is True
    assert cuda.libs_present(tmp_path / "cuda")
    assert not list((tmp_path / "cuda").glob("**/*.whl"))  # the large wheels are not kept
    assert progress[-1] == 1.0


async def test_ensure_cuda_does_nothing_off_windows(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")

    async def boom(*a):
        raise AssertionError("downloaded")

    monkeypatch.setattr(cuda, "ensure_files", boom)
    assert await cuda.ensure_cuda(tmp_path, boom, lambda f: None) is False


async def test_bad_sha_gives_one_warning_and_false(monkeypatch, tmp_path, windows, caplog):
    listed = rows(("cuda/wheels/a.whl", GOOD), ("cuda/wheels/b.whl", DNN))
    monkeypatch.setattr(cuda, "load_wheels", lambda: listed)
    net = fetcher({listed[0].url: b"tampered", listed[1].url: DNN})
    with caplog.at_level(logging.WARNING, logger="brain"):
        assert await cuda.ensure_cuda(tmp_path, net, lambda f: None) is False
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1
    assert not cuda.libs_present(tmp_path / "cuda")


async def test_failed_download_gives_one_warning_and_false(monkeypatch, tmp_path, windows, caplog):
    monkeypatch.setattr(cuda, "load_wheels", lambda: rows(("cuda/wheels/a.whl", GOOD)))

    async def offline(url):
        raise OSError("offline")
        yield b""

    with caplog.at_level(logging.WARNING, logger="brain"):
        assert await cuda.ensure_cuda(tmp_path, offline, lambda f: None) is False
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1


def _fake_ct2(monkeypatch, count):
    mod = types.ModuleType("ctranslate2")
    mod.get_cuda_device_count = lambda: count
    monkeypatch.setitem(sys.modules, "ctranslate2", mod)


def test_detect_hardware_finds_both_libraries_in_the_cuda_folder(monkeypatch, tmp_path):
    import ctypes.util

    monkeypatch.setattr(ctypes.util, "find_library", lambda name: None)
    _fake_ct2(monkeypatch, 1)
    folder = tmp_path / "cuda"
    folder.mkdir()
    assert stt.detect_hardware(folder) == stt.Hardware(gpu=False, card=True)
    (folder / "cublas64_12.dll").write_bytes(b"x")
    assert stt.detect_hardware(folder).gpu is False  # cuDNN still missing
    (folder / "cudnn64_9.dll").write_bytes(b"x")
    assert stt.detect_hardware(folder) == stt.Hardware(gpu=True, card=True)


# The loader fetches only with a card and no libraries.
async def _run_loader(monkeypatch, tmp_path, hardware_seq, fetched_ok):
    from fake_voice import parts

    from brain.voice import engines, load
    from brain.voice.engines import Engine

    made = parts()
    calls = []
    hw = iter(hardware_seq)

    async def no_files(folder, files, fetch, on_progress):
        return None

    async def fake_ensure(folder, fetch, on_progress):
        calls.append("ensure")
        return fetched_ok

    monkeypatch.setattr(load, "ensure_files", no_files)
    monkeypatch.setattr(load.cuda, "ensure_cuda", fake_ensure)
    monkeypatch.setattr(load.cuda, "add_dll_directory", lambda p: calls.append("dll"))
    monkeypatch.setattr(stt, "detect_hardware", lambda cuda_dir=None: next(hw))
    monkeypatch.setattr(load.silero, "load", lambda path: made.vad)
    monkeypatch.setattr(load.smart_turn, "load", lambda path: made.turn)
    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, lambda *a: made.stt, None))
    monkeypatch.setitem(engines.ENGINES, "faster-whisper", Engine(False, None, lambda *a: made.stt))
    await load.ears_loader(tmp_path)(lambda f: None)
    return calls


async def test_loader_fetches_when_a_card_lacks_the_libraries(monkeypatch, tmp_path):
    h = stt.Hardware
    calls = await _run_loader(
        monkeypatch, tmp_path, [h(gpu=False, card=True), h(gpu=True, card=True)], True
    )
    assert calls == ["dll", "ensure", "dll"]


async def test_loader_never_fetches_without_a_card(monkeypatch, tmp_path):
    calls = await _run_loader(monkeypatch, tmp_path, [stt.Hardware(gpu=False, card=False)], True)
    assert "ensure" not in calls


async def test_loader_never_fetches_when_the_libraries_are_there(monkeypatch, tmp_path):
    calls = await _run_loader(monkeypatch, tmp_path, [stt.Hardware(gpu=True, card=True)], True)
    assert "ensure" not in calls


async def test_loader_carries_on_on_the_processor_when_the_fetch_fails(monkeypatch, tmp_path):
    calls = await _run_loader(monkeypatch, tmp_path, [stt.Hardware(gpu=False, card=True)], False)
    assert calls.count("ensure") == 1  # no second detect, no crash
