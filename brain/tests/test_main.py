"""Checks main refuses to start without an API key, and opens the memory db under the data dir."""

import asyncio
import os

import pytest

from brain import main
from brain.main import _run


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


def test_memory_open_failure_exits(monkeypatch, tmp_path):
    def broken(path):
        raise RuntimeError("no FTS5")

    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr(main, "Memory", broken)
    with pytest.raises(SystemExit) as exit_info:
        asyncio.run(_run())
    assert exit_info.value.code == 1
