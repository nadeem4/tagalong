"""Checks main refuses to start without an API key, and opens the memory db under the data dir."""

import asyncio
import io
import logging
import os
import sys

import pytest

from brain import main
from brain.main import _run
from brain.masking import Masker, SecretLogFilter
from brain.voice.service import VoiceService


def test_missing_api_key_exits(monkeypatch, tmp_path):
    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(SystemExit) as exit_info:
        asyncio.run(_run())
    assert exit_info.value.code == 1


def test_env_file_settings_are_read(monkeypatch, tmp_path):
    (tmp_path / ".env").write_text("TAGALONG_STEP_CAP=0\n")
    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.delenv("TAGALONG_STEP_CAP", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ValueError, match="TAGALONG_STEP_CAP"):
        asyncio.run(_run())
    # _run put it in os.environ; monkeypatch.delenv would restore it at teardown
    os.environ.pop("TAGALONG_STEP_CAP", None)


def test_main_opens_db_under_data_dir(monkeypatch, tmp_path):
    class Stop(Exception):
        pass

    async def stop(*args):
        raise Stop

    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr(main, "start_server", stop)
    with pytest.raises(Stop):
        asyncio.run(_run())
    assert (tmp_path / "tagalong.db").exists()


def test_main_sets_up_voice_without_loading_any_model(monkeypatch, tmp_path):
    class Stop(Exception):
        pass

    seen = {}

    async def stop(host, port, bodies, session_id, session):
        seen["voice"] = session.voice
        raise Stop

    for name in ("moonshine_voice", "onnxruntime"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr(main, "start_server", stop)
    with pytest.raises(Stop):
        asyncio.run(_run())
    assert isinstance(seen["voice"], VoiceService)
    assert "moonshine_voice" not in sys.modules and "onnxruntime" not in sys.modules


def test_memory_open_failure_exits(monkeypatch, tmp_path):
    def broken(path):
        raise RuntimeError("no FTS5")

    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr(main, "Memory", broken)
    with pytest.raises(SystemExit) as exit_info:
        asyncio.run(_run())
    assert exit_info.value.code == 1


def _logged(masker, *, fn):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(SecretLogFilter(masker))
    logger = logging.getLogger("test.masking")
    logger.addHandler(handler)
    try:
        fn(logger)
    finally:
        logger.removeHandler(handler)
    return stream.getvalue()


def test_log_lines_are_masked():
    key = "fake-api-key-0123456789"
    url = "https://x/y?token=abcdef123456"

    def emit(logger):
        try:
            raise RuntimeError(f"bad {key} at {url}")
        except RuntimeError:
            logger.error("call failed for %s with %s", url, key, exc_info=True)

    out = _logged(Masker(lambda: [key]), fn=emit)
    assert key not in out and "abcdef123456" not in out
    assert out.count("[secret]") >= 3
    assert "Traceback" in out and "call failed for https://x/y?token=[secret]" in out


def test_log_filter_withholds_when_the_masker_fails():
    def broken():
        raise RuntimeError("no")

    out = _logged(Masker(broken), fn=lambda logger: logger.error("secret %s", "abc"))
    assert "abc" not in out and "[withheld]" in out


def test_secret_values_are_reused_for_a_second():
    now = [0.0]
    reads = []
    cached = main.cached(lambda: reads.append(1) or ["v"], 1.0, lambda: now[0])
    assert cached() == ["v"] and cached() == ["v"]
    assert len(reads) == 1
    now[0] = 1.5
    cached()
    assert len(reads) == 2


def test_run_masks_the_root_log_handlers(monkeypatch, tmp_path):
    key = "fake-anthropic-key-0123456789"
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    root = logging.getLogger()
    root.addHandler(handler)
    before = {h: list(h.filters) for h in root.handlers}

    async def stop(*args):
        raise RuntimeError("stop")

    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", key)
    monkeypatch.setattr(main, "start_server", stop)
    try:
        with pytest.raises(RuntimeError):
            asyncio.run(_run())
        logging.getLogger("brain").error("key %s", key)
    finally:
        root.removeHandler(handler)
        for h, filters in before.items():  # keep the real key out of other tests' handlers
            h.filters[:] = filters
    assert key not in stream.getvalue() and "key [secret]" in stream.getvalue()


def test_memory_closed_on_shutdown(monkeypatch, tmp_path):
    closed = []
    real = main.Memory

    class Spy(real):
        def close(self):
            closed.append(True)
            super().close()

    async def stop(*args):
        raise RuntimeError("stop")

    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr(main, "Memory", Spy)
    monkeypatch.setattr(main, "start_server", stop)
    with pytest.raises(RuntimeError):
        asyncio.run(_run())
    assert closed == [True]
