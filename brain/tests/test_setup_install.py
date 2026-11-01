"""Checks installing an expert from its registry entry, on fakes only.

No network, no npm, no Node download: the command runner, the fetch, the registry and the
private Node are all stand-ins, and the files npm would write are made by the fake runner.
"""

import asyncio
import hashlib
import io
import json
import os
import zipfile
from dataclasses import replace
from pathlib import Path

import pytest

from brain.events import Event
from brain.mind.turn import Call
from brain.protocol import RpcError
from brain.setup import install as install_mod
from brain.setup.expert_tools import expert_setup_tools
from brain.setup.facts import CmdResult, Machine, NodePaths, ToolVersion
from brain.setup.install import (
    InstallError,
    NoBuild,
    Unsupported,
    install_card,
    install_expert,
)
from brain.setup.paths import node_dir, tools_dir
from brain.setup.registry import Distribution, Registry, RegistryEntry
from brain.setup.store import ExpertStore
from brain.toolbox import BrainSource, resolve_mode
from brain.toolbox import Toolbox as RealToolbox

FIX = Path(__file__).parent / "fixtures"
ACP = (FIX / "acp-registry.sample.json").read_bytes()
NODE_INDEX = (FIX / "node-index.sample.json").read_bytes()
PKG = "@agentclientprotocol/claude-agent-acp"


def machine(node: ToolVersion | None = None, os_name="windows", arch="x64") -> Machine:
    return Machine(os_name, arch, node, None, None, None, None)


def npx_entry(requires=None) -> RegistryEntry:
    return RegistryEntry(
        "claude-acp",
        "Claude Agent",
        "0.99.1",
        "",
        "",
        [Distribution("npx", PKG, "0.99.1", args=["--acp"])],
        requires or {},
    )


def binary_entry(sha: str | None, archive: str = "https://x.invalid/agent.zip") -> RegistryEntry:
    d = Distribution(
        "binary",
        url=archive,
        sha256=sha,
        cmd=["./agent.exe"],
        args=["acp"],
        platforms=("windows-x86_64",),
    )
    return RegistryEntry("bin-agent", "Bin Agent", "1.0.0", "", "", [d])


class Npm:
    """A fake RunCmd standing in for `node npm-cli.js install`: writes what npm would."""

    def __init__(self, code=0, bin_value=None):
        self.calls: list[tuple[list[str], dict, Path | None]] = []
        self.code = code
        self.bin_value = {"claude-agent-acp": "dist/index.js"} if bin_value is None else bin_value

    async def __call__(self, argv, env, cwd):
        self.calls.append((argv, dict(env), cwd))
        prefix = Path(argv[argv.index("--prefix") + 1])
        pkg = prefix / "node_modules" / Path(*PKG.split("/"))
        (pkg / "dist").mkdir(parents=True)  # a half install exists even when npm then fails
        if self.code:
            return CmdResult(self.code, "", "npm ERR! network")
        (pkg / "package.json").write_text(json.dumps({"bin": self.bin_value}))
        (pkg / "dist" / "index.js").write_text("//")
        return CmdResult(0, "", "")


class Ensure:
    """A fake ensure_node: records the floor and lays out a private Node under home."""

    def __init__(self):
        self.calls: list[int] = []

    async def __call__(self, home, min_major, fetch, get_json, os_name, arch, on_progress):
        self.calls.append(min_major)
        on_progress(0.5)
        root = node_dir(home)
        node, cli = root / "node.exe", root / "node_modules" / "npm" / "bin" / "npm-cli.js"
        cli.parent.mkdir(parents=True, exist_ok=True)
        node.write_text("")
        cli.write_text("")
        return NodePaths(node, cli)


@pytest.fixture
def ensure(monkeypatch):
    fake = Ensure()
    monkeypatch.setattr(install_mod, "ensure_node", fake)
    return fake


async def no_fetch(url):
    raise AssertionError("nothing should be fetched")
    yield b""


async def index_only(url: str) -> bytes:
    assert url.endswith("index.json")
    return NODE_INDEX


async def no_json(url):
    raise AssertionError("no lookup needed")


def system_node(tmp_path: Path, version="22.5.0") -> ToolVersion:
    root = tmp_path / "sys"
    (root / "node_modules" / "npm" / "bin").mkdir(parents=True)
    (root / "node.exe").write_text("")
    (root / "node_modules" / "npm" / "bin" / "npm-cli.js").write_text("")
    return ToolVersion(version, str(root / "node.exe"))


async def go(tmp_path, entry, mach, run, fetch=no_fetch, progress=None):
    return await install_expert(
        entry,
        tmp_path,
        mach,
        run,
        fetch,
        index_only,
        ExpertStore(tmp_path),
        progress or (lambda d: None),
    )


# ---- npx ----


async def test_npx_install_runs_npm_with_the_private_node_prefix_and_explicit_env(tmp_path, ensure):
    npm = Npm()
    expert = await go(tmp_path, npx_entry(), machine(), npm)
    argv, env, cwd = npm.calls[0]
    prefix = tools_dir(tmp_path, "claude-acp")
    assert argv[0] == str(node_dir(tmp_path) / "node.exe")
    assert argv[1].endswith("npm-cli.js")
    assert argv[2:] == ["install", "--prefix", str(prefix), f"{PKG}@0.99.1"]
    assert cwd == prefix
    assert env["PATH"].startswith(str(node_dir(tmp_path)) + os.pathsep)  # child only
    assert ensure.calls == [22]
    js = prefix / "node_modules" / "@agentclientprotocol" / "claude-agent-acp" / "dist" / "index.js"
    assert expert.command == [argv[0], str(js), "--acp"]
    assert (expert.id, expert.name, expert.version) == ("claude-acp", "Claude Agent", "0.99.1")
    assert expert.source == "registry" and expert.logged_in is None
    assert ExpertStore(tmp_path).get("claude-acp") == expert


async def test_a_string_bin_is_used_as_is(tmp_path, ensure):
    expert = await go(tmp_path, npx_entry(), machine(), Npm(bin_value="dist/index.js"))
    assert expert.command[1].endswith("index.js")


async def test_system_node_new_enough_is_used_and_no_download_happens(tmp_path, ensure):
    npm = Npm()
    node = system_node(tmp_path)
    await go(tmp_path, npx_entry(), machine(node), npm)
    assert ensure.calls == []
    assert npm.calls[0][0][0] == node.path


async def test_old_system_node_triggers_ensure_node_with_the_entrys_floor(tmp_path, ensure):
    npm = Npm()
    node = system_node(tmp_path, "18.20.0")
    await go(tmp_path, npx_entry({"node": "24"}), machine(node), npm)
    assert ensure.calls == [24]
    assert npm.calls[0][0][0] == str(node_dir(tmp_path) / "node.exe")


async def test_system_node_without_its_npm_is_not_used(tmp_path, ensure):
    lone = tmp_path / "lone" / "node.exe"
    lone.parent.mkdir()
    lone.write_text("")
    await go(tmp_path, npx_entry(), machine(ToolVersion("22.5.0", str(lone))), Npm())
    assert ensure.calls == [22]


async def test_the_system_env_path_and_global_npm_prefix_are_unchanged(tmp_path, ensure):
    before = dict(os.environ)
    npm = Npm()
    await go(tmp_path, npx_entry(), machine(), npm)
    assert dict(os.environ) == before
    assert npm.calls[0][1] is not os.environ
    assert "-g" not in npm.calls[0][0] and "--global" not in npm.calls[0][0]


async def test_npm_failure_keeps_no_half_record_and_removes_the_prefix_dir(tmp_path, ensure):
    with pytest.raises(InstallError) as err:
        await go(tmp_path, npx_entry(), machine(), Npm(code=1))
    assert err.value.kind == "npm_failed" and "network" in err.value.detail
    assert ExpertStore(tmp_path).list() == []
    assert not tools_dir(tmp_path, "claude-acp").exists()


async def test_a_package_with_no_bin_fails_cleanly(tmp_path, ensure):
    with pytest.raises(InstallError) as err:
        await go(tmp_path, npx_entry(), machine(), Npm(bin_value={}))
    assert err.value.kind == "npm_failed"
    assert not tools_dir(tmp_path, "claude-acp").exists()


async def test_a_bin_that_points_outside_the_package_is_refused(tmp_path, ensure):
    with pytest.raises(InstallError):
        await go(tmp_path, npx_entry(), machine(), Npm(bin_value="../../../../evil.js"))
    assert not tools_dir(tmp_path, "claude-acp").exists()


async def test_a_cancelled_install_also_cleans_up(tmp_path, ensure):
    class Hang(Npm):
        async def __call__(self, argv, env, cwd):
            await super().__call__(argv, env, cwd)
            await asyncio.Event().wait()

    task = asyncio.ensure_future(go(tmp_path, npx_entry(), machine(), Hang()))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not tools_dir(tmp_path, "claude-acp").exists()
    assert ExpertStore(tmp_path).list() == []


async def test_a_node_download_failure_is_a_fact_and_records_nothing(tmp_path, monkeypatch):
    async def broken(*a, **k):
        raise OSError("offline")

    monkeypatch.setattr(install_mod, "ensure_node", broken)
    with pytest.raises(InstallError) as err:
        await go(tmp_path, npx_entry(), machine(), Npm())
    assert err.value.kind == "node_failed"
    assert ExpertStore(tmp_path).list() == []


async def test_progress_is_plain_dicts_ending_in_done(tmp_path, ensure):
    seen: list[dict] = []
    await go(tmp_path, npx_entry(), machine(), Npm(), progress=seen.append)
    assert all(isinstance(d, dict) and "stage" in d for d in seen)
    assert {"stage": "node", "percent": 50} in seen
    assert seen[-1]["stage"] == "done"


async def test_an_unsafe_id_is_refused_before_anything_is_written(tmp_path, ensure):
    entry = replace(npx_entry(), id="../evil")
    with pytest.raises(InstallError) as err:
        await go(tmp_path, entry, machine(), Npm())
    assert err.value.kind == "bad_id"
    assert list(tmp_path.iterdir()) == []


# ---- other kinds ----


async def test_no_build_for_this_machine_raises_no_build(tmp_path, ensure):
    with pytest.raises(NoBuild):
        await go(tmp_path, binary_entry("0" * 64), machine(os_name="macos", arch="arm64"), Npm())
    assert list(tmp_path.iterdir()) == []


async def test_uvx_expert_is_unsupported(tmp_path, ensure):
    entry = RegistryEntry("py", "Py", "1", "", "", [Distribution("uvx", "py-agent", "1")])
    with pytest.raises(Unsupported) as err:
        await go(tmp_path, entry, machine(), Npm())
    assert err.value.kind == "unsupported"


def make_zip(extra: dict[str, bytes] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("agent.exe", b"binary")
        for name, data in (extra or {}).items():
            z.writestr(name, data)
    return buf.getvalue()


def fetch_of(data: bytes):
    async def fetch(url):
        half = len(data) // 2
        yield data[:half]
        yield data[half:]

    return fetch


async def test_binary_distribution_verifies_sha256_and_extracts_safely(tmp_path):
    data = make_zip()
    entry = binary_entry(hashlib.sha256(data).hexdigest())
    expert = await go(tmp_path, entry, machine(), Npm(), fetch=fetch_of(data))
    exe = tools_dir(tmp_path, "bin-agent") / "agent.exe"
    assert exe.read_bytes() == b"binary"
    assert expert.command == [str(exe), "acp"]
    assert ExpertStore(tmp_path).get("bin-agent") == expert
    assert not (tmp_path / "tools" / "bin-agent.part").exists()


async def test_bad_sha256_raises_and_records_nothing(tmp_path):
    data = make_zip()
    with pytest.raises(InstallError) as err:
        await go(tmp_path, binary_entry("f" * 64), machine(), Npm(), fetch=fetch_of(data))
    assert err.value.kind == "integrity"
    assert ExpertStore(tmp_path).list() == []
    assert not tools_dir(tmp_path, "bin-agent").exists()
    assert not (tmp_path / "tools" / "bin-agent.part").exists()


async def test_a_binary_with_no_listed_checksum_is_refused(tmp_path):
    data = make_zip()
    with pytest.raises(InstallError) as err:
        await go(tmp_path, binary_entry(None), machine(), Npm(), fetch=fetch_of(data))
    assert err.value.kind == "integrity"


async def test_a_dotdot_member_is_refused_and_nothing_is_left(tmp_path):
    data = make_zip({"../evil.txt": b"x"})
    entry = binary_entry(hashlib.sha256(data).hexdigest())
    with pytest.raises(InstallError) as err:
        await go(tmp_path, entry, machine(), Npm(), fetch=fetch_of(data))
    assert err.value.kind == "unsafe_archive"
    assert not (tmp_path / "tools" / "evil.txt").exists()
    assert not tools_dir(tmp_path, "bin-agent").exists()
    assert ExpertStore(tmp_path).list() == []


async def test_a_download_that_breaks_midway_leaves_nothing(tmp_path):
    async def broken(url):
        yield b"abc"
        raise OSError("reset")

    with pytest.raises(InstallError) as err:
        await go(tmp_path, binary_entry("0" * 64), machine(), Npm(), fetch=broken)
    assert err.value.kind == "download_failed"
    assert not (tmp_path / "tools" / "bin-agent.part").exists()
    assert not tools_dir(tmp_path, "bin-agent").exists()


# ---- the Allow card and the tool ----


async def test_card_input_names_the_node_download_when_the_system_node_is_old(tmp_path):
    card = await install_card(npx_entry(), tmp_path, machine(), index_only)
    assert card["expert"] == "claude-acp" and card["version"] == "0.99.1"
    assert card["installs_into"] == str(tools_dir(tmp_path, "claude-acp"))
    assert card["node_download"] == {"version": "v22.12.0", "into": str(node_dir(tmp_path))}


async def test_card_input_has_no_node_download_when_the_system_node_will_do(tmp_path):
    card = await install_card(npx_entry(), tmp_path, machine(system_node(tmp_path)), no_json)
    assert card["node_download"] is None


class Net:
    async def __call__(self, url: str) -> bytes:
        return ACP if "agentclientprotocol" in url else NODE_INDEX


def make_tools(tmp_path, npm, mach=None):
    emitted: list[Event] = []
    notes: list[tuple[str, dict]] = []

    async def inspect_fn():
        return mach or machine()

    tools = expert_setup_tools(
        tmp_path,
        Registry(tmp_path, Net()),
        inspect_fn,
        ExpertStore(tmp_path),
        npm,
        no_fetch,
        Net(),
        emitted.append,
        lambda m, p: notes.append((m, p)),
    )
    return {s.name: (s, h) for s, h in tools}, emitted, notes


async def test_install_tool_returns_the_expert_and_emits_progress_without_waking(tmp_path, ensure):
    tools, emitted, notes = make_tools(tmp_path, Npm())
    out = json.loads(await tools["install_expert"][1]({"id": "claude-acp"}))
    assert out["id"] == "claude-acp" and out["command"][-1].endswith("index.js")
    assert {e.kind for e in emitted} == {"setup_progress"}
    assert all(e.key == "claude-acp" for e in emitted)
    assert emitted[0].facts["expert"] == "claude-acp" and "stage" in emitted[0].facts
    assert ("changed", {"what": "setup"}) in notes


async def test_install_tool_reports_failure_as_facts(tmp_path, ensure):
    tools, _, _ = make_tools(tmp_path, Npm(code=1))
    out = json.loads(await tools["install_expert"][1]({"id": "claude-acp"}))
    assert out["error"] == "npm_failed" and "detail" in out
    assert ExpertStore(tmp_path).list() == []


async def test_install_tool_knows_an_unknown_id(tmp_path, ensure):
    tools, _, _ = make_tools(tmp_path, Npm())
    out = json.loads(await tools["install_expert"][1]({"id": "nope"}))
    assert out == {"error": "unknown_expert", "detail": "nope"}


class StubAsks:
    def __init__(self, answer="allow"):
        self.answer = answer
        self.asked: list[dict] = []

    def anyone_online(self):
        return True

    async def permission(self, call, spec_name, locked):
        self.asked.append(call.input)
        return self.answer


async def test_install_tool_needs_the_allow_card_and_shows_the_node_download(tmp_path, ensure):
    tools, _, _ = make_tools(tmp_path, Npm())
    spec, handler = tools["install_expert"]
    # Never auto: not by default, not by effect, and no stored mode is needed to ask.
    assert spec.effect == "change" and spec.default_mode is None and not spec.self_asks
    assert resolve_mode(spec, None) == "ask"
    asks = StubAsks()
    box = RealToolbox([BrainSource([(spec, handler)])], lambda: {}, lambda n, m: None, asks)
    await box.run(Call("c1", "install_expert", {"id": "claude-acp"}, "t1", ""))
    assert asks.asked[0]["node_download"] is not None
    assert asks.asked[0]["expert"] == "claude-acp"


async def test_a_refused_card_installs_nothing(tmp_path, ensure):
    tools, _, _ = make_tools(tmp_path, Npm())
    spec, handler = tools["install_expert"]
    box = RealToolbox(
        [BrainSource([(spec, handler)])], lambda: {}, lambda n, m: None, StubAsks("deny")
    )
    with pytest.raises(RpcError):
        await box.run(Call("c1", "install_expert", {"id": "claude-acp"}, "t1", ""))
    assert ExpertStore(tmp_path).list() == []
    assert not (tmp_path / "tools").exists()
