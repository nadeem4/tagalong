"""Checks the update check and applying updates, on a fake registry and fake installers.

No network, no npm, no real app: the registry body is served by a fake `get`, an expert reinstall
and an app restart are recorded, and a jobs flag says whether a job runs. Time is a fake clock.
"""

import json
import logging
from datetime import UTC, datetime, timedelta

import pytest

from brain.apps import AppRow
from brain.memory import Memory
from brain.setup.home_tools import home_update_tools
from brain.setup.install import InstallError
from brain.setup.registry import Registry, RegistryUnavailable
from brain.setup.store import ExpertStore, InstalledExpert
from brain.setup.updates import Updates, check, newer


def acp(version="1.3.0") -> dict:
    return {
        "agents": [
            {
                "id": "claude-acp",
                "name": "Claude Code",
                "version": version,
                "description": "",
                "distribution": {"npx": {"package": f"@acme/claude@{version}"}},
            },
            {
                "id": "foo",
                "name": "Foo",
                "version": "0.4.0",
                "description": "",
                "distribution": {"npx": {"package": "foo@0.4.0"}},
            },
        ]
    }


def mcp_server(name: str, title: str, package: str, version: str) -> dict:
    return {
        "server": {
            "name": name,
            "title": title,
            "version": version,
            "packages": [{"registryType": "npm", "identifier": package, "version": version}],
        }
    }


class Net:
    """A fake GetJson: the ACP and MCP bodies, switchable offline."""

    def __init__(self):
        self.acp = acp()
        self.mcp = {
            "servers": [
                mcp_server("com.acme/files", "Files", "@acme/files", "1.3.0"),
                mcp_server("io.github.bob/linear", "Linear", "bob-linear", "0.5.0"),
            ]
        }
        self.offline = False
        self.urls: list[str] = []

    async def __call__(self, url: str) -> bytes:
        self.urls.append(url)
        if self.offline:
            raise OSError("offline")
        return json.dumps(self.acp if "agentclientprotocol" in url else self.mcp).encode()


class Clock:
    def __init__(self):
        self.now = datetime(2026, 11, 10, 9, 0, tzinfo=UTC)

    def __call__(self):
        return self.now


class FakeApps:
    def __init__(self):
        self.restarted: list[str] = []
        self.fail = False

    async def restart(self, app_id):
        if self.fail:
            raise RuntimeError("will not start")
        self.restarted.append(app_id)


def files_app(version="1.2.0") -> AppRow:
    args = ["npm", "exec", "--yes", "--", f"@acme/files@{version}"]
    return AppRow(
        "files",
        "Files",
        "stdio",
        {"command": "node", "args": args},
        "none",
        True,
        "official",
        version,
    )


def linear_app(version="0.4.0") -> AppRow:
    args = ["npm", "exec", "--yes", "--", f"bob-linear@{version}"]
    return AppRow(
        "linear",
        "Linear",
        "stdio",
        {"command": "node", "args": args},
        "none",
        True,
        "community",
        version,
    )


def notion_app() -> AppRow:
    config = {"url": "https://mcp.notion.com/mcp"}
    return AppRow("notion", "Notion", "http", config, "oauth", True, "official")


def expert(version="1.2.0", id="claude-acp", name="Claude Code") -> InstalledExpert:
    return InstalledExpert(id, name, version, ["node", "a.js"], "registry", True)


class Rig:
    def __init__(self, tmp_path):
        self.home = tmp_path
        self.net, self.clock = Net(), Clock()
        self.registry = Registry(tmp_path, self.net, lambda: self.clock.now.timestamp())
        self.memory = Memory(tmp_path / "t.db")
        self.store = ExpertStore(tmp_path)
        self.apps = FakeApps()
        self.running = False
        self.changed: list[dict] = []
        self.reinstalled: list[str] = []
        self.install_error: Exception | None = None
        self.updates = self.make()

    async def reinstall(self, entry):
        if self.install_error:
            raise self.install_error
        self.reinstalled.append(entry.id)
        old = self.store.get(entry.id)
        self.store.add(
            InstalledExpert(entry.id, entry.name, entry.version, old.command, "registry", None)
        )

    def make(self) -> Updates:
        return Updates(
            self.home,
            self.registry,
            self.memory,
            self.store,
            self.apps,
            self.reinstall,
            lambda: self.running,
            lambda what, params: self.changed.append(params),
            self.clock,
        )

    def items(self) -> dict:
        return {(i["kind"], i["id"]): i for i in self.updates.state()["items"]}


@pytest.fixture
def rig(tmp_path):
    made = []

    def make():
        made.append(Rig(tmp_path))
        return made[-1]

    yield make
    for r in made:
        r.memory.close()


def test_newer_compares_numbers_not_text():
    assert newer("1.10.0", "1.9.0") and not newer("1.2.0", "1.2.0") and not newer("1.0", "1.2")
    assert not newer("", "1.0") and not newer("1.0", "")


async def test_expert_newer_in_registry_is_an_update(rig):
    r = rig()
    r.store.add(expert("1.2.0"))
    got = await check(r.registry, [], r.store.list(), refresh=False)
    assert [(i.kind, i.id, i.installed, i.latest) for i in got] == [
        ("expert", "claude-acp", "1.2.0", "1.3.0")
    ]
    assert got[0].has_update and not got[0].remote


async def test_package_app_newer_is_an_update(rig):
    r = rig()
    got = await check(r.registry, [files_app("1.2.0"), linear_app("0.5.0")], [], refresh=False)
    assert [(i.id, i.latest, i.has_update) for i in got] == [
        ("files", "1.3.0", True),
        ("linear", "0.5.0", False),
    ]


async def test_remote_app_is_never_an_update(rig):
    r = rig()
    (got,) = await check(r.registry, [notion_app()], [], refresh=False)
    assert got.remote and got.latest is None and not got.has_update


async def test_auto_defaults_follow_trust(rig):
    r = rig()
    r.store.add(expert())
    r.store.add(expert("0.3.0", "foo", "Foo"))
    got = await check(r.registry, [files_app(), linear_app()], r.store.list(), refresh=False)
    assert {(i.kind, i.id): (i.official, i.auto) for i in got} == {
        ("app", "files"): (True, True),
        ("app", "linear"): (False, False),
        ("expert", "claude-acp"): (True, True),
        ("expert", "foo"): (False, False),
    }


async def test_a_custom_command_expert_is_not_listed(rig):
    r = rig()
    custom = InstalledExpert("custom", "Custom command", "", ["x"], "custom", None)
    assert await check(r.registry, [], [custom], refresh=False) == []


async def test_refresh_reads_the_registry_afresh_only_when_asked(rig):
    r = rig()
    r.store.add(expert())
    await check(r.registry, [], r.store.list(), refresh=False)
    before = len(r.net.urls)
    await check(r.registry, [], r.store.list(), refresh=False)
    assert len(r.net.urls) == before  # served from the cache
    await check(r.registry, [], r.store.list(), refresh=True)
    assert len(r.net.urls) == before + 1


async def test_registry_down_keeps_last_known_and_time(rig):
    r = rig()
    r.store.add(expert())
    await r.updates.check(refresh=False)
    first = r.updates.state()
    r.net.offline = True
    r.clock.now += timedelta(hours=2)
    (tmp_cache,) = list((r.home / "cache").glob("acp-registry.json"))
    tmp_cache.unlink()  # nothing cached either: the registry cannot be read at all
    with pytest.raises(RegistryUnavailable):
        await check(r.registry, [], r.store.list(), refresh=True)
    await r.updates.check(refresh=True)
    assert r.updates.state() == first
    assert r.updates.state()["checkedAt"] == "2026-11-10T09:00:00+00:00"


async def test_last_checked_survives_restart(rig):
    r = rig()
    assert r.updates.state()["checkedAt"] is None
    await r.updates.check(refresh=False)
    assert r.make().state()["checkedAt"] == "2026-11-10T09:00:00+00:00"


# ---- applying ----


async def test_auto_update_waits_while_a_job_runs_then_applies(rig):
    r = rig()
    r.store.add(expert("1.2.0"))
    r.running = True
    await r.updates.check(refresh=False)
    await r.updates.wait()
    assert r.reinstalled == [] and r.items()[("expert", "claude-acp")]["status"] == "waiting"
    r.running = False  # the job ended: the next tick applies it
    await r.updates.tick()
    await r.updates.wait()
    assert r.reinstalled == ["claude-acp"]
    row = r.items()[("expert", "claude-acp")]
    assert (row["installed"], row["status"]) == ("1.3.0", "updated")


async def test_community_updates_wait_for_the_person(rig):
    r = rig()
    r.memory.add_app(linear_app("0.4.0"))
    await r.updates.check(refresh=False)
    await r.updates.wait()
    assert r.apps.restarted == []
    assert r.items()[("app", "linear")]["status"] == "idle"


async def test_manual_update_during_a_job_says_it_will_wait(rig):
    r = rig()
    r.memory.add_app(linear_app("0.4.0"))
    await r.updates.check(refresh=False)
    r.running = True
    assert await r.updates.update("app", "linear") == {"waiting": "job"}
    await r.updates.wait()
    assert r.apps.restarted == []
    r.running = False
    await r.updates.tick()
    await r.updates.wait()
    assert r.apps.restarted == ["linear"]


async def test_a_package_app_update_rewrites_its_command_and_restarts_it(rig):
    r = rig()
    r.memory.add_app(linear_app("0.4.0"))
    await r.updates.check(refresh=False)
    assert await r.updates.update("app", "linear") == {"started": True}
    await r.updates.wait()
    (row,) = r.memory.list_apps()
    assert row.version == "0.5.0" and row.config["args"][-1] == "bob-linear@0.5.0"
    assert row.config["args"][:-1] == ["npm", "exec", "--yes", "--"]
    assert r.apps.restarted == ["linear"] and {"what": "apps"} in r.changed


async def test_update_all_counts_only_items_with_updates(rig):
    r = rig()
    r.memory.add_app(files_app("1.3.0"))  # current
    r.memory.add_app(linear_app("0.4.0"))  # behind
    r.memory.add_app(notion_app())  # remote
    await r.updates.check(refresh=False)
    assert await r.updates.update_all("app") == {"started": True, "count": 1}
    await r.updates.wait()
    assert r.apps.restarted == ["linear"]
    assert await r.updates.update_all("app") == {"started": False, "count": 0}


async def test_an_expert_update_keeps_the_login_and_clears_when_checked_again(rig):
    r = rig()
    r.store.add(expert("1.2.0"))
    await r.updates.check(refresh=False)
    await r.updates.wait()
    assert r.store.get("claude-acp").logged_in is True
    assert r.items()[("expert", "claude-acp")]["status"] == "updated"
    await r.updates.check(refresh=False)
    assert r.items()[("expert", "claude-acp")]["status"] == "idle"


async def test_failed_update_keeps_the_old_version(rig, caplog):
    r = rig()
    r.store.add(expert("1.2.0"))
    r.install_error = InstallError("swap_failed", "in use")
    caplog.set_level(logging.WARNING)
    await r.updates.check(refresh=False)
    await r.updates.wait()
    row = r.items()[("expert", "claude-acp")]
    assert (row["installed"], row["status"]) == ("1.2.0", "failed")
    assert r.store.get("claude-acp").version == "1.2.0"
    assert "swap_failed" in caplog.text


async def test_a_failed_app_restart_puts_the_old_command_back(rig):
    r = rig()
    r.memory.add_app(linear_app("0.4.0"))
    r.apps.fail = True
    await r.updates.check(refresh=False)
    await r.updates.update("app", "linear")
    await r.updates.wait()
    (row,) = r.memory.list_apps()
    assert row.version == "0.4.0" and row.config["args"][-1] == "bob-linear@0.4.0"
    assert r.items()[("app", "linear")]["status"] == "failed"


async def test_set_auto_update_saves_per_group(rig):
    r = rig()
    r.memory.add_app(files_app("1.2.0"))
    r.memory.add_app(linear_app("0.4.0"))
    r.updates.set_auto("app", official=True, on=False)
    r.updates.set_auto("app", official=False, on=True)
    assert r.make().state()["auto"]["apps"] == {"official": False, "community": True}
    await r.updates.check(refresh=False)
    await r.updates.wait()
    assert r.apps.restarted == ["linear"]  # only the group now on


async def test_daily_check_runs_once_per_day(rig):
    r = rig()
    r.store.add(expert("1.3.0"))
    await r.updates.tick()
    await r.updates.tick()
    reads = len(r.net.urls)
    assert reads > 0 and r.updates.state()["checkedAt"] is not None
    r.clock.now += timedelta(hours=23)
    await r.updates.tick()
    assert len(r.net.urls) == reads
    r.clock.now += timedelta(hours=2)
    r.net.acp = acp("1.4.0")
    await r.updates.tick()
    assert len(r.net.urls) > reads


async def test_home_tools_read_check_update_and_set_auto(rig):
    r = rig()
    r.memory.add_app(linear_app("0.4.0"))
    tools = {spec.name: (spec, handler) for spec, handler in home_update_tools(r.updates)}
    assert all(spec.audience == frozenset({"home"}) for spec, _ in tools.values())
    assert tools["updates_state"][0].effect == "read"

    async def call(name, args=None):
        return json.loads(await tools[name][1](args or {}))

    assert (await call("updates_state"))["checkedAt"] is None
    checked = await call("updates_check")
    assert checked["checkedAt"] and checked["items"][0]["latest"] == "0.5.0"
    assert await call("set_auto_update", {"kind": "app", "official": False, "on": True}) == {
        "kind": "app",
        "official": False,
        "on": True,
    }
    assert await call("update_item", {"kind": "app", "id": "linear"}) == {"started": True}
    await r.updates.wait()
    assert (await call("updates_state"))["items"][0]["status"] == "updated"
    assert await call("update_all", {"kind": "app"}) == {"started": False, "count": 0}
    assert await call("update_item", {"kind": "app", "id": "nope"}) == {"error": "no_update"}
    assert await call("update_item", {"kind": "tool", "id": "x"}) == {"error": "no_update"}
