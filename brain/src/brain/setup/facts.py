"""Read-only facts about this machine: OS, CPU and the tools Scout may need.

Every probe is `<tool> --version`; a missing or failing tool is None, never an error. The
command runner is a seam (`RunCmd`) so tests never start a real process.
"""

import asyncio
import os
import platform as _platform
import re
import shutil
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from brain.experts import kill_tree
from brain.setup.paths import node_dir

PROBE_TIMEOUT_S = 10.0


@dataclass(frozen=True)
class CmdResult:
    code: int
    out: str
    err: str


RunCmd = Callable[[list[str], Mapping[str, str], Path | None], Awaitable[CmdResult]]


async def real_run_cmd(
    argv: list[str],
    env: Mapping[str, str],
    cwd: Path | None,
    timeout: float = PROBE_TIMEOUT_S,
) -> CmdResult:
    """The only place a setup command starts a process: no shell. The default timeout suits a
    `--version` probe; an install passes a longer one."""
    proc = await asyncio.create_subprocess_exec(
        *argv,
        env=dict(env),
        cwd=cwd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except BaseException:
        # A timeout, a cancel or anything else: npm and the scripts it started die with it.
        await asyncio.shield(kill_tree(proc))
        raise
    return CmdResult(
        proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")
    )


@dataclass(frozen=True)
class ToolVersion:
    version: str
    path: str


@dataclass(frozen=True)
class NodePaths:
    node: Path
    npm_cli: Path


@dataclass(frozen=True)
class Machine:
    os: Literal["windows", "linux", "macos"]
    arch: Literal["x64", "arm64"]
    node: ToolVersion | None
    private_node: ToolVersion | None
    npm: ToolVersion | None
    git: ToolVersion | None
    claude_code: ToolVersion | None


_OS = {"windows": "windows", "linux": "linux", "darwin": "macos"}
_ARCH = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}
_VERSION = re.compile(r"\d+(?:\.\d+)+")


def node_paths(home: Path) -> NodePaths | None:
    """Tagalong's own Node and the npm that came with it, or None when either is missing."""
    root = node_dir(home)
    for node, cli in (
        (root / "node.exe", root / "node_modules" / "npm" / "bin" / "npm-cli.js"),
        (root / "bin" / "node", root / "lib" / "node_modules" / "npm" / "bin" / "npm-cli.js"),
    ):
        if node.is_file() and cli.is_file():
            return NodePaths(node, cli)
    return None


async def _probe(run: RunCmd, exe: str, env: Mapping[str, str]) -> ToolVersion | None:
    try:
        result = await run([exe, "--version"], env, None)
    except Exception:  # missing, timed out or crashed: all just "not there"
        return None
    match = _VERSION.search(result.out) if result.code == 0 else None
    return ToolVersion(match.group(0), exe) if match else None


async def inspect(
    home: Path,
    run: RunCmd = real_run_cmd,
    platform_info: Callable[[], tuple[str, str]] = lambda: (
        _platform.system(),
        _platform.machine(),
    ),
    which: Callable[[str], str | None] = shutil.which,
) -> Machine:
    """What this machine has. Reads only; writes nothing."""
    system, cpu = platform_info()
    env = dict(os.environ)

    async def tool(name: str) -> ToolVersion | None:
        path = which(name)
        return await _probe(run, path, env) if path else None

    private = node_paths(home)

    async def private_probe() -> ToolVersion | None:
        return await _probe(run, str(private.node), env) if private else None

    node, private_node, npm, git, claude = await asyncio.gather(
        tool("node"), private_probe(), tool("npm"), tool("git"), tool("claude")
    )
    return Machine(
        os=_OS.get(system.lower(), "linux"),
        arch=_ARCH.get(cpu.lower(), "x64"),
        node=node,
        private_node=private_node,
        npm=npm,
        git=git,
        claude_code=claude,
    )
