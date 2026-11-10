"""Checks adding an app from an MCP Registry entry, on fakes only.

A fake registry body, a fake Apps and a stand-in for the private Node: no network, no npm, no
real MCP server. The Allow card goes through the real Toolbox so the gate itself is checked.
"""

import asyncio
import json
import os
from dataclasses import replace
from pathlib import Path

import pytest
from mcp.types import Tool

from brain.apps import AppError, AppStatus, TokenFile
from brain.bodies import Bodies
from brain.events import Event
from brain.memory import Memory
from brain.mind.turn import Call
from brain.permission import (
    Engine,
    Person,
    SideCheckDecider,
    StandingRule,
    Tier,
    resolve_mode,
    stored_auto_rules,
)
from brain.protocol import RpcError
from brain.setup import install as install_mod
from brain.setup.apps import app_params, app_setup_tools
from brain.setup.facts import Machine, NodePaths, ToolVersion, node_paths
from brain.setup.install import InstallError, NoBuild
from brain.setup.paths import node_dir
from brain.setup.registry import Distribution, Registry, RegistryEntry
from brain.toolbox import BrainSource
from brain.toolbox import Toolbox as RealToolbox

FIX = Path(__file__).parent / "fixtures"
NODE_INDEX = (FIX / "node-index.sample.json").read_bytes()


def server(name, **body) -> dict:
    return {"server": {"name": name, "title": name.split("/")[-1], "version": "1.2.3", **body}}


MCP = json.dumps(
    {
        "servers": [
            server(
                "acme/notes",
                packages=[
                    {
                        "registryType": "npm",
                        "identifier": "@acme/notes",
                        "version": "1.2.3",
                        "environmentVariables": [
                            {"name": "ACME_KEY", "isRequired": True, "isSecret": True},
                            {"name": "ACME_OPTIONAL"},
                        ],
                    }
                ],
            ),
            server(
                "acme/pytool",
                packages=[{"registryType": "pypi", "identifier": "pytool", "version": "0.4"}],
            ),
            server(
                "acme/cloud", remotes=[{"type": "streamable-http", "url": "https://c.test/mcp"}]
            ),
            server(
                "com.acme/hosted",
                remotes=[{"type": "streamable-http", "url": "https://h.acme.test/mcp"}],
            ),
            server(
                "io.github.bob/pkg",
                repository={"url": "https://github.com/bob/pkg", "source": "github"},
                packages=[
                    {
                        "registryType": "npm",
                        "identifier": "@bob/pkg",
                        "version": "2.0.0",
                        "environmentVariables": [{"name": "BOB_KEY", "isRequired": True}],
                    }
                ],
            ),
            server(
                "acme/keyed",
                remotes=[
                    {
                        "type": "streamable-http",
                        "url": "https://k.test/mcp",
                        "headers": [{"name": "Authorization", "isRequired": True}],
                    }
                ],
            ),
        ]
    }
).encode()


def machine(node: ToolVersion | None = None, private: ToolVersion | None = None) -> Machine:
    return Machine("windows", "x64", node, private, None, None, None)


def system_node(tmp_path: Path, version="22.5.0") -> ToolVersion:
    root = tmp_path / "sys"
    (root / "node_modules" / "npm" / "bin").mkdir(parents=True)
    (root / "node.exe").write_text("")
    (root / "node_modules" / "npm" / "bin" / "npm-cli.js").write_text("")
    return ToolVersion(version, str(root / "node.exe"))


async def entries(tmp_path) -> dict[str, RegistryEntry]:
    async def get(url: str) -> bytes:
        return MCP

    found = await Registry(tmp_path, get).mcp_servers(None)
    return {e.id: e for e in found.entries}


def dist(entry: RegistryEntry) -> Distribution:
    return entry.distributions[0]


# ---- app_params: an entry becomes validate_app params ----


async def test_npx_entry_becomes_stdio_with_an_absolute_node_path(tmp_path):
    e = (await entries(tmp_path))["acme/notes"]
    node = system_node(tmp_path)
    params = app_params(e, dist(e), machine(node), tmp_path)
    cfg = params["config"]
    assert (params["name"], params["transport"], params["auth"]) == ("notes", "stdio", "none")
    assert Path(cfg["command"]).is_absolute() and cfg["command"] == node.path
    assert cfg["args"][1:] == ["exec", "--yes", "--", "@acme/notes@1.2.3"]
    assert cfg["args"][0].endswith("npm-cli.js")


async def test_npx_entry_prefers_the_private_node_when_the_system_one_is_old(tmp_path):
    e = (await entries(tmp_path))["acme/notes"]
    root = node_dir(tmp_path)
    cli = root / "node_modules" / "npm" / "bin" / "npm-cli.js"
    cli.parent.mkdir(parents=True)
    (root / "node.exe").write_text("")
    cli.write_text("")
    mine = ToolVersion("22.12.0", str(root / "node.exe"))
    params = app_params(e, dist(e), machine(ToolVersion("18.0.0", "x"), mine), tmp_path)
    assert params["config"]["command"] == str(root / "node.exe")


async def test_npx_entry_with_no_usable_node_is_a_fact(tmp_path):
    e = (await entries(tmp_path))["acme/notes"]
    with pytest.raises(InstallError) as err:
        app_params(e, dist(e), machine(ToolVersion("18.0.0", "x")), tmp_path)
    assert err.value.kind == "node_missing"


async def test_node_stays_first_on_the_apps_path_without_editing_ours(tmp_path):
    e = (await entries(tmp_path))["acme/notes"]
    before = os.environ["PATH"]
    cfg = app_params(e, dist(e), machine(system_node(tmp_path)), tmp_path)["config"]
    assert cfg["env"]["PATH"] == str(tmp_path / "sys") + os.pathsep + "${PATH}"
    assert os.environ["PATH"] == before


async def test_uvx_entry_becomes_stdio_uvx_or_reports_uv_missing(tmp_path):
    e = (await entries(tmp_path))["acme/pytool"]
    params = app_params(e, dist(e), machine(), tmp_path, which=lambda n: f"/bin/{n}")
    assert params["config"]["command"] == "/bin/uvx"
    assert params["config"]["args"] == ["--", "pytool==0.4"]
    with pytest.raises(InstallError) as err:
        app_params(e, dist(e), machine(), tmp_path, which=lambda n: None)
    assert err.value.kind == "uv_missing"


async def test_remote_entry_becomes_http_with_oauth(tmp_path):
    e = (await entries(tmp_path))["acme/cloud"]
    params = app_params(e, dist(e), machine(), tmp_path)
    assert (params["transport"], params["auth"]) == ("http", "oauth")
    assert params["config"] == {"url": "https://c.test/mcp"}


async def test_remote_entry_that_needs_a_header_is_a_needs_token_fact(tmp_path):
    e = (await entries(tmp_path))["acme/keyed"]
    with pytest.raises(InstallError) as err:
        app_params(e, dist(e), machine(), tmp_path)
    assert (err.value.kind, err.value.detail) == ("needs_token", "Authorization")


async def test_required_env_becomes_var_refs_and_no_value_is_stored(tmp_path):
    e = (await entries(tmp_path))["acme/notes"]
    cfg = app_params(e, dist(e), machine(system_node(tmp_path)), tmp_path)["config"]
    assert cfg["env"]["ACME_KEY"] == "${ACME_KEY}"
    assert "ACME_OPTIONAL" not in cfg["env"]  # only what the entry requires


async def test_an_entry_with_no_build_here_is_the_no_build_fact(tmp_path):
    e = RegistryEntry("x", "X", "1", "", "", [])
    with pytest.raises(NoBuild):
        app_params(e, None, machine(), tmp_path)


# ---- the install_app tool ----


class FakeApps:
    def __init__(self):
        self.restarted: list[str] = []
        self.signed_in: list[str] = []
        self.state, self.error = "connected", ""
        self.tool_names = ["create_event", "list_events"]

    async def restart(self, app_id):
        self.restarted.append(app_id)

    async def sign_in(self, app_id, open_url):
        self.signed_in.append(app_id)
        self.state = "connecting"  # the person has to finish in the browser

    def status(self, app_id):
        return AppStatus(self.state, self.error)

    def ids(self):
        return list(self.restarted)

    def tools(self, app_id):
        return [Tool(name=n, inputSchema={"type": "object"}) for n in self.tool_names]


class StubAsks:
    def __init__(self, answer="allow"):
        self.answer, self.asked, self.locked = answer, [], None

    def anyone_online(self):
        return True

    async def permission(self, call, spec_name, locked, **ids):
        self.asked.append(call.input)
        self.locked = locked
        return self.answer


async def no_fetch(url):
    raise AssertionError("nothing should be fetched")
    yield b""


async def opens(url):
    pass


class Rig:
    def __init__(self, tmp_path, mach, env=None, browser=False):
        self.home = tmp_path
        self.memory = Memory(tmp_path / "t.db")
        self.apps = FakeApps()
        self.bodies = Bodies()
        self.machine = mach
        self.events: list[Event] = []

        async def get(url: str) -> bytes:
            return NODE_INDEX if url.endswith("index.json") else MCP

        async def inspect_fn():
            # what a real inspect sees once the private Node has been laid down
            if node_paths(tmp_path) is not None:
                return replace(self.machine, private_node=ToolVersion("22.12.0", "n"))
            return self.machine

        tools = app_setup_tools(
            tmp_path,
            Registry(tmp_path, get),
            inspect_fn,
            self.apps,
            self.memory,
            TokenFile(tmp_path),
            lambda m, p: None,
            self.bodies,
            no_fetch,
            get,
            env if env is not None else {},
            self.events.append,
            wait_s=0.0,
            opener=lambda app_id: opens if browser else None,
        )
        (((self.spec, self.handler),), self.stop_watches) = tools

    async def run(self, app_id="acme/notes"):
        return json.loads(await self.handler({"id": app_id}))


@pytest.fixture
def ensure(monkeypatch):
    calls = []

    async def fake(home, min_major, fetch, get_json, os_name, arch, on_progress):
        calls.append(min_major)
        root = node_dir(home)
        cli = root / "node_modules" / "npm" / "bin" / "npm-cli.js"
        cli.parent.mkdir(parents=True, exist_ok=True)
        (root / "node.exe").write_text("")
        cli.write_text("")
        return NodePaths(root / "node.exe", cli)

    monkeypatch.setattr(install_mod, "ensure_node", fake)
    return calls


@pytest.fixture
def rig(tmp_path):
    made = []

    def make(mach=None, **kw):
        made.append(Rig(tmp_path, mach or machine(system_node(tmp_path)), **kw))
        return made[-1]

    yield make
    for r in made:
        r.memory.close()


async def test_the_tool_is_locked_person_only_with_a_card(rig):
    spec = rig().spec
    assert spec.name == "install_app" and spec.effect == "change"
    assert spec.tier is Tier.person_only and spec.card is not None
    assert resolve_mode(spec, "auto") == "ask"


async def test_card_names_the_facts_and_the_node_download_when_needed(rig):
    r = rig(machine(ToolVersion("18.0.0", "x")))
    card = await r.spec.card({"id": "acme/notes"})
    assert card["app"] == "acme/notes" and card["transport"] == "stdio"
    assert card["package"] == "@acme/notes" and card["version"] == "1.2.3"
    assert card["env"] == ["ACME_KEY"]
    assert card["node_download"]["version"] == "v22.12.0"


async def test_card_for_a_remote_names_only_the_host(rig):
    card = await rig().spec.card({"id": "acme/cloud"})
    assert card["transport"] == "http" and card["host"] == "c.test"
    assert card["node_download"] is None and "url" not in card


async def test_card_refusals_are_facts_and_ask_nothing(rig):
    r = rig()
    with pytest.raises(RpcError, match="unknown_app"):
        await r.spec.card({"id": "nope/none"})
    with pytest.raises(RpcError, match="needs_token"):
        await r.spec.card({"id": "acme/keyed"})


def person_engine():
    return Engine([Person()], None, None, lambda n: None)


async def test_install_app_asks_first_and_adds_the_app(rig):
    r = rig(env={"ACME_KEY": "k"})
    asks = StubAsks()
    box = RealToolbox(
        [BrainSource([(r.spec, r.handler)])],
        lambda: {},
        lambda n, m: None,
        asks,
        engine=person_engine(),
    )
    out = await box.run(Call("c1", "install_app", {"id": "acme/notes"}, "t1", ""))
    assert asks.asked[0]["app"] == "acme/notes" and asks.locked
    assert json.loads(out)["status"] == "connected"
    assert [row.id for row in r.memory.list_apps()] == ["notes"]
    assert r.apps.restarted == ["notes"]


async def test_a_refused_card_adds_nothing(rig):
    r = rig()
    box = RealToolbox(
        [BrainSource([(r.spec, r.handler)])],
        lambda: {},
        lambda n, m: None,
        StubAsks("deny"),
        engine=person_engine(),
    )
    with pytest.raises(RpcError):
        await box.run(Call("c1", "install_app", {"id": "acme/notes"}, "t1", ""))
    assert r.memory.list_apps() == [] and r.apps.restarted == []


async def test_a_preference_and_a_stored_auto_still_reach_the_person(rig):
    class Side:
        asked = 0

        async def decide(self, facts):
            Side.asked += 1
            return "any-pref"

    r = rig(env={"ACME_KEY": "k"})
    asks = StubAsks()
    modes = lambda: {"install_app": "auto"}  # noqa: E731
    engine = Engine(
        [StandingRule(stored_auto_rules(modes)), SideCheckDecider(Side()), Person()],
        None,
        None,
        lambda n: None,
    )
    box = RealToolbox(
        [BrainSource([(r.spec, r.handler)])], modes, lambda n, m: None, asks, engine=engine
    )
    await box.run(Call("c1", "install_app", {"id": "acme/notes"}, "t1", ""))
    assert asks.asked and Side.asked == 0


async def test_old_node_is_replaced_by_the_private_one_before_the_app_is_added(rig, ensure):
    r = rig(machine(ToolVersion("18.0.0", "x")), env={"ACME_KEY": "k"})
    out = await r.run()
    assert ensure == [22] and out["status"] == "connected"
    (row,) = r.memory.list_apps()
    assert row.config["command"] == str(node_dir(r.home) / "node.exe")


async def test_missing_env_is_reported_by_name_and_no_value_is_stored(rig):
    r = rig(env={})
    out = await r.run()
    assert out["needs_env"] == ["ACME_KEY"]
    (row,) = r.memory.list_apps()
    assert row.config["env"]["ACME_KEY"] == "${ACME_KEY}"
    assert TokenFile(r.home).items() == {}


async def test_remote_entry_starts_sign_in_through_apps_when_a_browser_is_there(rig):
    r = rig(browser=True)
    out = await r.run("acme/cloud")
    assert r.apps.signed_in == ["cloud"] and out["status"] == "signing_in"
    (row,) = r.memory.list_apps()
    assert (row.transport, row.auth) == ("http", "oauth")


async def test_remote_entry_without_a_browser_connects_and_says_so(rig):
    r = rig(browser=False)
    r.apps.state = "needs-sign-in"
    out = await r.run("acme/cloud")
    assert r.apps.signed_in == [] and out["status"] == "needs-sign-in"
    assert out["browser"] is False


async def test_uv_missing_adds_nothing(rig, monkeypatch):
    monkeypatch.setattr("brain.setup.apps.shutil.which", lambda n: None)
    r = rig()
    out = await r.run("acme/pytool")
    assert out["error"] == "uv_missing" and r.memory.list_apps() == []


async def test_the_same_app_twice_is_a_fact_not_a_duplicate(rig):
    r = rig(env={"ACME_KEY": "k"})
    await r.run()
    again = await r.run()
    assert again["error"] == "already_added" and again["id"] == "notes"
    assert len(r.memory.list_apps()) == 1


async def test_the_app_appears_in_list_apps_after_install(rig):
    from brain.app_tools import app_home_tools

    r = rig(env={"ACME_KEY": "k"})
    await r.run()
    handlers = {
        s.name: h
        for s, h in app_home_tools(r.apps, r.memory, TokenFile(r.home), lambda m, p: None, r.bodies)
    }
    rows = json.loads(await handlers["list_apps"]({}))["apps"]
    assert [a["id"] for a in rows] == ["notes"]


async def test_a_duplicate_downloads_no_node(rig, ensure):
    r = rig(machine(ToolVersion("18.0.0", "x")))
    await r.run()
    calls_before = len(ensure)
    # the private Node now exists, so remove it to prove the duplicate check runs first
    import shutil

    shutil.rmtree(node_dir(r.home))
    again = await r.run()
    assert again["error"] == "already_added" and len(ensure) == calls_before


async def test_a_refused_sign_in_is_a_fact_with_the_app_id(rig):
    r = rig(browser=True)

    async def boom(app_id, open_url):
        raise AppError("no sign-in here")

    r.apps.sign_in = boom
    out = await r.run("acme/cloud")
    assert out["error"] == "refused" and out["id"] == "cloud"


# ---- a connected app is reported, so Scout can carry on (B25d) ----


async def until(cond, seconds=3.0):
    for _ in range(int(seconds / 0.05)):
        if cond():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("condition not met")


async def test_an_app_that_connects_in_the_turn_lists_its_tools_and_sends_no_event(rig):
    r = rig(env={"ACME_KEY": "k"})
    out = await r.run()
    assert out["status"] == "connected" and out["tools"] == ["create_event", "list_events"]
    assert out["tools_total"] == 2
    await asyncio.sleep(0.1)
    assert r.events == []  # the tool result already told Scout


async def test_a_sign_in_that_finishes_later_sends_setup_done_with_the_app_and_tools(rig):
    r = rig(browser=True)
    out = await r.run("acme/cloud")
    assert out["status"] == "signing_in" and r.events == []
    r.apps.state = "connected"  # the person finished in the browser
    await until(lambda: r.events)
    (event,) = r.events
    assert event.kind == "setup_done" and event.key == "cloud"
    assert event.facts == {
        "app": "cloud",
        "name": "cloud",
        "ok": True,
        "state": "connected",
        "tools": "create_event, list_events",
        "tools_total": 2,
    }


async def test_a_sign_in_that_fails_sends_setup_done_with_the_state_and_no_tools(rig):
    r = rig(browser=True)
    await r.run("acme/cloud")
    r.apps.state, r.apps.error = "needs-sign-in", "Sign in to acme/cloud again."
    await until(lambda: r.events)
    (event,) = r.events
    assert event.facts["ok"] is False and event.facts["state"] == "needs-sign-in"
    assert "tools" not in event.facts


async def test_a_long_tool_list_is_capped_with_the_real_total(rig):
    r = rig(env={"ACME_KEY": "k"})
    r.apps.tool_names = [f"t{i}" for i in range(45)]
    out = await r.run()
    assert len(out["tools"]) == 30 and out["tools_total"] == 45


async def test_a_watch_stopped_at_shutdown_emits_nothing(rig):
    r = rig(browser=True)
    await r.run("acme/cloud")  # signing in: a watch is waiting
    await r.stop_watches()
    r.apps.state = "off"  # what apps.shutdown() does next
    await asyncio.sleep(0.5)
    assert r.events == []


def test_the_watch_outlasts_the_longest_connect_and_sign_in():
    import inspect

    from brain.apps import Apps
    from brain.setup.apps import SIGN_IN_WAIT_S

    params = inspect.signature(Apps.__init__).parameters
    longest = params["signin_timeout"].default + params["connect_timeout"].default
    assert SIGN_IN_WAIT_S > longest  # the watch must not give up before Apps does


# ---- official and community facts ----


async def test_app_card_carries_official_facts(rig):
    card = await rig().spec.card({"id": "com.acme/hosted"})
    assert card["official"] is True and card["community"] is False
    assert card["runs"] == "hosted" and card["host"] == "h.acme.test"
    assert card["publisher"] == "com.acme" and card["sign_in"] == "browser"
    assert card["reviewed"] is None and card["licence"] == "Unknown"


async def test_app_card_community_package_facts(rig):
    card = await rig().spec.card({"id": "io.github.bob/pkg"})
    assert card["official"] is False and card["community"] is True
    assert card["runs"] == "pc" and card["host"] is None
    assert card["licence"] == "Unknown" and card["sign_in"] == "key"
    assert card["publisher"] == "https://github.com/bob/pkg" == card["repo"]
    assert card["package"] == "@bob/pkg"  # the existing facts stay


async def test_install_app_result_names_official(rig):
    out = await rig().run("com.acme/hosted")
    assert out["official"] is True


async def test_install_app_for_community_stays_person_only_and_asks_with_the_card(rig):
    r = rig(env={"BOB_KEY": "k"})
    assert r.spec.tier is Tier.person_only
    asks = StubAsks("deny")
    box = RealToolbox(
        [BrainSource([(r.spec, r.handler)])],
        lambda: {},
        lambda n, m: None,
        asks,
        engine=person_engine(),
    )
    with pytest.raises(RpcError):
        await box.run(Call("c1", "install_app", {"id": "io.github.bob/pkg"}, "t1", ""))
    assert asks.asked[0]["community"] is True and asks.locked
    assert r.memory.list_apps() == []
