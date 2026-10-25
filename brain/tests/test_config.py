"""Checks env-var config parsing and the persistent session id.

The session id must survive a restart (same file, same value) and be created on first use,
so every body sees one session across brain restarts.
"""

from pathlib import Path

import pytest

from brain.config import load_config, load_env_file, session_id


def test_defaults():
    cfg = load_config({})
    assert cfg.host == "127.0.0.1"
    assert cfg.port == 47321
    assert cfg.data_dir == Path.home() / ".tagalong"


def test_addr_override():
    cfg = load_config({"TAGALONG_BRAIN_ADDR": "0.0.0.0:5000"})
    assert (cfg.host, cfg.port) == ("0.0.0.0", 5000)


@pytest.mark.parametrize("addr", ["localhost:abc", "localhost:70000"])
def test_bad_port_raises(addr):
    with pytest.raises(ValueError):
        load_config({"TAGALONG_BRAIN_ADDR": addr})


def test_home_override(tmp_path):
    assert load_config({"TAGALONG_HOME": str(tmp_path)}).data_dir == tmp_path


def test_session_id_created_once(tmp_path):
    folder = tmp_path / "x"
    first = session_id(folder)
    assert len(first) == 32 and int(first, 16) >= 0
    assert session_id(folder) == first


def test_session_id_blank_file_replaced(tmp_path):
    (tmp_path / "session").write_text("  \n")
    new = session_id(tmp_path)
    assert len(new) == 32
    assert (tmp_path / "session").read_text().strip() == new


def test_model_budget_step_defaults():
    cfg = load_config({})
    assert (cfg.model, cfg.daily_budget_usd, cfg.step_cap) == ("claude-opus-5-5", 5.0, 25)


def test_model_budget_step_overrides():
    cfg = load_config(
        {
            "TAGALONG_MODEL": "claude-sonnet-5-5",
            "TAGALONG_DAILY_BUDGET_USD": "1.5",
            "TAGALONG_STEP_CAP": "3",
        }
    )
    assert (cfg.model, cfg.daily_budget_usd, cfg.step_cap) == ("claude-sonnet-5-5", 1.5, 3)


@pytest.mark.parametrize(
    "key,value",
    [
        ("TAGALONG_DAILY_BUDGET_USD", "abc"),
        ("TAGALONG_DAILY_BUDGET_USD", "0"),
        ("TAGALONG_DAILY_BUDGET_USD", "-1"),
        ("TAGALONG_DAILY_BUDGET_USD", "nan"),
        ("TAGALONG_STEP_CAP", "abc"),
        ("TAGALONG_STEP_CAP", "0"),
        ("TAGALONG_STEP_CAP", "2.5"),
    ],
)
def test_bad_budget_or_step_cap_raises(key, value):
    with pytest.raises(ValueError):
        load_config({key: value})


def test_load_env_file_sets_missing_keys_only(tmp_path):
    (tmp_path / ".env").write_text(
        "# comment\n\nANTHROPIC_API_KEY=\"sk-file\"\nOTHER='x y'\nKEEP=file\nBARE=1\n"
    )
    env = {"KEEP": "env"}
    assert load_env_file(tmp_path, env) is None
    assert env == {"KEEP": "env", "ANTHROPIC_API_KEY": "sk-file", "OTHER": "x y", "BARE": "1"}


def test_load_env_file_missing_is_fine(tmp_path):
    env = {}
    load_env_file(tmp_path, env)
    assert env == {}
