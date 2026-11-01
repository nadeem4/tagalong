"""Checks the setup facts: paths under the home folder and the read-only machine inspection."""

import json
from pathlib import Path

from brain.setup.facts import CmdResult, inspect, node_paths
from brain.setup.paths import cache_file, experts_file, node_dir, tools_dir
from brain.setup.registry import Registry
from brain.setup.tools import setup_tools


def fake_run(table: dict[str, str]):
    """Answers `<exe> --version` from a table keyed by the exe's name; others raise."""

    async def run(argv, env, cwd):
        key = Path(argv[0]).stem
        if key not in table:
            raise FileNotFoundError(argv[0])
        return CmdResult(0, table[key], "")

    return run


def which_of(*names: str):
    return lambda name: f"/bin/{name}" if name in names else None


def linux():
    return ("Linux", "x86_64")


def test_paths_live_under_home(tmp_path):
    assert node_dir(tmp_path) == tmp_path / "runtime" / "node"
    assert tools_dir(tmp_path, "claude-acp") == tmp_path / "tools" / "claude-acp"
    assert cache_file(tmp_path, "acp") == tmp_path / "cache" / "acp-registry.json"
    assert experts_file(tmp_path) == tmp_path / "experts.json"


async def test_reports_os_and_arch(tmp_path):
    cases = [
        (("Windows", "AMD64"), ("windows", "x64")),
        (("Linux", "aarch64"), ("linux", "arm64")),
        (("Darwin", "arm64"), ("macos", "arm64")),
    ]
    for info, want in cases:
        m = await inspect(tmp_path, fake_run({}), lambda info=info: info, which_of())
        assert (m.os, m.arch) == want


async def test_parses_versions(tmp_path):
    run = fake_run(
        {
            "node": "v22.1.0\n",
            "npm": "10.8.2\n",
            "git": "git version 2.45.1.windows.1\n",
            "claude": "2.0.1 (Claude Code)\n",
        }
    )
    m = await inspect(tmp_path, run, linux, which_of("node", "npm", "git", "claude"))
    assert m.node.version == "22.1.0" and m.node.path == "/bin/node"
    assert m.npm.version == "10.8.2"
    assert m.git.version == "2.45.1"
    assert m.claude_code.version == "2.0.1"


async def test_missing_tool_is_none(tmp_path):
    m = await inspect(tmp_path, fake_run({"node": "v22.1.0"}), linux, which_of("node"))
    assert m.node is not None
    assert m.npm is None and m.git is None and m.claude_code is None


async def test_failing_probe_is_none_never_an_error(tmp_path):
    async def boom(argv, env, cwd):
        raise TimeoutError

    async def bad_exit(argv, env, cwd):
        return CmdResult(1, "", "no")

    for run in (boom, bad_exit):
        m = await inspect(tmp_path, run, linux, which_of("node", "git"))
        assert m.node is None and m.git is None


def make_private_node(home: Path) -> Path:
    exe = node_dir(home) / "bin" / "node"
    cli = node_dir(home) / "lib" / "node_modules" / "npm" / "bin" / "npm-cli.js"
    for p in (exe, cli):
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("")
    return exe


async def test_private_node_is_separate_from_system_node(tmp_path):
    exe = make_private_node(tmp_path)
    assert node_paths(tmp_path).node == exe

    async def run(argv, env, cwd):
        return CmdResult(0, "v24.0.0" if argv[0] == str(exe) else "v22.1.0", "")

    m = await inspect(tmp_path, run, linux, which_of("node"))
    assert m.node.version == "22.1.0"
    assert m.private_node.version == "24.0.0"


def test_no_private_node_when_npm_missing(tmp_path):
    exe = node_dir(tmp_path) / "bin" / "node"
    exe.parent.mkdir(parents=True)
    exe.write_text("")
    assert node_paths(tmp_path) is None


async def test_inspect_writes_nothing(tmp_path):
    await inspect(tmp_path, fake_run({"node": "v22.0.0"}), linux, which_of("node"))
    assert list(tmp_path.iterdir()) == []


async def test_inspect_machine_tool_is_json_and_read_only(tmp_path):
    async def inspect_fn():
        return await inspect(tmp_path, fake_run({}), linux, which_of())

    tools = {
        spec.name: (spec, h) for spec, h in setup_tools(tmp_path, Registry(tmp_path), inspect_fn)
    }
    spec, handler = tools["inspect_machine"]
    assert spec.effect == "read" and spec.default_mode == "auto"
    out = json.loads(await handler({}))
    assert out["machine"]["os"] == "linux" and out["machine"]["node"] is None
    assert out["experts"] == []
