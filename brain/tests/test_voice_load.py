"""Tests for the real loader's glue, on fakes: thread-safe progress and the download timeout."""

import asyncio
import threading

import pytest
from fake_voice import parts

from brain.voice import load
from brain.voice.service import _why


async def test_moonshine_progress_is_delivered_on_the_event_loop(monkeypatch, tmp_path):
    made = parts()

    async def no_download(folder, files, fetch, on_progress):
        return None

    def moonshine_load(folder, on_progress):
        on_progress(0.5)  # Moonshine reports from the worker thread it loads in
        return made.stt

    monkeypatch.setattr(load, "ensure_files", no_download)
    monkeypatch.setattr(load.silero, "load", lambda path: made.vad)
    monkeypatch.setattr(load.smart_turn, "load", lambda path: made.turn)
    monkeypatch.setattr(load.moonshine, "load", moonshine_load)
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
