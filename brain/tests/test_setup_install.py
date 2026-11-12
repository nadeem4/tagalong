"""Checks installing an expert from its registry entry, on fakes only.

No network, no npm, no Node download: the command runner, the fetch, the registry and the
private Node are all stand-ins, and the files npm would write are made by the fake runner.
"""

import asyncio
import hashlib
import io
import json
import logging
import os
import sys
import time
import zipfile
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from brain.events import Event
from brain.mind.turn import Call
from brain.open_items import OpenItems
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
from brain.setup.expert_tools import expert_setup_tools
from brain.setup.facts import CmdResult, Machine, NodePaths, ToolVersion
from brain.setup.home_tools import SetupProgress, home_setup_tools
from brain.setup.install import (
    InstallError,
    NoBuild,
    Unsupported,
    install_card,
    install_expert,
    sweep_staging,
)
from brain.setup.net import DOWNLOAD_SIZE
from brain.setup.paths import cache_file, node_dir, tools_dir
from brain.setup.registry import Distribution, Registry, RegistryEntry
from brain.setup.store import ExpertStore
from brain.setup.tools import setup_tools
from brain.store.db import open_db
from brain.toolbox import BrainSource
from brain.toolbox import Toolbox as RealToolbox

FIX = Path(__file__).parent / "fixtures"
ACP = (FIX / "acp-registry.sample.json").read_bytes()
NODE_INDEX = (FIX / "node-index.sample.json").read_bytes()
PKG = "@agentclientprotocol/claude-agent-acp"


def machine(node: ToolVersion | None = None, os_name="windows", arch="x64") -> Machine:
    return Machine(os_name, arch, node, None, None, None, None)


def npx_entry(requires=None, version="0.99.1", pinned="0.99.1") -> RegistryEntry:
    return RegistryEntry(
        "claude-acp",
        "Claude Agent",
        version,
        "",
        "",
        [Distribution("npx", PKG, pinned, args=["--acp"])],
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

    def __init__(self, code=0, bin_value=None, lines=()):
        self.lines = list(lines)  # what npm would print, fed to the caller as it goes
        self.calls: list[tuple[list[str], dict, Path | None]] = []
        self.code = code
        self.bin_value = {"claude-agent-acp": "dist/index.js"} if bin_value is None else bin_value

    async def __call__(self, argv, env, cwd, on_line=None):
        self.calls.append((argv, dict(env), cwd))
        for line in self.lines if on_line else ():
            on_line(line)
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
    staged = tools_dir(tmp_path, "claude-acp.part")  # swapped into place only on success
    assert argv[0] == str(node_dir(tmp_path) / "node.exe")
    assert argv[1].endswith("npm-cli.js")
    assert argv[2:] == ["install", "--prefix", str(staged), f"{PKG}@0.99.1"]
    assert cwd == staged
    assert not staged.exists() and prefix.is_dir()
    assert env["PATH"].startswith(str(node_dir(tmp_path)) + os.pathsep)  # child only
    assert ensure.calls == [22]
    js = prefix / "node_modules" / "@agentclientprotocol" / "claude-agent-acp" / "dist" / "index.js"
    assert expert.command == [argv[0], str(js), "--acp"]
    assert (expert.id, expert.name, expert.version) == ("claude-acp", "Claude Agent", "0.99.1")
    assert expert.source == "registry" and expert.logged_in is None
    assert expert.node == "private"
    assert ExpertStore(tmp_path).get("claude-acp") == expert


async def test_npm_install_emits_stages(tmp_path, ensure):
    lines = [
        "npm http fetch GET 200 https://registry.npmjs.org/pkg 40ms (cache miss)",
        "npm http fetch GET 200 https://registry.npmjs.org/pkg/-/pkg-1.tgz 90ms",
        "npm http fetch GET 200 https://registry.npmjs.org/dep 30ms",
    ]
    seen: list[dict] = []
    await go(tmp_path, npx_entry(), machine(), Npm(lines=lines), progress=seen.append)
    stages = [d["stage"] for d in seen]
    assert "installing" not in stages
    npm_stages = [s for s in stages if s in ("resolving", "fetching", "finishing")]
    assert npm_stages == ["resolving", "fetching", "finishing"]  # once each, in order
    assert stages[-1] == "done"


async def test_a_string_bin_is_used_as_is(tmp_path, ensure):
    expert = await go(tmp_path, npx_entry(), machine(), Npm(bin_value="dist/index.js"))
    assert expert.command[1].endswith("index.js")


async def test_system_node_new_enough_is_used_and_no_download_happens(tmp_path, ensure):
    npm = Npm()
    node = system_node(tmp_path)
    await go(tmp_path, npx_entry(), machine(node), npm)
    assert ensure.calls == []
    assert npm.calls[0][0][0] == node.path
    assert ExpertStore(tmp_path).get("claude-acp").node == "system"


async def test_old_system_node_triggers_ensure_node_with_the_floor_of_22(tmp_path, ensure):
    npm = Npm()
    node = system_node(tmp_path, "18.20.0")
    await go(tmp_path, npx_entry({"node": "24"}), machine(node), npm)  # the entry's say is ignored
    assert ensure.calls == [22]
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
    assert not tools_dir(tmp_path, "claude-acp.part").exists()


async def test_npm_gets_a_minimal_env_without_keys_or_npm_config(tmp_path, ensure, monkeypatch):
    for name, value in {
        "ANTHROPIC_API_KEY": "sk-secret",
        "CLAUDE_CODE_USE_BEDROCK": "1",
        "OPENAI_API_KEY": "sk-o",
        "GEMINI_API_KEY": "g",
        "GOOGLE_API_KEY": "g2",
        "CODEX_HOME": "c",
        "npm_config_global": "true",
        "NPM_CONFIG_PREFIX": "/elsewhere",
        "SOMETHING_ELSE": "x",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("PATH", "/usr/bin")
    monkeypatch.setenv("TEMP", "/tmp/t")
    npm = Npm()
    await go(tmp_path, npx_entry(), machine(), npm)
    env = npm.calls[0][1]
    assert not [k for k in env if k.upper().startswith(("ANTHROPIC", "CLAUDE_CODE_USE", "OPENAI"))]
    assert not [k for k in env if k.upper().startswith(("GEMINI", "GOOGLE", "CODEX"))]
    assert "SOMETHING_ELSE" not in env
    assert "npm_config_global" not in env and "NPM_CONFIG_PREFIX" not in env
    assert env["PATH"] == str(node_dir(tmp_path)) + os.pathsep + "/usr/bin"
    assert env["TEMP"] == "/tmp/t"
    assert env["npm_config_update_notifier"] == "false"


async def test_a_failed_reinstall_keeps_the_old_install_and_record(tmp_path, ensure):
    await go(tmp_path, npx_entry(), machine(), Npm())
    old = tools_dir(tmp_path, "claude-acp")
    (old / "marker").write_text("v1")
    with pytest.raises(InstallError):
        await go(tmp_path, npx_entry(version="0.99.2", pinned="0.99.2"), machine(), Npm(code=1))
    assert (old / "marker").read_text() == "v1"
    assert ExpertStore(tmp_path).get("claude-acp").version == "0.99.1"
    assert not tools_dir(tmp_path, "claude-acp.part").exists()


async def test_a_good_reinstall_swaps_in_the_new_files_and_record(tmp_path, ensure):
    await go(tmp_path, npx_entry(), machine(), Npm())
    old = tools_dir(tmp_path, "claude-acp")
    (old / "marker").write_text("v1")
    expert = await go(tmp_path, npx_entry(version="0.99.2", pinned="0.99.2"), machine(), Npm())
    assert not (old / "marker").exists()
    assert expert.command[1].startswith(str(old))  # resolved against the final prefix
    assert Path(expert.command[1]).is_file()
    assert ExpertStore(tmp_path).get("claude-acp").version == "0.99.2"
    assert sorted(p.name for p in old.parent.iterdir() if p.name != "claude-acp") == []


async def test_a_reinstall_keeps_the_experts_login(tmp_path, ensure):
    await go(tmp_path, npx_entry(), machine(), Npm())
    ExpertStore(tmp_path).set_login("claude-acp", True)
    expert = await go(tmp_path, npx_entry(version="0.99.2", pinned="0.99.2"), machine(), Npm())
    assert expert.logged_in is True
    assert ExpertStore(tmp_path).get("claude-acp").logged_in is True


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
        async def __call__(self, argv, env, cwd, on_line=None):
            await super().__call__(argv, env, cwd, on_line)
            await asyncio.Event().wait()

    task = asyncio.ensure_future(go(tmp_path, npx_entry(), machine(), Hang()))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not tools_dir(tmp_path, "claude-acp").exists()
    assert not tools_dir(tmp_path, "claude-acp.part").exists()
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


async def test_download_reports_percent(tmp_path):
    data = make_zip({"pad.bin": b"x" * 5000})
    entry = binary_entry(hashlib.sha256(data).hexdigest())

    async def fetch(url):
        DOWNLOAD_SIZE.set(len(data))  # what the response's Content-Length would say
        step = len(data) // 100 + 1
        for i in range(0, len(data), step):
            yield data[i : i + step]

    seen: list[dict] = []
    await go(tmp_path, entry, machine(), Npm(), fetch=fetch, progress=seen.append)
    percents = [d["percent"] for d in seen if d["stage"] == "downloading" and "percent" in d]
    assert percents == sorted(percents) and percents[-1] == 100
    assert 2 <= len(percents) <= 22  # throttled: a step of 5 or more, not one per chunk
    assert [d["stage"] for d in seen][-2:] == ["extracting", "done"]


async def test_download_without_a_size_reports_the_stage_only(tmp_path):
    data = make_zip()
    entry = binary_entry(hashlib.sha256(data).hexdigest())
    seen: list[dict] = []
    await go(tmp_path, entry, machine(), Npm(), fetch=fetch_of(data), progress=seen.append)
    assert {"stage": "downloading"} in seen
    assert not [d for d in seen if d["stage"] == "downloading" and "percent" in d]


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
    # `build_for` never offers one, so this is the last guard, reached only directly.
    dist = binary_entry(None).distributions[0]
    with pytest.raises(InstallError) as err:
        await install_mod._binary_install(
            dist, tmp_path / "s", tmp_path / "f", tmp_path / "d", no_fetch, lambda d: None
        )
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


async def test_card_input_marks_the_recommended_expert(tmp_path):
    card = await install_card(npx_entry(), tmp_path, machine(), index_only)
    assert card["recommended"] is True  # npx_entry() is claude-acp, the recommended one


async def test_card_and_install_use_the_pinned_version_not_the_entrys(tmp_path, ensure):
    entry = npx_entry(version="0.99.9", pinned="0.99.1")
    card = await install_card(entry, tmp_path, machine(), index_only)
    npm = Npm()
    expert = await go(tmp_path, entry, machine(), npm)
    assert card["version"] == "0.99.1" and expert.version == "0.99.1"
    assert npm.calls[0][0][-1] == f"{PKG}@0.99.1"


async def test_an_unpinned_npm_package_is_pinned_to_the_entrys_version(tmp_path, ensure):
    entry = npx_entry(version="0.99.5", pinned=None)
    npm = Npm()
    await go(tmp_path, entry, machine(), npm)
    assert npm.calls[0][0][-1] == f"{PKG}@0.99.5"


async def test_card_input_has_no_node_download_when_the_system_node_will_do(tmp_path):
    card = await install_card(npx_entry(), tmp_path, machine(system_node(tmp_path)), no_json)
    assert card["node_download"] is None


class Net:
    async def __call__(self, url: str) -> bytes:
        return ACP if "agentclientprotocol" in url else NODE_INDEX


def new_items(tmp_path) -> OpenItems:
    return OpenItems(open_db(tmp_path / "items.db"), lambda: datetime.now(UTC))


def make_tools(tmp_path, npm, mach=None, updaters=None, items=None):
    emitted: list[Event] = []
    notes: list[tuple[str, dict]] = []

    async def inspect_fn():
        return mach or machine()

    tools, update, stop = expert_setup_tools(
        tmp_path,
        Registry(tmp_path, Net()),
        inspect_fn,
        ExpertStore(tmp_path),
        npm,
        no_fetch,
        Net(),
        emitted.append,
        lambda m, p: notes.append((m, p)),
        items or new_items(tmp_path),
    )
    if updaters is not None:
        updaters.append(update)
    return {s.name: (s, h) for s, h in tools}, emitted, notes, stop


async def settled(emitted: list[Event], kind="setup_done"):
    for _ in range(400):
        if any(e.kind == kind for e in emitted):
            return next(e for e in emitted if e.kind == kind)
        await asyncio.sleep(0.01)
    raise AssertionError(f"no {kind} event")


class Hang(Npm):
    def __init__(self):
        super().__init__()
        self.started = asyncio.Event()

    async def __call__(self, argv, env, cwd, on_line=None):
        await super().__call__(argv, env, cwd, on_line)
        self.started.set()
        await asyncio.Event().wait()


async def test_install_tool_returns_at_once_and_the_install_finishes_in_the_background(
    tmp_path, ensure
):
    tools, emitted, notes, stop = make_tools(tmp_path, Npm())
    out = json.loads(await tools["install_expert"][1]({"id": "claude-acp"}))
    assert out["started"] == "claude-acp"
    done = await settled(emitted)
    assert done.facts["expert"] == "claude-acp" and done.facts["ok"] is True
    assert json.loads(done.facts["installed"])["id"] == "claude-acp"
    assert done.key == "claude-acp"
    assert ExpertStore(tmp_path).get("claude-acp") is not None
    progress = [e for e in emitted if e.kind == "setup_progress"]
    assert progress and all(e.key == "claude-acp" for e in progress)
    assert progress[0].facts["expert"] == "claude-acp" and "stage" in progress[0].facts
    assert ("changed", {"what": "setup"}) in notes
    await stop()


async def test_setup_done_is_a_waking_kind_with_a_note():
    from brain.events import EVENT_KINDS, load_notes

    assert EVENT_KINDS["setup_done"].wakes
    assert EVENT_KINDS["setup_done"].batch_seconds is None
    assert load_notes()["setup_done"].strip()
    assert not EVENT_KINDS["setup_progress"].wakes


async def test_install_failure_arrives_as_setup_done_facts(tmp_path, ensure):
    tools, emitted, _, stop = make_tools(tmp_path, Npm(code=1))
    out = json.loads(await tools["install_expert"][1]({"id": "claude-acp"}))
    assert out["started"] == "claude-acp"
    done = await settled(emitted)
    assert done.facts["ok"] is False and done.facts["error"] == "npm_failed"
    assert "detail" in done.facts
    assert ExpertStore(tmp_path).list() == []
    await stop()


async def test_install_failure_is_logged(tmp_path, ensure, caplog):
    tools, emitted, _, stop = make_tools(tmp_path, Npm(code=1))
    with caplog.at_level(logging.WARNING, logger="brain.setup.expert_tools"):
        await tools["install_expert"][1]({"id": "claude-acp"})
        await settled(emitted)
    warned = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warned) == 1 and all(t in warned[0] for t in ("claude-acp", "npm_failed", "npm ERR"))
    await stop()


async def test_install_tool_knows_an_unknown_id(tmp_path, ensure):
    tools, _, _, _ = make_tools(tmp_path, Npm())
    out = json.loads(await tools["install_expert"][1]({"id": "nope"}))
    assert out == {"error": "unknown_expert", "detail": "nope"}


async def test_second_install_request_joins_first(tmp_path, ensure):
    hang, items = Hang(), new_items(tmp_path)
    tools, emitted, _, stop = make_tools(tmp_path, hang, items=items)
    handler = tools["install_expert"][1]
    first = json.loads(await handler({"id": "claude-acp"}))
    assert first["started"] == "claude-acp" and "joined" not in first
    await asyncio.wait_for(hang.started.wait(), 5)
    again = json.loads(await handler({"id": "claude-acp"}))
    assert again == {**first, "joined": True}  # the same open item, not a second install
    item = items.get(first["item"])
    assert item.kind == "install" and item.state == "open"
    await stop()
    assert items.get(first["item"]).state == "expired"  # shutdown ends the flight's item


async def test_a_finished_install_closes_its_item_and_the_next_is_new(tmp_path, ensure):
    items = new_items(tmp_path)
    tools, emitted, _, _ = make_tools(tmp_path, Npm(), items=items)
    handler = tools["install_expert"][1]
    first = json.loads(await handler({"id": "claude-acp"}))
    await settled(emitted)
    for _ in range(100):  # the item closes with the task, just after the event
        if items.get(first["item"]).state == "done":
            break
        await asyncio.sleep(0.01)
    assert items.get(first["item"]).state == "done"
    second = json.loads(await handler({"id": "claude-acp"}))
    assert second["item"] != first["item"] and "joined" not in second


async def test_brain_shutdown_cancels_a_running_install_and_cleans_up(tmp_path, ensure):
    hang = Hang()
    tools, emitted, _, stop = make_tools(tmp_path, hang)
    await tools["install_expert"][1]({"id": "claude-acp"})
    await asyncio.wait_for(hang.started.wait(), 5)
    assert tools_dir(tmp_path, "claude-acp.part").exists()
    await stop()
    assert not tools_dir(tmp_path, "claude-acp.part").exists()
    assert not tools_dir(tmp_path, "claude-acp").exists()
    assert ExpertStore(tmp_path).list() == []
    assert not [e for e in emitted if e.kind == "setup_done"]  # nobody is left to tell


class StubAsks:
    def __init__(self, answer="allow"):
        self.answer = answer
        self.asked: list[dict] = []

    def anyone_online(self):
        return True

    async def permission(self, call, spec_name, locked, **ids):
        self.asked.append(call.input)
        self.locked = locked
        return self.answer


def person_engine():
    return Engine([Person()], None, None, lambda n: None)


async def test_install_tool_needs_the_allow_card_and_shows_the_node_download(tmp_path, ensure):
    tools, emitted, _, stop = make_tools(tmp_path, Npm())
    spec, handler = tools["install_expert"]
    # Only the person can allow it: no Always, no stored mode, no preference.
    assert spec.effect == "change" and spec.default_mode is None
    assert spec.tier is Tier.person_only
    assert resolve_mode(spec, None) == "ask" and resolve_mode(spec, "auto") == "ask"
    asks = StubAsks()
    box = RealToolbox(
        [BrainSource([(spec, handler)])],
        lambda: {},
        lambda n, m: None,
        asks,
        engine=person_engine(),
    )
    await box.run(Call("c1", "install_expert", {"id": "claude-acp"}, "t1", ""))
    assert asks.asked[0]["node_download"] is not None
    assert asks.asked[0]["expert"] == "claude-acp"
    assert asks.locked  # the card offers no Always
    await settled(emitted)
    await stop()


async def test_a_preference_and_a_stored_auto_still_reach_the_person(tmp_path, ensure):
    class Side:
        def __init__(self):
            self.asked = 0

        async def decide(self, facts):
            self.asked += 1
            return "any-pref"

    tools, emitted, _, stop = make_tools(tmp_path, Npm())
    spec, handler = tools["install_expert"]
    side = Side()
    asks = StubAsks()
    modes = lambda: {"install_expert": "auto"}  # noqa: E731
    engine = Engine(
        [StandingRule(stored_auto_rules(modes)), SideCheckDecider(side), Person()],
        None,
        None,
        lambda n: None,
    )
    box = RealToolbox(
        [BrainSource([(spec, handler)])], modes, lambda n, m: None, asks, engine=engine
    )
    await box.run(Call("c1", "install_expert", {"id": "claude-acp"}, "t1", ""))
    assert asks.asked and side.asked == 0
    await settled(emitted)
    await stop()


async def test_a_refused_card_installs_nothing(tmp_path, ensure):
    tools, _, _, stop = make_tools(tmp_path, Npm())
    spec, handler = tools["install_expert"]
    box = RealToolbox(
        [BrainSource([(spec, handler)])],
        lambda: {},
        lambda n, m: None,
        StubAsks("deny"),
        engine=person_engine(),
    )
    with pytest.raises(RpcError):
        await box.run(Call("c1", "install_expert", {"id": "claude-acp"}, "t1", ""))
    assert ExpertStore(tmp_path).list() == []
    assert not (tmp_path / "tools").exists()
    await stop()


async def test_install_refuses_when_the_registry_version_changed_after_the_card(
    tmp_path, ensure, monkeypatch
):
    tools, emitted, _, stop = make_tools(tmp_path, Npm())
    spec, handler = tools["install_expert"]
    shown = await spec.card({"id": "claude-acp"})
    assert shown["version"] == "0.99.1"
    # The 24 h cache expired while the card was open, and the registry moved on.
    cache_file(tmp_path, "acp").unlink()
    monkeypatch.setattr(sys.modules[__name__], "ACP", ACP.replace(b"0.99.1", b"1.0.0"))
    out = json.loads(await handler({"id": "claude-acp"}))
    assert out == {"error": "version_changed", "detail": "0.99.1 -> 1.0.0"}
    assert not [e for e in emitted if e.kind == "setup_done"]
    await stop()


async def test_the_card_of_a_second_install_still_shows_and_the_handler_joins(tmp_path, ensure):
    hang = Hang()
    tools, _, _, stop = make_tools(tmp_path, hang)
    spec, handler = tools["install_expert"]
    await handler({"id": "claude-acp"})
    await asyncio.wait_for(hang.started.wait(), 5)
    assert (await spec.card({"id": "claude-acp"}))["version"] == "0.99.1"  # no refusal first
    assert json.loads(await handler({"id": "claude-acp"}))["joined"] is True
    await stop()


def test_a_start_sweeps_staging_folders_a_killed_brain_left_behind(tmp_path):
    long_ago = time.time() - 3600
    for name in ("claude-acp.part", "claude-acp.dl"):
        tools_dir(tmp_path, name).mkdir(parents=True)
        os.utime(tools_dir(tmp_path, name), (long_ago, long_ago))
    fresh = tools_dir(tmp_path, "other.part")  # a CLI install may be staging this right now
    fresh.mkdir()
    kept = tools_dir(tmp_path, "claude-acp")
    kept.mkdir()
    sweep_staging(tmp_path)
    assert not tools_dir(tmp_path, "claude-acp.part").exists()
    assert not tools_dir(tmp_path, "claude-acp.dl").exists()
    assert fresh.exists() and kept.exists()
    sweep_staging(tmp_path / "nowhere")  # no tools folder yet: nothing to do


# ---- a binary with no checksum is never offered (it could only fail at install) ----

NO_SUM_ACP = json.dumps(
    {
        "agents": [
            {
                "id": "bin-agent",
                "name": "Bin Agent",
                "version": "1.0.0",
                "description": "d",
                "license": "MIT",
                "distribution": {
                    "binary": {
                        "windows-x86_64": {"archive": "https://x.invalid/a.zip", "cmd": "./a.exe"}
                    }
                },
            }
        ]
    }
).encode()


class _NoWhy:
    async def line(self, entry):
        return ""


@pytest.mark.parametrize("where", ["home_list", "find_experts", "install"])
async def test_binary_without_checksum_is_never_offered(tmp_path, where):
    async def get(url: str) -> bytes:
        return NO_SUM_ACP if "agentclientprotocol" in url else b'{"servers": []}'

    async def inspect():
        return machine()

    reg = Registry(tmp_path, get)
    if where == "home_list":
        tools = {
            s.name: h
            for s, h in home_setup_tools(
                reg,
                inspect,
                lambda: [],
                lambda: [],
                None,
                None,
                [],
                SetupProgress(lambda e: None),
                _NoWhy(),
            )
        }
        assert json.loads(await tools["setup_overview"]({}))["browse_experts"] == []
    elif where == "find_experts":
        tools = {s.name: h for s, h in setup_tools(tmp_path, reg, inspect)}
        assert json.loads(await tools["find_experts"]({}))["experts"] == []
    else:
        with pytest.raises(NoBuild):
            await go(tmp_path, binary_entry(None), machine(), Npm())


async def test_an_update_is_refused_while_an_install_of_the_same_expert_runs(tmp_path, ensure):
    hang, updaters = Hang(), []
    tools, _, _, stop = make_tools(tmp_path, hang, updaters=updaters)
    await tools["install_expert"][1]({"id": "claude-acp"})
    await asyncio.wait_for(hang.started.wait(), 5)
    with pytest.raises(InstallError) as err:
        await updaters[0](npx_entry())
    assert err.value.kind == "already_installing"
    await stop()


async def test_an_install_joins_an_update_of_the_same_expert_that_runs(tmp_path, ensure):
    hang, updaters = Hang(), []
    tools, _, _, stop = make_tools(tmp_path, hang, updaters=updaters)
    updating = asyncio.ensure_future(updaters[0](npx_entry()))
    await asyncio.wait_for(hang.started.wait(), 5)
    again = json.loads(await tools["install_expert"][1]({"id": "claude-acp"}))
    assert again["joined"] is True  # one npm run for the expert, never two on one .part folder
    await stop()
    await asyncio.gather(updating, return_exceptions=True)


async def test_an_update_installs_and_frees_the_guard(tmp_path, ensure):
    updaters = []
    tools, _, _, _ = make_tools(tmp_path, Npm(), updaters=updaters)
    expert = await updaters[0](npx_entry())
    assert expert.id == "claude-acp"
    again = json.loads(await tools["install_expert"][1]({"id": "claude-acp"}))
    assert again["started"] == "claude-acp" and "joined" not in again
