"""Checks env-var config parsing and the persistent session id.

The session id must survive a restart (same file, same value) and be created on first use,
so every body sees one session across brain restarts.
"""

import os
from pathlib import Path

import pytest

from brain.config import load_config, load_env_file, session_id, split_command, upsert_env_value


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


def test_expert_defaults():
    cfg = load_config({})
    assert (cfg.expert_cmd, cfg.expert_timeout) == (["claude-agent-acp"], 1800.0)


def test_expert_overrides_split_the_command_like_a_shell():
    cfg = load_config(
        {
            "TAGALONG_EXPERT_CMD": 'node "/opt/my agent/index.js" --x',
            "TAGALONG_EXPERT_TIMEOUT_S": "60",
        }
    )
    assert cfg.expert_cmd == ["node", "/opt/my agent/index.js", "--x"]
    assert cfg.expert_timeout == 60.0


@pytest.mark.parametrize("value", ["abc", "0", "-5", "nan"])
def test_bad_expert_timeout_raises(value):
    with pytest.raises(ValueError):
        load_config({"TAGALONG_EXPERT_TIMEOUT_S": value})


def test_turn_timeout_defaults_to_300():
    assert load_config({}).turn_timeout == 300.0


def test_turn_timeout_from_env():
    assert load_config({"TAGALONG_TURN_TIMEOUT_S": "45"}).turn_timeout == 45.0


@pytest.mark.parametrize("value", ["0", "-5", "nan", "inf", "abc"])
def test_turn_timeout_rejects_zero_negative_nan_and_text(value):
    with pytest.raises(ValueError, match="TAGALONG_TURN_TIMEOUT_S"):
        load_config({"TAGALONG_TURN_TIMEOUT_S": value})


def test_split_command_keeps_backslashes_in_a_windows_path():
    path = r"C:\Users\x\AppData\Roaming\npm\claude-agent-acp.cmd"
    assert split_command(path, posix=False) == [path]


def test_split_command_strips_quotes_around_a_windows_path_with_spaces():
    cmd = r'"C:\Program Files\nodejs\agent.cmd" --x'
    assert split_command(cmd, posix=False) == [r"C:\Program Files\nodejs\agent.cmd", "--x"]


def test_split_command_posix_still_honours_quotes():
    assert split_command('node "/opt/my agent/index.js"', posix=True) == [
        "node",
        "/opt/my agent/index.js",
    ]


def test_wakes_per_hour_default_and_override():
    assert load_config({}).wakes_per_hour == 12
    assert load_config({"TAGALONG_WAKES_PER_HOUR": "4"}).wakes_per_hour == 4


@pytest.mark.parametrize("value", ["0", "x"])
def test_wakes_per_hour_must_be_at_least_one(value):
    with pytest.raises(ValueError, match="TAGALONG_WAKES_PER_HOUR"):
        load_config({"TAGALONG_WAKES_PER_HOUR": value})


@pytest.mark.parametrize(
    ("name", "attr", "default"),
    [
        ("TAGALONG_OFFER_MIN_APPROVALS", "offer_min_approvals", 3),
        ("TAGALONG_OFFER_WINDOW_DAYS", "offer_window_days", 14),
        ("TAGALONG_KEEP_ASKING_DAYS", "keep_asking_days", 7),
    ],
)
def test_offer_settings_default_and_override(name, attr, default):
    assert getattr(load_config({}), attr) == default
    assert getattr(load_config({name: "2"}), attr) == 2


@pytest.mark.parametrize("value", ["0", "-1", "x"])
@pytest.mark.parametrize(
    "name",
    ["TAGALONG_OFFER_MIN_APPROVALS", "TAGALONG_OFFER_WINDOW_DAYS", "TAGALONG_KEEP_ASKING_DAYS"],
)
def test_offer_settings_must_be_positive_integers(name, value):
    with pytest.raises(ValueError, match=name):
        load_config({name: value})


def test_upsert_creates_folder_and_file(tmp_path):
    env = {}
    folder = tmp_path / "new" / "home"
    upsert_env_value(folder, "A_KEY", "v1", env)
    assert (folder / ".env").read_text() == "A_KEY=v1\n"
    assert env == {"A_KEY": "v1"}


def test_upsert_replaces_existing_line_keeps_comments_and_others(tmp_path):
    path = tmp_path / ".env"
    path.write_bytes(b"# note\r\nOTHER=1\r\nA_KEY=old\r\nLAST=z\r\n")
    upsert_env_value(tmp_path, "A_KEY", "new", {})
    assert path.read_bytes() == b"# note\r\nOTHER=1\r\nA_KEY=new\r\nLAST=z\r\n"


def test_upsert_appends_with_the_files_line_ending(tmp_path):
    path = tmp_path / ".env"
    path.write_bytes(b"OTHER=1\r\n")
    upsert_env_value(tmp_path, "A_KEY", "v", {})
    assert path.read_bytes() == b"OTHER=1\r\nA_KEY=v\r\n"
    path.write_bytes(b"OTHER=1")  # no final newline
    upsert_env_value(tmp_path, "A_KEY", "v", {})
    assert path.read_bytes() == b"OTHER=1\nA_KEY=v\n"


def test_upsert_leaves_no_temp_file(tmp_path):
    upsert_env_value(tmp_path, "A_KEY", "v", {})
    assert [p.name for p in tmp_path.iterdir()] == [".env"]


def test_upsert_failure_does_not_set_env(tmp_path, monkeypatch):
    def broken(*args):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", broken)
    env = {}
    with pytest.raises(OSError):
        upsert_env_value(tmp_path, "A_KEY", "v", env)
    assert env == {}
    assert not (tmp_path / ".env.tmp").exists()


def test_upsert_value_with_equals_sign_round_trips_through_load_env_file(tmp_path):
    upsert_env_value(tmp_path, "A_KEY", "abc=def==", {})
    env = {}
    load_env_file(tmp_path, env)
    assert env["A_KEY"] == "abc=def=="
