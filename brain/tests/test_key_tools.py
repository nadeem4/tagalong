"""Checks the first-run Home tools: key_status, set_api_key, set_daily_limit, expert_status.

Fakes only: the key check is a stub and no Anthropic call is made. The fake key must never
appear in a reply, an error or a log record.
"""

import asyncio
import datetime
import json
import logging
import os

import httpx2 as httpx
import pytest
from anthropic import AuthenticationError

from brain import tools
from brain.guardrails import Budget
from brain.protocol import ErrorCode, RpcError
from brain.tools import KeySettings, anthropic_check, home_tools

KEY = "sk-ant-example-not-a-real-key"


class FakeModel:
    def __init__(self):
        self.ready = False
        self.key = None

    def set_key(self, key):
        self.ready = True
        self.key = key


class Rig:
    def __init__(self, tmp_path, source="none", status="ok"):
        self.sent = []
        self.model = FakeModel()
        self.checked = []
        self.running = 0
        self.max_running = 0
        self.status = status
        self.cleared = 0
        self.budget = Budget(tmp_path / "b.json", 5.0, today=lambda: datetime.date(2026, 10, 31))
        self.keys = KeySettings(
            tmp_path,
            self.model,
            lambda m, p: self.sent.append((m, p)),
            source,
            self.check,
            ["claude-agent-acp"],
            on_key=lambda: setattr(self, "cleared", self.cleared + 1),
        )
        handlers = {s.name: h for s, h in home_tools(self.budget, lambda: None, self.keys)}
        self.run = lambda name, args=None: handlers[name](args if args is not None else {})
        self.specs = {s.name: s for s, _ in home_tools(self.budget, lambda: None, self.keys)}

    async def check(self, key):
        self.checked.append(key)
        self.running += 1
        self.max_running = max(self.max_running, self.running)
        await asyncio.sleep(0.01)
        self.running -= 1
        return self.status


@pytest.fixture
def rig(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)  # restored at teardown
    monkeypatch.delenv("TAGALONG_DAILY_BUDGET_USD", raising=False)
    return Rig(tmp_path)


async def test_key_status_none_file_environment(tmp_path):
    for source in ("none", "file", "environment"):
        r = Rig(tmp_path, source)
        body = json.loads(await r.run("key_status"))
        assert body == {
            "has_key": False,
            "source": source,
            "env_path": str(tmp_path / ".env"),
            "daily_limit_usd": 5.0,
        }
    r.model.set_key(KEY)
    body = json.loads(await r.run("key_status"))
    assert body["has_key"] is True and KEY not in json.dumps(body)


async def test_four_tools_are_home_only(rig):
    assert set(rig.specs) == {"spend_today", "list_permissions", "set_permission"} | {
        "key_status",
        "set_api_key",
        "set_daily_limit",
        "expert_status",
    }
    for name in ("key_status", "set_api_key", "set_daily_limit", "expert_status"):
        assert rig.specs[name].audience == frozenset({"home"})


async def test_set_api_key_ok_saves_switches_masks_and_notifies(rig, tmp_path):
    reply = json.loads(await rig.run("set_api_key", {"key": KEY}))
    assert reply == {"status": "ok"}
    assert (tmp_path / ".env").read_text() == f"ANTHROPIC_API_KEY={KEY}\n"
    assert rig.model.ready and rig.model.key == KEY
    assert os.environ["ANTHROPIC_API_KEY"] == KEY
    assert rig.cleared == 1
    assert rig.sent == [("changed", {"what": "key"})]
    assert json.loads(await rig.run("key_status"))["source"] == "file"


@pytest.mark.parametrize("status", ["invalid", "unreachable"])
async def test_set_api_key_not_ok_saves_nothing(tmp_path, monkeypatch, status):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = Rig(tmp_path, status=status)
    reply = json.loads(await r.run("set_api_key", {"key": KEY}))
    assert reply == {"status": status}
    assert not (tmp_path / ".env").exists()
    assert r.sent == [] and not r.model.ready
    assert "ANTHROPIC_API_KEY" not in os.environ


async def test_set_api_key_trims_spaces_quotes_newline(rig, tmp_path):
    reply = json.loads(await rig.run("set_api_key", {"key": f'  "{KEY}"\n'}))
    assert reply == {"status": "ok"}
    assert rig.checked == [KEY]
    assert (tmp_path / ".env").read_text() == f"ANTHROPIC_API_KEY={KEY}\n"


@pytest.mark.parametrize(
    "args",
    [{}, {"key": 5}, {"key": ""}, {"key": "   "}, {"key": "x" * 400}, {"key": f"{KEY}\nEVIL=1"}],
)
async def test_set_api_key_bad_input_fixed_error(rig, tmp_path, args):
    with pytest.raises(RpcError) as err:
        await rig.run("set_api_key", args)
    assert err.value.code == ErrorCode.invalid_params
    assert str(err.value) == "set_api_key needs a key."
    assert rig.checked == [] and not (tmp_path / ".env").exists()


async def test_set_api_key_write_failure_is_tool_failed_and_not_kept(rig, monkeypatch):
    def broken(*args):
        raise OSError("read-only")

    monkeypatch.setattr(tools, "upsert_env_value", broken)
    with pytest.raises(RpcError) as err:
        await rig.run("set_api_key", {"key": KEY})
    assert err.value.code == ErrorCode.tool_failed
    assert KEY not in str(err.value)
    assert not rig.model.ready and rig.sent == []


async def test_set_api_key_serialises_concurrent_calls(rig, tmp_path):
    await asyncio.gather(
        rig.run("set_api_key", {"key": KEY}), rig.run("set_api_key", {"key": KEY + "2"})
    )
    assert rig.max_running == 1
    lines = (tmp_path / ".env").read_text().splitlines()
    assert lines == [f"ANTHROPIC_API_KEY={KEY}2"]


async def test_key_never_in_any_reply_or_log(tmp_path, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    seen = []
    for status in ("ok", "invalid", "unreachable"):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        r = Rig(tmp_path / status, status=status)
        seen.append(await r.run("set_api_key", {"key": KEY}))
        seen.append(await r.run("key_status"))
    r = Rig(tmp_path / "bad")
    for args in ({"key": 5}, {"key": "x" * 400}, {}):
        with pytest.raises(RpcError) as err:
            await r.run("set_api_key", args)
        seen.append(str(err.value))
    monkeypatch.setattr(tools, "upsert_env_value", lambda *a: (_ for _ in ()).throw(OSError("x")))
    with pytest.raises(RpcError) as err:
        await Rig(tmp_path / "ro").run("set_api_key", {"key": KEY})
    seen.append(str(err.value))
    assert KEY not in "".join(seen)
    assert KEY not in caplog.text
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


async def test_expert_status_found_and_not_found(rig, monkeypatch):
    monkeypatch.setattr(tools.shutil, "which", lambda cmd: "C:/bin/claude-agent-acp.cmd")
    assert json.loads(await rig.run("expert_status")) == {
        "found": True,
        "command": "claude-agent-acp",
    }
    monkeypatch.setattr(tools.shutil, "which", lambda cmd: None)
    assert json.loads(await rig.run("expert_status")) == {
        "found": False,
        "command": "claude-agent-acp",
    }


# --- set_daily_limit ---------------------------------------------------------------


async def test_set_daily_limit_saves_updates_and_notifies(rig, tmp_path):
    reply = json.loads(await rig.run("set_daily_limit", {"usd": 7.5}))
    assert reply == {"limit_usd": 7.5}
    assert rig.budget.limit == 7.5
    assert (tmp_path / ".env").read_text() == "TAGALONG_DAILY_BUDGET_USD=7.5\n"
    assert rig.sent == [("changed", {"what": "settings"})]


@pytest.mark.parametrize("usd", [0, -1, float("nan"), float("inf"), "5", True, None])
async def test_set_daily_limit_rejects_bad_values(rig, tmp_path, usd):
    with pytest.raises(RpcError) as err:
        await rig.run("set_daily_limit", {"usd": usd})
    assert err.value.code == ErrorCode.invalid_params
    assert not (tmp_path / ".env").exists() and rig.budget.limit == 5.0


async def test_spend_today_follows_new_limit(rig):
    await rig.run("set_daily_limit", {"usd": 12})
    assert json.loads(await rig.run("spend_today"))["limit_usd"] == 12.0


async def test_set_daily_limit_when_env_set_changes_running_brain_and_writes_file(
    rig, tmp_path, monkeypatch
):
    monkeypatch.setenv("TAGALONG_DAILY_BUDGET_USD", "3")
    await rig.run("set_daily_limit", {"usd": 9})
    assert rig.budget.limit == 9.0
    assert "TAGALONG_DAILY_BUDGET_USD=9.0" in (tmp_path / ".env").read_text()


# --- anthropic_check: the status mapping ------------------------------------------


def _client(error):
    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        class models:  # noqa: N801
            @staticmethod
            async def list(limit):
                if error is not None:
                    raise error

    return Client


async def test_anthropic_check_maps_outcomes(monkeypatch):
    request = httpx.Request("GET", "https://api.anthropic.com/v1/models")
    denied = AuthenticationError("no", response=httpx.Response(401, request=request), body=None)
    for error, expected in [
        (None, "ok"),
        (denied, "invalid"),
        (RuntimeError("down"), "unreachable"),
    ]:
        monkeypatch.setattr(tools, "AsyncAnthropic", _client(error))
        assert await anthropic_check(KEY) == expected
