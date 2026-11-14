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


async def test_a_card_only_final_model_is_never_fetched_or_run_without_a_card(
    monkeypatch, tmp_path
):
    made = parts()
    downloads: list[str] = []
    _stubs(monkeypatch, made, downloads)  # detect_hardware says: no card
    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, lambda m, f, p: made.stt, None))
    ran: list[str] = []
    monkeypatch.setitem(
        engines.ENGINES, "faster-whisper", Engine(False, None, lambda *a: ran.append("x"))
    )
    got = await load.ears_loader(tmp_path, saved=lambda: (None, "whisper-large-v3-turbo"))(
        lambda f: None
    )
    assert got.final is None and not ran
    assert not any(d.startswith("stt/whisper-large-v3-turbo/") for d in downloads)


async def test_a_chosen_card_only_model_never_may_use_the_processor(monkeypatch, tmp_path):
    made = parts()
    _stubs(monkeypatch, made, [])
    monkeypatch.setattr(stt, "detect_hardware", lambda *a: stt.Hardware(gpu=True))
    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, lambda m, f, p: made.stt, None))
    seen: list[bool] = []

    def final_load(model, folder, on_progress, cpu_ok):
        seen.append(cpu_ok)
        return FakeFinal()

    monkeypatch.setitem(engines.ENGINES, "faster-whisper", Engine(False, None, final_load))
    await load.ears_loader(tmp_path, saved=lambda: (None, "whisper-large-v3-turbo"))(lambda f: None)
    assert seen == [False]


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


async def test_a_saved_choice_beats_the_env_default(monkeypatch, tmp_path):
    made = parts()
    names: list[str] = []
    _stubs(monkeypatch, made, [])

    def fake_load(model, folder, on_progress):
        names.append(model.id)
        return made.stt

    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, fake_load, None))
    loader = load.ears_loader(
        tmp_path, "moonshine-small", "whisper-small-en", saved=lambda: ("moonshine-tiny", "off")
    )
    got = await loader(lambda f: None)
    assert names == ["moonshine-tiny"] and got.final is None


async def test_tts_loader_reports_the_download_through_the_progress_callback(tmp_path, monkeypatch):
    async def fake_ensure(folder, files, fetch, on_progress):
        on_progress(0.25)
        on_progress(1.0)

    monkeypatch.setattr(load, "ensure_files", fake_ensure)
    monkeypatch.setattr(load.kokoro, "load", lambda folder: "tts")
    seen: list[float] = []
    assert await load.tts_loader(tmp_path)(seen.append) == "tts"
    assert seen[:2] == [0.25, 1.0]


async def test_the_fetcher_downloads_the_ears_files_and_loads_no_model(monkeypatch, tmp_path):
    downloads: list[str] = []
    _stubs(monkeypatch, parts(), downloads)

    def never(*a, **k):
        raise AssertionError("a model was loaded")

    monkeypatch.setattr(load.silero, "load", never)
    monkeypatch.setattr(load.smart_turn, "load", never)
    monkeypatch.setitem(engines.ENGINES, "moonshine", Engine(True, never, None))
    monkeypatch.setitem(engines.ENGINES, "faster-whisper", Engine(False, None, never))
    await load.ears_fetcher(tmp_path, env_final="whisper-small-en")()
    assert [f.path for f in load.EARS_FILES] == downloads[: len(load.EARS_FILES)]
    assert any(d.startswith("stt/whisper-small-en/") for d in downloads)
