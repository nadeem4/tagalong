"""Checks the Home tools behind the Connections page and the tour, on fakes only.

A fake registry body, stub inner install tools and a stub ask: no network, no installs.
"""

import json
from pathlib import Path

import pytest

from brain.asks import ASK_TIMEOUT_S, Answer
from brain.events import Event
from brain.protocol import ErrorCode, RpcError
from brain.setup.facts import Machine
from brain.setup.home_tools import SetupProgress, home_setup_tools
from brain.setup.registry import Registry
from brain.setup.store import InstalledExpert
from brain.toolbox import ToolSpec

ACP = json.dumps(
    {
        "agents": [
            {
                "id": "claude-acp",
                "name": "Claude Code",
                "version": "2.0.0",
                "description": "d",
                "license": "MIT",
                "distribution": {"npx": {"package": "@x/claude-acp@2.0.0"}},
            },
            {
                "id": "codex-acp",
                "name": "Codex",
                "version": "1.0.0",
                "description": "d",
                "license": "MIT",
                "distribution": {"npx": {"package": "@x/codex-acp@1.0.0"}},
            },
        ]
    }
).encode()
MCP = json.dumps(
    {
        "servers": [
            {
                "server": {
                    "name": "acme/cloud",
                    "title": "cloud",
                    "version": "1",
                    "remotes": [{"type": "streamable-http", "url": "https://c.test/mcp"}],
                }
            }
        ]
    }
).encode()


def expert(id="claude-acp", version="1.0.0", logged_in=True, source="registry"):
    return InstalledExpert(id, id, version, ["x"], source, logged_in)


class Rig:
    def __init__(
        self, tmp_path: Path, installed=(), apps=(), offline=False, answer="allow", card=None
    ):  # answer None: nobody online
        async def get(url: str) -> bytes:
            if offline:
                raise OSError("down")
            return MCP if "modelcontext" in url else ACP

        self.progress = SetupProgress(lambda event: None)
        self.asked: list[dict] = []
        self.recorded: list[dict] = []
        self.ran: list[tuple[str, dict]] = []

        async def ask(**kw):
            self.asked.append(kw)
            return Answer(answer)

        async def inspect():
            return Machine("windows", "x64", None, None, None, None, None)

        async def default_card(args):
            return {"id": args["id"], "node_download": "22.1"}

        def inner(name: str):
            async def run(args):
                self.ran.append((name, args))
                return json.dumps({"started": args["id"]})

            return ToolSpec(name, "d", {}, effect="change", card=card or default_card), run

        tools = home_setup_tools(
            Registry(tmp_path, get),
            inspect,
            lambda: list(installed),
            lambda: list(apps),
            ask,
            lambda **kw: self.recorded.append(kw),
            [inner("install_expert"), inner("login_expert"), inner("install_app")],
            self.progress,
        )
        self.tools = {spec.name: (spec, handler) for spec, handler in tools}

    async def call(self, name: str, args: dict | None = None) -> dict:
        return json.loads(await self.tools[name][1](args or {}))


async def test_overview_lists_installed_and_browsable_with_states(tmp_path):
    rig = Rig(tmp_path, [expert(version="2.0.0")], [{"id": "a1", "name": "N", "state": "off"}])
    out = await rig.call("setup_overview")
    assert [(e["id"], e["state"]) for e in out["experts"]] == [("claude-acp", "ready")]
    assert out["experts"][0]["tested"] is True
    assert out["apps"] == [{"id": "a1", "name": "N", "state": "off"}]
    assert [e["id"] for e in out["browse_experts"]] == ["codex-acp"]
    assert [a["id"] for a in out["browse_apps"]] == ["acme/cloud"]
    assert out["stale"] is False and out["progress"] is None


async def test_an_expert_not_logged_in_needs_login(tmp_path):
    rig = Rig(tmp_path, [expert(version="2.0.0", logged_in=False)])
    assert (await rig.call("setup_overview"))["experts"][0]["state"] == "needs_login"


async def test_needs_update_when_the_registry_version_is_newer(tmp_path):
    rig = Rig(tmp_path, [expert(version="1.0.0")])
    assert (await rig.call("setup_overview"))["experts"][0]["state"] == "needs_update"


async def test_the_custom_expert_is_ready_and_never_updated(tmp_path):
    rig = Rig(tmp_path, [expert("custom", "", None, "custom")])
    assert (await rig.call("setup_overview"))["experts"][0]["state"] == "ready"


async def test_overview_works_offline_with_no_cache_as_stale(tmp_path):
    rig = Rig(tmp_path, [expert(version="2.0.0")], offline=True)
    out = await rig.call("setup_overview")
    assert out["stale"] is True and out["browse_experts"] == [] and out["browse_apps"] == []
    assert out["experts"][0]["state"] == "ready"


async def test_approved_false_opens_the_card_with_empty_text_and_facts(tmp_path):
    rig = Rig(tmp_path)
    out = await rig.call("setup_expert", {"id": "claude-acp", "approved": False})
    (asked,) = rig.asked
    assert asked["text"] == "" and asked["tool"] == "install_expert"
    assert asked["input"] == {"id": "claude-acp", "node_download": "22.1"}
    assert out == {"started": "claude-acp"}


async def test_approved_true_skips_the_card(tmp_path):
    rig = Rig(tmp_path)
    await rig.call("setup_expert", {"id": "claude-acp", "approved": True})
    assert rig.asked == [] and rig.ran == [("install_expert", {"id": "claude-acp"})]


async def test_deny_leaves_nothing_installed(tmp_path):
    rig = Rig(tmp_path, answer="deny")
    out = await rig.call("setup_expert", {"id": "claude-acp", "approved": False})
    assert out["error"] == "denied" and rig.ran == []


async def test_an_installed_expert_that_needs_login_logs_in(tmp_path):
    rig = Rig(tmp_path, [expert(version="2.0.0", logged_in=False)])
    await rig.call("setup_expert", {"id": "claude-acp", "approved": True})
    assert rig.ran == [("login_expert", {"id": "claude-acp"})]


async def test_a_ready_expert_is_left_alone(tmp_path):
    rig = Rig(tmp_path, [expert(version="2.0.0")])
    out = await rig.call("setup_expert", {"id": "claude-acp", "approved": True})
    assert out["error"] == "already_ready" and rig.ran == []


async def test_setup_app_asks_with_install_app_and_runs_it(tmp_path):
    rig = Rig(tmp_path)
    await rig.call("setup_app", {"id": "acme/cloud", "approved": False})
    assert rig.asked[0]["tool"] == "install_app"
    assert rig.ran == [("install_app", {"id": "acme/cloud"})]


async def test_a_card_failure_is_a_tool_error_and_nothing_runs(tmp_path):
    async def bad(args):
        raise RpcError(ErrorCode.tool_failed, "no_build")

    rig = Rig(tmp_path, card=bad)
    with pytest.raises(RpcError):
        await rig.call("setup_expert", {"id": "claude-acp", "approved": False})
    assert rig.ran == []


async def test_progress_is_readable_and_ends_null(tmp_path):
    rig = Rig(tmp_path)
    rig.progress.emit(
        Event("setup_progress", {"expert": "claude-acp", "stage": "npm"}, "claude-acp")
    )
    assert (await rig.call("setup_overview"))["progress"] == {
        "expert": "claude-acp",
        "stage": "npm",
    }
    rig.progress.emit(Event("setup_done", {"expert": "claude-acp", "ok": True}, "claude-acp"))
    assert (await rig.call("setup_overview"))["progress"] is None


async def test_every_tool_is_home_only_and_setup_ones_ask_for_themselves(tmp_path):
    rig = Rig(tmp_path)
    for name in ("setup_overview", "setup_expert", "setup_app"):
        assert rig.tools[name][0].audience == frozenset({"home"})
    assert rig.tools["setup_overview"][0].effect == "read"
    assert rig.tools["setup_expert"][0].self_asks and rig.tools["setup_app"][0].self_asks


async def test_a_failed_install_is_reported_until_the_next_try(tmp_path):
    rig = Rig(tmp_path)
    done = {"expert": "claude-acp", "ok": False, "error": "npm_failed", "detail": "x"}
    rig.progress.emit(Event("setup_done", done, "claude-acp"))
    assert (await rig.call("setup_overview"))["failed"] == {
        "expert": "claude-acp",
        "error": "npm_failed",
    }
    rig.progress.emit(Event("setup_progress", {"expert": "claude-acp", "stage": "checking"}))
    assert (await rig.call("setup_overview"))["failed"] is None


async def test_the_card_waits_as_long_as_the_gates_ask(tmp_path):
    rig = Rig(tmp_path)
    await rig.call("setup_expert", {"id": "claude-acp", "approved": False})
    assert rig.asked[0]["timeout"] == ASK_TIMEOUT_S


async def test_setup_app_opens_the_card_even_when_approved_is_sent(tmp_path):
    rig = Rig(tmp_path)
    await rig.call("setup_app", {"id": "acme/cloud", "approved": True})
    assert len(rig.asked) == 1 and rig.ran == [("install_app", {"id": "acme/cloud"})]


async def test_an_answered_card_is_recorded_like_the_gate_does(tmp_path):
    rig = Rig(tmp_path)
    await rig.call("setup_expert", {"id": "claude-acp", "approved": False})
    (row,) = rig.recorded
    assert (row["tool"], row["outcome"], row["source"]) == (
        "install_expert",
        "approved",
        "scout_tool",
    )
    assert row["group_key"] == "install_expert" and row["input"]["id"] == "claude-acp"


async def test_a_denied_card_is_recorded_as_refused(tmp_path):
    rig = Rig(tmp_path, answer="deny")
    await rig.call("setup_expert", {"id": "claude-acp", "approved": False})
    assert [r["outcome"] for r in rig.recorded] == ["refused"]


async def test_a_card_nobody_answered_is_recorded_as_no_one(tmp_path):
    rig = Rig(tmp_path, answer=None)
    out = await rig.call("setup_expert", {"id": "claude-acp", "approved": False})
    assert out["error"] == "denied"
    assert [r["outcome"] for r in rig.recorded] == ["no_one"]


async def test_the_tours_own_press_records_nothing(tmp_path):
    rig = Rig(tmp_path)
    await rig.call("setup_expert", {"id": "claude-acp", "approved": True})
    assert rig.recorded == []


async def test_browse_apps_skips_apps_already_added(tmp_path):
    rig = Rig(tmp_path, apps=[{"id": "a1", "name": "cloud", "state": "ready"}])
    assert (await rig.call("setup_overview"))["browse_apps"] == []


async def test_a_card_that_times_out_is_recorded_and_raised(tmp_path):
    rig = Rig(tmp_path)

    async def slow(**kw):
        raise RpcError(ErrorCode.timeout, "nobody answered the ask in time")

    # swap the stub ask for one that times out
    tools = home_setup_tools(
        Registry(tmp_path, lambda url: None),
        lambda: None,
        lambda: [],
        lambda: [],
        slow,
        lambda **kw: rig.recorded.append(kw),
        [(ToolSpec("install_expert", "d", {}, effect="change"), lambda a: None)],
        rig.progress,
    )
    handler = {spec.name: h for spec, h in tools}["setup_expert"]
    with pytest.raises(RpcError):
        await handler({"id": "x", "approved": False})
    assert [r["outcome"] for r in rig.recorded] == ["timed_out"]
