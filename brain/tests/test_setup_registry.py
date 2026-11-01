"""Checks the ACP and MCP registry read: parsing the 20a samples, the cache and the tools."""

import json
from pathlib import Path

import pytest

from brain.setup.facts import Machine
from brain.setup.registry import Registry, RegistryUnavailable, build_for
from brain.setup.tools import setup_tools

FIX = Path(__file__).parent / "fixtures"
ACP = (FIX / "acp-registry.sample.json").read_bytes()
MCP = (FIX / "mcp-registry.sample.json").read_bytes()


class Net:
    """A fake GetJson: serves a body by host, records the URLs, can go offline."""

    def __init__(self, acp=ACP, mcp=MCP):
        self.acp, self.mcp = acp, mcp
        self.urls: list[str] = []
        self.offline = False

    async def __call__(self, url: str) -> bytes:
        self.urls.append(url)
        if self.offline:
            raise OSError("offline")
        return self.acp if "agentclientprotocol" in url else self.mcp


class Clock:
    def __init__(self):
        self.now = 1_000_000.0

    def __call__(self):
        return self.now


def machine(os="windows", arch="x64") -> Machine:
    return Machine(os, arch, None, None, None, None, None)


def registry(tmp_path, net=None, clock=None):
    return Registry(tmp_path, net or Net(), clock or Clock())


async def test_parses_acp_sample(tmp_path):
    listing = await registry(tmp_path).acp_agents()
    by_id = {e.id: e for e in listing.entries}
    claude = by_id["claude-acp"]
    d = claude.distributions[0]
    assert (d.kind, d.package, d.version) == (
        "npx",
        "@agentclientprotocol/claude-agent-acp",
        "0.99.1",
    )
    assert claude.requires == {}
    gem = by_id["gemini"].distributions[0]
    assert gem.package == "@google/gemini-cli" and gem.args == ["--acp"]
    binary = by_id["fake-binary-agent"].distributions
    assert {d.platforms for d in binary} == {("windows-x86_64",), ("linux-x86_64",)}
    first = binary[0]
    assert first.url.endswith(".zip") and first.sha256 and first.cmd == ["./fake-binary-agent.exe"]
    assert not listing.stale


async def test_unknown_fields_ignored_and_malformed_entry_skipped(tmp_path):
    body = json.dumps(
        {
            "mystery": 1,
            "agents": [
                {
                    "id": "ok",
                    "name": "Ok",
                    "version": "1",
                    "future": True,
                    "distribution": {"npx": {"package": "a@1"}},
                },
                {"id": "bad", "distribution": "nonsense"},
                "junk",
            ],
        }
    ).encode()
    listing = await registry(tmp_path, Net(acp=body)).acp_agents()
    assert [e.id for e in listing.entries] == ["ok"]


async def test_second_read_within_ttl_uses_cache(tmp_path):
    net = Net()
    reg = registry(tmp_path, net)
    await reg.acp_agents()
    await reg.acp_agents()
    assert len(net.urls) == 1


async def test_refetch_after_ttl_rewrites_cache(tmp_path):
    net, clock = Net(), Clock()
    reg = registry(tmp_path, net, clock)
    await reg.acp_agents()
    clock.now += 86401
    await reg.acp_agents()
    assert len(net.urls) == 2
    cache = tmp_path / "cache" / "acp-registry.json"
    assert cache.exists() and not (tmp_path / "cache" / "acp-registry.json.part").exists()
    assert json.loads(cache.read_text())["fetched_at"] == clock.now


async def test_offline_with_cache_is_stale(tmp_path):
    net, clock = Net(), Clock()
    reg = registry(tmp_path, net, clock)
    await reg.acp_agents()
    clock.now += 999_999
    net.offline = True
    listing = await reg.acp_agents()
    assert listing.stale and len(listing.entries) == 4


async def test_offline_without_cache_raises(tmp_path):
    net = Net()
    net.offline = True
    with pytest.raises(RegistryUnavailable):
        await registry(tmp_path, net).acp_agents()


async def test_build_for_picks_machine_or_none(tmp_path):
    by_id = {e.id: e for e in (await registry(tmp_path).acp_agents()).entries}
    assert build_for(by_id["claude-acp"], machine()).kind == "npx"
    win = build_for(by_id["fake-binary-agent"], machine("windows", "x64"))
    assert win.platforms == ("windows-x86_64",)
    lin = build_for(by_id["fake-binary-agent"], machine("linux", "x64"))
    assert lin.platforms == ("linux-x86_64",)
    assert build_for(by_id["fake-binary-agent"], machine("macos", "arm64")) is None


async def test_parses_mcp_sample_with_remote(tmp_path):
    listing = await registry(tmp_path).mcp_servers(None)
    kinds = {e.id: [d.kind for d in e.distributions] for e in listing.entries}
    assert kinds["ai.2kw/mcp-server"] == ["npx"]
    all_dists = [d for e in listing.entries for d in e.distributions]
    remote = next(d for d in all_dists if d.kind == "remote")
    assert remote.url == "https://apexai.academy/mcp"
    assert "ai.adeu/adeu" not in kinds  # isLatest false: an older version, left out


async def test_mcp_query_goes_to_the_registry_search(tmp_path):
    net = Net()
    reg = registry(tmp_path, net)
    await reg.mcp_servers("note taking")
    await reg.mcp_servers(None)
    assert "search=note%20taking" in net.urls[0] and "version=latest" in net.urls[0]
    assert "search=" not in net.urls[1]


async def test_tools_report_buildable_per_machine(tmp_path):
    async def inspect_fn():
        return machine("macos", "arm64")

    tools = {s.name: (s, h) for s, h in setup_tools(tmp_path, registry(tmp_path), inspect_fn)}
    for name in ("find_experts", "find_apps"):
        assert tools[name][0].effect == "read" and tools[name][0].default_mode == "auto"
    out = json.loads(await tools["find_experts"][1]({}))
    flags = {e["id"]: e["buildable"] for e in out["experts"]}
    assert flags["claude-acp"] is True and flags["fake-binary-agent"] is False
    assert out["stale"] is False
    apps = json.loads(await tools["find_apps"][1]({"query": "x"}))
    assert apps["apps"]


async def test_tools_report_unavailable_registry_as_a_fact(tmp_path):
    net = Net()
    net.offline = True

    async def inspect_fn():
        return machine()

    tools = {s.name: h for s, h in setup_tools(tmp_path, registry(tmp_path, net), inspect_fn)}
    out = json.loads(await tools["find_experts"]({}))
    assert out["error"] == "registry_unavailable"


async def test_mcp_pypi_package_is_uvx(tmp_path):
    body = json.dumps(
        {
            "servers": [
                {
                    "server": {
                        "name": "x/y",
                        "version": "1",
                        "packages": [{"registryType": "pypi", "identifier": "y", "version": "1"}],
                    }
                }
            ]
        }
    ).encode()
    listing = await registry(tmp_path, Net(mcp=body)).mcp_servers(None)
    assert [d.kind for d in listing.entries[0].distributions] == ["uvx"]


async def test_failed_cache_write_leaves_no_part_file(tmp_path, monkeypatch):
    def boom(src, dst):
        raise OSError("disk")

    monkeypatch.setattr("brain.setup.registry.os.replace", boom)
    listing = await registry(tmp_path).acp_agents()
    assert listing.entries
    assert not list((tmp_path / "cache").glob("*.part"))


async def test_damaged_cache_is_refetched(tmp_path):
    cache = tmp_path / "cache" / "acp-registry.json"
    cache.parent.mkdir(parents=True)
    cache.write_text(json.dumps({"fetched_at": "soon", "data": {"agents": []}}))
    net = Net()
    listing = await registry(tmp_path, net).acp_agents()
    assert len(net.urls) == 1 and listing.entries


async def test_more_is_true_when_the_mcp_page_has_a_cursor(tmp_path):
    body = json.loads(MCP)
    body["metadata"] = {"nextCursor": "abc", "count": 2}
    reg = registry(tmp_path, Net(mcp=json.dumps(body).encode()))
    assert (await reg.mcp_servers(None)).more is True
    assert (await registry(tmp_path / "b").acp_agents()).more is False


async def test_query_is_lowercased_and_hashed_in_the_cache_name(tmp_path):
    net = Net()
    reg = registry(tmp_path, net)
    await reg.mcp_servers("Note Taking")
    await reg.mcp_servers("note taking")
    assert len(net.urls) == 1 and "search=note%20taking" in net.urls[0]
    names = [p.name for p in (tmp_path / "cache").iterdir()]
    assert len(names) == 1 and names[0].startswith("mcp-") and " " not in names[0]


async def test_tools_pass_more_through(tmp_path):
    body = json.loads(MCP)
    body["metadata"] = {"nextCursor": "abc"}

    async def inspect_fn():
        return machine()

    reg = registry(tmp_path, Net(mcp=json.dumps(body).encode()))
    tools = {s.name: h for s, h in setup_tools(tmp_path, reg, inspect_fn)}
    assert json.loads(await tools["find_apps"]({}))["more"] is True
    assert json.loads(await tools["find_experts"]({}))["more"] is False
