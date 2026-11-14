"""Tests for the real loader's glue, on fakes: thread-safe progress and the download timeout."""

import asyncio
import json
import threading

import pytest
from fake_voice import FakeFinal, parts

from brain.voice import engines, load, stt
from brain.voice.engines import Engine
from brain.voice.service import _why


async def test_moonshine_progress_is_delivered_on_the_event_loop(monkeypatch, tmp_path):
    made = parts()

    async def no_download(folder, files, fetch, on_progress):
        return None

    def moonshine_load(model, folder, on_progress):
        on_progress(0.5)  # Moonshine reports from the worker thread it loads in
        return made.stt

    monkeypatch.setattr(load, "ensure_files", no_download)
    monkeypatch.setattr(stt, "detect_hardware", lambda *a: stt.Hardware(gpu=False))
    monkeypatch.setattr(load.silero, "load", lambda path: made.vad)
    monkeypatch.setattr(load.smart_turn, "load", lambda path: made.turn)
    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, moonshine_load, None))
    main = threading.get_ident()
    seen: list[tuple[float, int]] = []

    await load.ears_loader(tmp_path)(lambda f: seen.append((f, threading.get_ident())))
    await asyncio.sleep(0)  # a call_soon_threadsafe callback runs on the next loop turn

    assert seen and all(thread == main for _, thread in seen)


async def test_the_download_has_a_timeout_and_a_hang_reads_as_offline(monkeypatch):
    calls: dict = {}

    def hang(request, timeout=None):
        calls["timeout"] = timeout
        raise TimeoutError("timed out")

    monkeypatch.setattr(load.urllib.request, "urlopen", hang)
    with pytest.raises(TimeoutError) as caught:
        async for _ in load.fetch("https://example.test/x"):
            pass
    assert calls["timeout"] == 30
    assert "internet" in _why(caught.value).lower()


def _stubs(monkeypatch, made, downloads):
    async def record(folder, files, fetch, on_progress):
        downloads.extend(f.path for f in files)

    monkeypatch.setattr(load, "ensure_files", record)
    monkeypatch.setattr(stt, "detect_hardware", lambda *a: stt.Hardware(gpu=False))
    monkeypatch.setattr(load.silero, "load", lambda path: made.vad)
    monkeypatch.setattr(load.smart_turn, "load", lambda path: made.turn)


async def test_loader_uses_resolved_live_model(monkeypatch, tmp_path):
    made = parts()
    downloads: list[str] = []
    arches: list[str] = []
    _stubs(monkeypatch, made, downloads)

    def fake_load(model, folder, on_progress):
        arches.append(model.options["arch"])
        return made.stt

    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, fake_load, None))
    real = stt.load_models
    options = {m.id: m for m in real()}["moonshine-medium"].options
    file = {"url": "https://x.test/a", "path": "stt/own.bin", "bytes": 10, "sha256": "ab" * 32}
    row = {
        "id": "moonshine-medium", "label": "M", "role": "live", "engine": "moonshine",
        "files": [file], "size_mb": 1, "gpu": "none", "languages": ["en"], "note": "",
        "options": options,
    }  # fmt: skip
    monkeypatch.setattr(stt, "load_models", lambda text=None: real(json.dumps([row])))
    got = await load.ears_loader(tmp_path, env_live="moonshine-medium")(lambda f: None)

    assert arches == ["MEDIUM_STREAMING"] and got.stt is made.stt
    assert downloads == [*(f.path for f in load.EARS_FILES), "stt/own.bin"]


async def test_loader_default_is_the_measured_small(monkeypatch, tmp_path):
    made = parts()
    arches: list[str] = []
    _stubs(monkeypatch, made, [])

    def fake_load(model, folder, on_progress):
        arches.append(model.options["arch"])
        return made.stt

    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, fake_load, None))
    await load.ears_loader(tmp_path)(lambda f: None)
    assert arches == ["SMALL_STREAMING"]


def _final_row():
    row = stt.model_by_id("whisper-small-en")
    assert row is not None
    return row


async def test_loader_downloads_final_files_with_progress_share(monkeypatch, tmp_path):
    made = parts()
    final = FakeFinal()
    seen: list[float] = []
    downloads: list[str] = []
    _stubs(monkeypatch, made, [])

    async def record(folder, files, fetch, on_progress):
        downloads.extend(f.path for f in files)
        for f in (0.0, 0.5, 1.0):
            on_progress(f)

    monkeypatch.setattr(load, "ensure_files", record)

    def live_load(model, folder, on_progress):
        on_progress(0.5)
        return made.stt

    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, live_load, None))
    monkeypatch.setitem(
        engines.ENGINES, "faster-whisper", Engine(False, None, lambda m, f, p, c: final)
    )
    got = await load.ears_loader(tmp_path, env_final="whisper-small-en")(seen.append)
    await asyncio.sleep(0)

    assert got.final is final
    assert [f.path for f in _final_row().files] == [
        d for d in downloads if d.startswith("stt/whisper-small-en/")
    ]
    assert seen == sorted(seen) and seen[-1] <= 1.0  # monotonic, within the bar


async def test_no_final_model_means_no_final_pass(monkeypatch, tmp_path):
    made = parts()
    _stubs(monkeypatch, made, [])
    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, lambda m, f, p: made.stt, None))
    got = await load.ears_loader(tmp_path)(lambda f: None)
    assert got.final is None


async def test_a_final_model_that_cannot_load_leaves_the_live_text(monkeypatch, tmp_path):
    made = parts()
    _stubs(monkeypatch, made, [])
    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, lambda m, f, p: made.stt, None))

    def broken(model, folder, on_progress):
        raise RuntimeError("no weights")

    monkeypatch.setitem(engines.ENGINES, "faster-whisper", Engine(False, None, broken))
    got = await load.ears_loader(tmp_path, env_final="whisper-small-en")(lambda f: None)
    assert got.stt is made.stt and got.final is None


async def test_a_final_download_that_fails_leaves_the_live_text(monkeypatch, tmp_path):
    made = parts()
    _stubs(monkeypatch, made, [])
    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, lambda m, f, p: made.stt, None))

    async def offline(folder, files, fetch, on_progress):
        if any(f.path.startswith("stt/") for f in files):
            raise OSError("offline")

    monkeypatch.setattr(load, "ensure_files", offline)
    got = await load.ears_loader(tmp_path, env_final="whisper-small-en")(lambda f: None)
    assert got.stt is made.stt and got.final is None
