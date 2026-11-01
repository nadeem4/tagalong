"""Install an expert from its registry entry into `<home>/tools/<id>`, never anywhere global.

An npx entry runs `npm install --prefix` with a Node (the system one if new enough, else
Tagalong's own); a binary entry is downloaded, hash-checked and safely extracted. Everything is
staged in `tools/<id>.part` and swapped into place only on success, so a failure or cancel
leaves the old install and record (or nothing) and never a half-installed expert.
Failures are `InstallError(kind, detail)`: facts for Scout to word, not sentences.
"""

import asyncio
import hashlib
import json
import os
import re
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from brain.setup.archive import UnsafeArchive, safe_extract
from brain.setup.facts import Machine, NodePaths, RunCmd, node_paths
from brain.setup.net import GetJson
from brain.setup.node_runtime import (
    DIST,
    NodeBuildMissing,
    NodeIntegrityError,
    NodeInUse,
    ensure_node,
    pick_build,
)
from brain.setup.paths import node_dir, tools_dir
from brain.setup.registry import Distribution, RegistryEntry, build_for
from brain.setup.store import ExpertStore, InstalledExpert
from brain.voice.models import Fetch

NODE_FLOOR = 22  # the highest floor of the experts checked in the 20a spike; one for all
NPM_TIMEOUT_S = 900.0
# What npm may see of our environment: enough to run and reach the network, never a key.
_ENV_KEEP = frozenset(
    name.upper()
    for name in (
        "PATH SystemRoot windir ComSpec PATHEXT TEMP TMP HOME USERPROFILE APPDATA LOCALAPPDATA "
        "ProgramData TMPDIR LANG HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY"
    ).split()
)
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")


class InstallError(Exception):
    def __init__(self, kind: str, detail: str = "") -> None:
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.detail = detail


class NoBuild(InstallError):
    """The registry has no way to run this expert on this computer."""

    def __init__(self, detail: str = "") -> None:
        super().__init__("no_build", detail)


class Unsupported(InstallError):
    """The expert ships in a form Tagalong does not install (uvx, hosted)."""

    def __init__(self, detail: str = "") -> None:
        super().__init__("unsupported", detail)


def _major(version: str) -> int:
    return int(version.lstrip("v").split(".")[0])


def _plan(entry: RegistryEntry, machine: Machine) -> Distribution:
    """The distribution to install, or NoBuild / Unsupported / bad_id as facts."""
    if not _ID.fullmatch(entry.id):
        raise InstallError("bad_id", "the registry id is not a safe folder name")
    dist = build_for(entry, machine)
    if dist is None:
        raise NoBuild(f"{machine.os}-{machine.arch}")
    if dist.kind not in ("npx", "binary"):
        raise Unsupported(dist.kind)
    return dist


def _usable_system_node(machine: Machine) -> NodePaths | None:
    """The system Node and its own npm, when new enough; None sends us to Tagalong's Node."""
    found = machine.node
    if found is None or _major(found.version) < NODE_FLOOR:
        return None
    node = Path(found.path)
    for cli in (
        node.parent / "node_modules" / "npm" / "bin" / "npm-cli.js",  # Windows
        node.parent.parent / "lib" / "node_modules" / "npm" / "bin" / "npm-cli.js",  # unix
    ):
        if cli.is_file():
            return NodePaths(node, cli)
    return None


def _private_ok(home: Path, machine: Machine) -> bool:
    mine = machine.private_node
    return mine is not None and _major(mine.version) >= NODE_FLOOR and node_paths(home) is not None


async def install_card(
    entry: RegistryEntry, home: Path, machine: Machine, get_json: GetJson
) -> dict:
    """Facts for the Allow card, so it names everything the install will download."""
    dist = _plan(entry, machine)
    download = None
    if dist.kind == "npx":
        if _usable_system_node(machine) is None and not _private_ok(home, machine):
            build = pick_build(
                json.loads(await get_json(f"{DIST}/index.json")),
                NODE_FLOOR,
                machine.os,
                machine.arch,
            )
            if build is None:
                raise InstallError("node_failed", "no official Node for this computer")
            download = {"version": build.version, "into": str(node_dir(home))}
    return {
        "expert": entry.id,
        "version": entry.version,
        "node_download": download,
        "installs_into": str(tools_dir(home, entry.id)),
    }


def _rm(folders: tuple[Path, ...]) -> None:
    for folder in folders:
        shutil.rmtree(folder, ignore_errors=True)


async def _clean(*folders: Path) -> None:
    await asyncio.to_thread(_rm, folders)  # a big tree must not stall the loop


def _swap(staged: Path, final: Path, old: Path) -> None:
    """Move the staged tree into place, keeping the old one at `old` until the record is saved."""
    shutil.rmtree(old, ignore_errors=True)
    had_old = final.exists()
    if had_old:
        os.replace(final, old)
    try:
        os.replace(staged, final)
    except OSError:
        if had_old:
            os.replace(old, final)
        raise


def _unswap(final: Path, old: Path) -> None:
    shutil.rmtree(final, ignore_errors=True)
    if old.exists():
        os.replace(old, final)


async def _commit(
    expert: InstalledExpert, staged: Path, final: Path, old: Path, store: ExpertStore
) -> None:
    """Swap in the new files, then the record; either both happen or the old install stays."""
    try:
        await asyncio.to_thread(_swap, staged, final, old)
    except OSError as err:  # on Windows, a running expert holds its folder open
        raise InstallError("swap_failed", f"{type(err).__name__}: {err}") from err
    try:
        store.add(expert)
    except BaseException:
        await asyncio.to_thread(_unswap, final, old)
        raise
    await _clean(old)


async def install_expert(
    entry: RegistryEntry,
    home: Path,
    machine: Machine,
    run: RunCmd,
    fetch: Fetch,
    get_json: GetJson,
    store: ExpertStore,
    on_progress: Callable[[dict], None],
) -> InstalledExpert:
    dist = _plan(entry, machine)
    on_progress({"stage": "checking"})
    node, node_kind = None, None
    if dist.kind == "npx":
        node, node_kind = await _node_for(home, machine, fetch, get_json, on_progress)
    final, staged = tools_dir(home, entry.id), tools_dir(home, entry.id + ".part")
    download, old = tools_dir(home, entry.id + ".dl"), tools_dir(home, entry.id + ".old")
    await _clean(staged, download, old)
    # Nothing touches `final` or the record until the new files are complete: a failure or a
    # cancel here removes only what was staged.
    try:
        if node is not None:
            command = await _npm_install(dist, staged, final, node, run, on_progress)
        else:
            command = await _binary_install(dist, staged, final, download, fetch, on_progress)
        await _clean(download)
    except BaseException:
        await asyncio.shield(_clean(staged, download))
        raise
    expert = InstalledExpert(
        entry.id, entry.name, entry.version, command, "registry", None, node_kind
    )
    try:
        # Shielded: a cancel from here on still finishes the swap and the record together.
        await asyncio.shield(_commit(expert, staged, final, old, store))
    except InstallError:
        await asyncio.shield(_clean(staged))
        raise
    on_progress({"stage": "done"})
    return expert


async def _node_for(
    home: Path, machine: Machine, fetch: Fetch, get_json: GetJson, on_progress
) -> tuple[NodePaths, Literal["private", "system"]]:
    if (system := _usable_system_node(machine)) is not None:
        return system, "system"
    on_progress({"stage": "node", "percent": 0})
    try:
        private = await ensure_node(
            home,
            NODE_FLOOR,
            fetch,
            get_json,
            machine.os,
            machine.arch,
            lambda f: on_progress({"stage": "node", "percent": int(f * 100)}),
        )
    except (NodeBuildMissing, NodeIntegrityError, NodeInUse, UnsafeArchive, OSError) as err:
        raise InstallError("node_failed", f"{type(err).__name__}: {err}") from err
    return private, "private"


def _npm_env(node: Path) -> dict[str, str]:
    """A minimal environment for npm alone: the OS essentials and the chosen Node first on PATH
    (so install scripts find the same Node), and no key and no `npm_config_*` of the person's.
    Our real environment is never touched."""
    env = {k: v for k, v in os.environ.items() if k.upper() in _ENV_KEEP}
    env["PATH"] = str(node.parent) + os.pathsep + env.get("PATH", "")
    env.update(
        npm_config_update_notifier="false", npm_config_fund="false", npm_config_audit="false"
    )
    return env


async def _npm_install(
    dist: Distribution, staged: Path, final: Path, node: NodePaths, run: RunCmd, on_progress
) -> list[str]:
    on_progress({"stage": "installing"})
    staged.mkdir(parents=True)
    spec = f"{dist.package}@{dist.version}" if dist.version else str(dist.package)
    argv = [str(node.node), str(node.npm_cli), "install", "--prefix", str(staged), spec]
    try:
        result = await run(argv, _npm_env(node.node), staged)
    except (OSError, TimeoutError) as err:
        raise InstallError("npm_failed", f"{type(err).__name__}: {err}") from err
    if result.code != 0:
        raise InstallError("npm_failed", (result.err or result.out).strip()[-400:])
    return [str(node.node), str(_bin_js(staged, final, str(dist.package))), *dist.args]


def _bin_js(staged: Path, final: Path, package: str) -> Path:
    """The JS file the package's `bin` names, checked inside the staged tree and returned as the
    path it will have once the tree is swapped into `final`."""
    pkg = staged / "node_modules" / Path(*package.split("/"))
    try:
        bins = json.loads((pkg / "package.json").read_text(encoding="utf-8")).get("bin")
    except (OSError, ValueError, AttributeError):
        bins = None
    if isinstance(bins, dict):
        bins = bins.get(package.rsplit("/", 1)[-1]) or next(iter(bins.values()), None)
    if not isinstance(bins, str) or not bins:
        raise InstallError("npm_failed", "the package names no program to run")
    target = (pkg / bins).resolve()
    if not target.is_relative_to(pkg.resolve()) or not target.is_file():
        raise InstallError("npm_failed", "the package's program is missing")
    return final / target.relative_to(staged.resolve())


async def _binary_install(
    dist: Distribution, staged: Path, final: Path, download: Path, fetch: Fetch, on_progress
) -> list[str]:
    if not dist.sha256:
        raise InstallError("integrity", "the registry lists no checksum")
    on_progress({"stage": "downloading"})
    download.mkdir(parents=True)
    archive = download / (Path(urlparse(dist.url or "").path).name or "download")
    digest = hashlib.sha256()
    try:
        with archive.open("wb") as out:
            async for chunk in fetch(str(dist.url)):
                digest.update(chunk)
                await asyncio.to_thread(out.write, chunk)
    except OSError as err:
        raise InstallError("download_failed", str(err)) from err
    if digest.hexdigest() != dist.sha256.lower():
        raise InstallError("integrity", "the download does not match the listed checksum")
    on_progress({"stage": "extracting"})
    try:
        await asyncio.to_thread(safe_extract, archive, staged)
    except UnsafeArchive as err:
        raise InstallError("unsafe_archive", str(err)) from err
    except (OSError, ValueError) as err:  # a corrupt archive (zipfile and tarfile errors)
        raise InstallError("download_failed", f"{type(err).__name__}: {err}") from err
    exe = (staged / dist.cmd[0]).resolve()
    if not exe.is_relative_to(staged.resolve()) or not exe.is_file():
        raise InstallError("download_failed", "the archive holds no program to run")
    exe.chmod(exe.stat().st_mode | 0o111)
    return [str(final / exe.relative_to(staged.resolve())), *dist.args]
