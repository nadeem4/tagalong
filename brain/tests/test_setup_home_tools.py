"""Checks the Home tools behind the Connections page and the tour, on fakes only.

A fake registry body, stub inner install tools and a stub ask: no network, no installs.
"""

import json
from pathlib import Path

import pytest

from brain.asks import ASK_TIMEOUT_S, Answer
from brain.events import Event
from brain.permission import Tier
from brain.protocol import ErrorCode, RpcError
from brain.setup import home_tools
from brain.setup import registry as registry_module
from brain.setup.facts import Machine
from brain.setup.home_tools import WHY_PER_REPLY, SetupProgress, home_setup_tools
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
        self,
        tmp_path: Path,
        installed=(),
        apps=(),
        offline=False,
        answer="allow",
        card=None,
        mcp=None,
        why=None,
        acp=None,
        fail_on=None,
    ):  # answer None: nobody online
        async def get(url: str) -> bytes:
            self.urls.append(url)
            if offline or (fail_on and fail_on in url):
                raise OSError("down")
            return (mcp or MCP) if "modelcontext" in url else (acp or ACP)

        self.urls: list[str] = []
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
            why or FakeWhy(),
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
    # An installed expert stays in the list so its row can say Added.
    assert [(e["id"], e["added"]) for e in out["browse_experts"]] == [
        ("claude-acp", True),
        ("codex-acp", False),
    ]
    assert out["browse_apps"] == []  # no search: only the curated lists, never a raw page
    assert out["stale"] is False and out["progress"] is None


async def test_overview_searches_the_app_registry_by_the_query(tmp_path):
    rig = Rig(tmp_path)
    await rig.call("setup_overview", {"query": " Gmail "})
    assert any("modelcontext" in u and u.endswith("&search=gmail") for u in rig.urls)
    rig = Rig(tmp_path / "plain")
    await rig.call("setup_overview")
    # No search: only the curated per-id lookups run, never the registry's raw first page.
    assert all("search=" in u for u in rig.urls if "modelcontext" in u)


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


async def test_a_card_refusal_token_is_answered_like_the_tool_s_own(tmp_path):
    # Home maps `{error: token}` to its own words; a raised one would show raw JSON in red.
    async def done(args):
        raise RpcError(ErrorCode.tool_failed, json.dumps({"error": "already_logged_in"}))

    rig = Rig(tmp_path, card=done)
    out = await rig.call("setup_expert", {"id": "claude-acp", "approved": False})
    assert out == {"error": "already_logged_in"} and rig.asked == [] and rig.ran == []


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
    assert (
        rig.tools["setup_expert"][0].tier is Tier.auto
        and rig.tools["setup_app"][0].tier is Tier.auto
    )


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
        FakeWhy(),
    )
    handler = {spec.name: h for spec, h in tools}["setup_expert"]
    with pytest.raises(RpcError):
        await handler({"id": "x", "approved": False})
    assert [r["outcome"] for r in rig.recorded] == ["timed_out"]


async def official_card(args):
    return {"id": args["id"], "official": True, "community": False}


async def community_card(args):
    return {"id": args["id"], "official": False, "community": True, "publisher": "bob"}


async def test_home_official_connect_skips_the_card(tmp_path):
    rig = Rig(tmp_path, card=official_card)
    await rig.call("setup_app", {"id": "com.acme/x", "approved": True})
    assert rig.asked == [] and rig.ran == [("install_app", {"id": "com.acme/x"})]


async def test_home_community_connect_without_confirm_still_asks(tmp_path):
    rig = Rig(tmp_path, card=community_card)
    await rig.call("setup_app", {"id": "io.github.bob/x", "approved": True})
    assert len(rig.asked) == 1 and rig.asked[0]["input"]["community"] is True
    assert rig.ran == [("install_app", {"id": "io.github.bob/x"})]  # the answer was allow


async def test_home_community_denied_check_card_installs_nothing(tmp_path):
    rig = Rig(tmp_path, card=community_card, answer="deny")
    out = await rig.call("setup_app", {"id": "io.github.bob/x", "approved": True})
    assert out["error"] == "denied" and rig.ran == []


async def test_home_community_connect_anyway_installs_without_second_card(tmp_path):
    rig = Rig(tmp_path, card=community_card)
    args = {"id": "io.github.bob/x", "approved": True, "community_ok": True}
    await rig.call("setup_app", args)
    assert rig.asked == [] and rig.ran == [("install_app", {"id": "io.github.bob/x"})]
    (row,) = rig.recorded
    assert (row["outcome"], row["decided_by"], row["tool"]) == ("approved", "person", "install_app")


def server(name, title="", description="", **body):
    return {
        "server": {
            "name": name,
            "title": title or name,
            "version": "1",
            "description": description,
            **body,
        }
    }


def remote(host="c.test", **extra):
    return {"remotes": [{"type": "streamable-http", "url": f"https://{host}/mcp", **extra}]}


SEARCH = json.dumps(
    {
        "servers": [
            server("io.github.amy/podcast-editor", "Podcast editor", "Edits audio.", **remote()),
            server("io.github.bob/notion-tools", "Notion tools", "Fast notes. More.", **remote()),
            server("com.notion/mcp", "Notion", "Official.", **remote("mcp.notion.test")),
            server("io.github.notion/mcp", "Notion", "Lookalike.", **remote()),
            server(
                "app.linear/linear",
                "Linear",
                "Issues.",
                **remote(headers=[{"name": "Authorization", "isRequired": True}]),
            ),
        ],
        "metadata": {"nextCursor": "page2"},
    }
).encode()


class FakeWhy:
    def __init__(self):
        self.asked: list[str] = []

    async def line(self, entry):
        self.asked.append(entry.id)
        return "why:" + entry.id


async def test_overview_groups_search_results_with_official_head(tmp_path):
    rig = Rig(tmp_path, mcp=SEARCH)
    out = await rig.call("setup_overview", {"query": "notion"})
    first = out["app_groups"][0]
    assert first["service"] == "notion" and first["official"]["id"] == "com.notion/mcp"
    assert first["official"]["official"] is True and "why" not in first["official"]
    others = {r["id"]: r for r in first["others"]}
    assert set(others) == {"io.github.bob/notion-tools", "io.github.notion/mcp"}
    assert others["io.github.bob/notion-tools"]["official"] is False
    assert others["io.github.bob/notion-tools"]["why"] == "why:io.github.bob/notion-tools"
    assert first["official"]["runs"] == "hosted" and first["official"]["host"] == "mcp.notion.test"
    flat = [r["id"] for g in out["app_groups"][:1] for r in g["others"]]
    assert "io.github.amy/podcast-editor" not in flat


async def test_overview_popular_only_without_query(tmp_path):
    rig = Rig(tmp_path, mcp=SEARCH)
    out = await rig.call("setup_overview")
    assert [r["id"] for r in out["popular"]] == ["com.notion/mcp"]
    assert all(r["official"] is True for r in out["popular"])
    assert (await rig.call("setup_overview", {"query": "notion"}))["popular"] == []


async def test_popular_drops_what_one_click_cannot_connect(tmp_path):
    # Linear is in the list but needs a header token here, so it is not one click.
    out = await Rig(tmp_path, mcp=SEARCH).call("setup_overview")
    assert "app.linear/linear" not in [r["id"] for r in out["popular_more"]]


async def test_overview_passes_cursor_and_returns_next_cursor(tmp_path):
    rig = Rig(tmp_path, mcp=SEARCH)
    out = await rig.call("setup_overview", {"query": "notion", "cursor": "page2"})
    assert out["next_cursor"] == "page2"
    assert any("cursor=page2" in u for u in rig.urls)


async def test_overview_caps_why_calls_per_reply(tmp_path):
    many = json.dumps(
        {
            "servers": [
                server(f"io.github.u{i}/notion-{i}", f"Notion {i}", f"Does {i}. More.", **remote())
                for i in range(20)
            ]
        }
    ).encode()
    why = FakeWhy()
    rig = Rig(tmp_path, mcp=many, why=why)
    out = await rig.call("setup_overview", {"query": "notion"})
    rows = [r for g in out["app_groups"] for r in g["others"]]
    assert len(rows) == 20 and len(why.asked) == WHY_PER_REPLY
    late = next(r for r in rows if r["id"] not in why.asked)
    assert late["why"].startswith("Does ") and not late["why"].startswith("why:")


async def test_overview_experts_are_tagged(tmp_path):
    rig = Rig(tmp_path, [expert(version="2.0.0"), expert("mine", "1", None, "custom")])
    out = await rig.call("setup_overview")
    assert [e["official"] for e in out["experts"]] == [True, False]
    assert [e["official"] for e in out["browse_experts"]] == [True, True]


async def test_overview_reports_registry_sources(tmp_path):
    out = await Rig(tmp_path).call("setup_overview")
    assert out["sources"] == {
        "apps": {"name": "MCP registry", "url": registry_module.MCP_BASE},
        "experts": {"name": "ACP registry", "url": registry_module.ACP_URL},
    }


async def test_overview_registry_unavailable_keeps_installed_lists(tmp_path):
    rig = Rig(tmp_path, apps=[{"id": "a1", "name": "N", "state": "off"}], offline=True)
    out = await rig.call("setup_overview", {"query": "notion"})
    assert out["app_groups"] == [] and out["popular"] == [] and out["stale"] is True
    assert out["apps"] == [{"id": "a1", "name": "N", "state": "off"}]
    assert out["next_cursor"] is None


CURATED = json.dumps(
    {
        "servers": [
            *[server(f"io.github.u{i}/tool-{i}", f"Tool {i}", "x", **remote()) for i in range(30)],
            server("com.notion/mcp", "Notion", "Official.", **remote("mcp.notion.test")),
            server("app.linear/linear", "Linear", "Issues.", **remote("mcp.linear.test")),
            server("com.atlassian/atlassian-mcp-server", "Atlassian", "Jira.", **remote()),
        ]
    }
).encode()


async def test_no_query_shows_only_the_curated_lists(tmp_path):
    out = await Rig(tmp_path, mcp=CURATED).call("setup_overview")
    assert [r["id"] for r in out["popular"]] == ["com.notion/mcp"]
    assert [r["id"] for r in out["popular_more"]] == [
        "app.linear/linear",
        "com.atlassian/atlassian-mcp-server",
    ]
    assert out["browse_apps"] == [] and out["app_groups"] == []
    assert "io.github.u" not in json.dumps(out)


async def test_popular_skips_one_failing_id_and_keeps_the_rest(tmp_path, monkeypatch):
    ids = ("com.notion/mcp", "app.linear/linear", "com.atlassian/atlassian-mcp-server")
    monkeypatch.setattr(home_tools, "POPULAR_APPS", ids)
    out = await Rig(tmp_path, mcp=CURATED, fail_on="search=linear").call("setup_overview")
    assert [r["id"] for r in out["popular"]] == [ids[0], ids[2]]


async def test_dropped_unverified_id_is_silent(tmp_path):
    only_notion = json.dumps(
        {"servers": [server("com.notion/mcp", "Notion", "Official.", **remote())]}
    ).encode()
    out = await Rig(tmp_path, mcp=only_notion).call("setup_overview")
    assert out["popular_more"] == [] and "error" not in out


async def test_experts_curated_order_and_flags(tmp_path):
    def agent(id):
        return {
            "id": id,
            "name": id,
            "version": "1",
            "description": "d",
            "license": "MIT",
            "distribution": {"npx": {"package": f"@x/{id}@1"}},
        }

    ids = ["zed-acp", "codex-acp", "other-acp", "gemini", "claude-acp"]
    acp = json.dumps({"agents": [agent(i) for i in ids]}).encode()
    out = await Rig(tmp_path, acp=acp).call("setup_overview")
    rows = out["browse_experts"]
    assert [r["id"] for r in rows] == [
        "claude-acp",
        "gemini",
        "codex-acp",
        "zed-acp",
        "other-acp",
    ]
    assert [r["recommended"] for r in rows] == [True, False, False, False, False]
    assert rows[0]["tested"] is True and rows[3]["tested"] is False
    assert out["show_more_from"] == 3


async def test_curated_apps_keep_installed_ones_marked_added(tmp_path):
    rig = Rig(tmp_path, mcp=CURATED, apps=[{"id": "a1", "name": "Notion", "state": "ready"}])
    out = await rig.call("setup_overview")
    assert [(r["id"], r["added"]) for r in out["popular"]] == [("com.notion/mcp", True)]
    assert [r["added"] for r in out["popular_more"]] == [False, False]


async def test_expert_rows_carry_licence_repo_and_account(tmp_path):
    def agent(id, **extra):
        return {
            "id": id,
            "name": id,
            "version": "1",
            "description": "d",
            "license": "Apache-2.0",
            "distribution": {"npx": {"package": f"@x/{id}@1"}},
            **extra,
        }

    acp = json.dumps(
        {"agents": [agent("claude-acp"), agent("zed-acp", repository="https://g.test/zed")]}
    ).encode()
    rows = (await Rig(tmp_path, acp=acp).call("setup_overview"))["browse_experts"]
    assert [r["account"] for r in rows] == [True, False]
    assert rows[1]["licence"] == "Apache-2.0" and rows[1]["repo"] == "https://g.test/zed"
    assert rows[0]["repo"] == ""
