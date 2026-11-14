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
    # cuDNN is the one ctranslate2 4.9 ships (its dispatcher loads sub-libraries by name).
    assert "cudnn_cu12-9.10.2.21-" in got[1].path and "cublas_cu12-12.8." in got[0].path
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
    monkeypatch.setenv("PATH", "C:/a")  # the call edits PATH; the test must not leak that
    monkeypatch.setattr(cuda.os, "add_dll_directory", lambda p: seen.append(p), raising=False)
    cuda.add_dll_directory(tmp_path / "cuda")
    assert seen == []  # nothing there yet
    (tmp_path / "cuda").mkdir()
    cuda.add_dll_directory(tmp_path / "cuda")
    assert seen == [str(tmp_path / "cuda")]


def test_add_dll_directory_puts_the_folder_first_on_path(monkeypatch, tmp_path, windows):
    # LoadLibrary (cuBLAS, the cuDNN sub-libraries) ignores add_dll_directory but reads PATH.
    monkeypatch.setattr(cuda.os, "add_dll_directory", lambda p: None, raising=False)
    (tmp_path / "cuda").mkdir()
    env = {"PATH": "C:/a" + cuda.os.pathsep + "C:/b"}
    cuda.add_dll_directory(tmp_path / "cuda", env)
    cuda.add_dll_directory(tmp_path / "cuda", env)  # again: still once
    assert env["PATH"].split(cuda.os.pathsep) == [str(tmp_path / "cuda"), "C:/a", "C:/b"]


def test_detect_hardware_and_load_final_prepare_the_path(monkeypatch, tmp_path):
    from pathlib import Path

    from brain.voice.engines import faster_whisper

    seen = []
    monkeypatch.setattr(cuda, "add_dll_directory", lambda p, env=None: seen.append(p))
    _fake_ct2(monkeypatch, 0)
    stt.detect_hardware(tmp_path / "cuda")
    row = stt.model_by_id("whisper-small-en")
    faster_whisper.load_final(row, tmp_path, whisper=lambda *a, **k: object(), gpu=False)
    assert seen == [tmp_path / "cuda", tmp_path / "cuda"] and isinstance(seen[0], Path)


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


async def test_each_wheel_is_extracted_and_deleted_before_the_next_is_fetched(
    monkeypatch, tmp_path, windows
):
    listed = rows(("cuda/wheels/a.whl", GOOD), ("cuda/wheels/b.whl", DNN))
    monkeypatch.setattr(cuda, "load_wheels", lambda: listed)
    on_disk = []
    inner = fetcher({listed[0].url: GOOD, listed[1].url: DNN})

    async def net(url):
        on_disk.append(sorted(p.name for p in (tmp_path / "cuda" / "wheels").glob("*.whl")))
        async for chunk in inner(url):
            yield chunk

    assert await cuda.ensure_cuda(tmp_path, net, lambda f: None) is True
    assert on_disk == [[], []]  # the first wheel was gone when the second was fetched


async def test_a_failed_fetch_is_not_retried_inside_24_hours(monkeypatch, tmp_path, windows):
    monkeypatch.setattr(cuda, "load_wheels", lambda: rows(("cuda/wheels/a.whl", GOOD)))
    tries = []

    async def offline(url):
        tries.append(url)
        raise OSError("offline")
        yield b""

    clock = [1000.0]
    monkeypatch.setattr(cuda.time, "time", lambda: clock[0])
    assert await cuda.ensure_cuda(tmp_path, offline, lambda f: None) is False
    clock[0] += 23 * 3600
    assert await cuda.ensure_cuda(tmp_path, offline, lambda f: None) is False
    assert len(tries) == 1
    clock[0] += 2 * 3600
    assert await cuda.ensure_cuda(tmp_path, offline, lambda f: None) is False
    assert len(tries) == 2


async def test_an_extracted_wheel_stays_extracted_when_the_next_download_fails(
    monkeypatch, tmp_path, windows
):
    listed = rows(("cuda/wheels/a.whl", GOOD), ("cuda/wheels/b.whl", DNN))
    monkeypatch.setattr(cuda, "load_wheels", lambda: listed)

    async def net(url):
        if url == listed[1].url:
            raise OSError("offline")
        yield GOOD

    assert await cuda.ensure_cuda(tmp_path, net, lambda f: None) is False
    assert (tmp_path / "cuda" / "cublas64_12.dll").is_file()


def test_probe_runs_once_per_set_of_wheels(monkeypatch, tmp_path):
    monkeypatch.setattr(cuda, "load_wheels", lambda: rows(("cuda/wheels/a.whl", GOOD)))
    runs = []

    def run(cmd, **kw):
        runs.append((cmd, kw))
        return types.SimpleNamespace(returncode=0)

    assert cuda.probe_cuda(tmp_path, "model-dir", run) is True
    assert cuda.probe_cuda(tmp_path, "model-dir", run) is True
    assert len(runs) == 1 and runs[0][1]["timeout"] > 0
    assert runs[0][0][1] == "-c" and "model-dir" in runs[0][0]
    monkeypatch.setattr(cuda, "load_wheels", lambda: rows(("cuda/wheels/c.whl", DNN)))
    cuda.probe_cuda(tmp_path, "model-dir", run)
    assert len(runs) == 2  # other wheels, other key


def test_a_probe_that_dies_or_times_out_is_false(monkeypatch, tmp_path):
    monkeypatch.setattr(cuda, "load_wheels", lambda: rows(("cuda/wheels/a.whl", GOOD)))

    def crash(cmd, **kw):
        return types.SimpleNamespace(returncode=-1073740791)

    assert cuda.probe_cuda(tmp_path, "m", crash) is False

    def hang(cmd, **kw):
        raise cuda.subprocess.TimeoutExpired(cmd, 1)

    assert cuda.probe_cuda(tmp_path / "x", "m", hang) is False


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


async def test_the_fetch_takes_half_the_bar_and_the_rest_is_scaled(monkeypatch, tmp_path):
    from fake_voice import parts

    from brain.voice import engines, load
    from brain.voice.engines import Engine

    made = parts()
    seen: list[float] = []

    async def files(folder, files, fetch, on_progress):
        on_progress(1.0)

    async def fake_ensure(folder, fetch, on_progress):
        on_progress(0.5)
        on_progress(1.0)
        return True

    hw = iter([stt.Hardware(gpu=False, card=True), stt.Hardware(gpu=True, card=True)])
    monkeypatch.setattr(load, "ensure_files", files)
    monkeypatch.setattr(load.cuda, "ensure_cuda", fake_ensure)
    monkeypatch.setattr(load.cuda, "add_dll_directory", lambda p: None)
    monkeypatch.setattr(stt, "detect_hardware", lambda cuda_dir=None: next(hw))
    monkeypatch.setattr(load.silero, "load", lambda path: made.vad)
    monkeypatch.setattr(load.smart_turn, "load", lambda path: made.turn)
    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, lambda *a: made.stt, None))
    monkeypatch.setitem(engines.ENGINES, "faster-whisper", Engine(False, None, lambda *a: made.stt))
    await load.ears_loader(tmp_path)(seen.append)
    assert seen[:2] == [0.25, 0.5]  # the fetch: 0 to 0.5
    assert min(seen[2:]) >= 0.5 and seen[-1] == 1.0


async def _final_cpu_ok(monkeypatch, tmp_path, env_final):
    from fake_voice import parts

    from brain.voice import engines, load
    from brain.voice.engines import Engine

    made = parts()
    got = []

    async def files(folder, files, fetch, on_progress):
        on_progress(1.0)

    def final(model, folder, progress, cpu_ok):
        got.append(cpu_ok)
        return made.stt

    monkeypatch.setattr(load, "ensure_files", files)
    monkeypatch.setattr(load.cuda, "add_dll_directory", lambda p: None)
    monkeypatch.setattr(stt, "detect_hardware", lambda cuda_dir=None: stt.Hardware(True, True))
    monkeypatch.setattr(load.silero, "load", lambda path: made.vad)
    monkeypatch.setattr(load.smart_turn, "load", lambda path: made.turn)
    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, lambda *a: made.stt, None))
    monkeypatch.setitem(engines.ENGINES, "faster-whisper", Engine(False, None, final))
    await load.ears_loader(tmp_path, env_final=env_final)(lambda f: None)
    return got


async def test_auto_turbo_is_for_the_card_only_but_a_chosen_model_may_use_the_processor(
    monkeypatch, tmp_path
):
    assert await _final_cpu_ok(monkeypatch, tmp_path, None) == [False]  # Auto picked turbo
    assert await _final_cpu_ok(monkeypatch, tmp_path, "whisper-large-v3-turbo") == [True]
    assert await _final_cpu_ok(monkeypatch, tmp_path, "whisper-small-en") == [True]
