"""Checks main refuses to start without an API key, before any network use."""

import asyncio

import pytest

from brain.main import _run


def test_missing_api_key_exits(monkeypatch, tmp_path):
    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(SystemExit) as exit_info:
        asyncio.run(_run())
    assert exit_info.value.code == 1
