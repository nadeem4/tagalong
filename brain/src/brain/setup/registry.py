"""Reads the ACP agent registry and the MCP server registry, with a 24 h on-disk cache.

Entries are parsed leniently (unknown fields ignored, a malformed entry skipped) because the
registries are other people's files. Offline, the cache is served and flagged `stale`.
"""

import hashlib
import json
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from brain.setup.facts import Machine
from brain.setup.net import GetJson, real_get_json
from brain.setup.paths import cache_file

ACP_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"
# A search page of 30 keeps the reply small. Without version=latest the registry returns
# every version of a server, so it is always sent (and isLatest is still checked below).
MCP_BASE = "https://registry.modelcontextprotocol.io/v0.1/servers"
MCP_URL = f"{MCP_BASE}?limit=30&version=latest"
TTL_S = 86400
_LATEST = "io.modelcontextprotocol.registry/official"

Kind = Literal["npx", "uvx", "binary", "remote"]


class RegistryUnavailable(Exception):
    """The registry could not be fetched and nothing was cached."""


@dataclass(frozen=True)
class Distribution:
    kind: Kind
    package: str | None = None
    version: str | None = None
    url: str | None = None
    sha256: str | None = None
    cmd: list[str] = field(default_factory=list)
    args: list[str] = field(default_factory=list)
    platforms: tuple[str, ...] = ()
    # Names of what an MCP entry requires: environment variables (a package) or headers (a
    # remote). Names only; a value is never part of a registry entry.
    env: tuple[str, ...] = ()
    headers: tuple[str, ...] = ()


@dataclass(frozen=True)
class RegistryEntry:
    id: str
    name: str
    version: str
    description: str
    license: str
    distributions: list[Distribution]
    requires: dict[str, str] = field(default_factory=dict)
    repo: str = ""  # where the code lives (an MCP entry); Home links it from the check card


@dataclass(frozen=True)
class Listing:
    entries: list[RegistryEntry]
    stale: bool
    fetched_at: str
    more: bool = False  # the registry has further pages
    next_cursor: str | None = None  # pass back to `mcp_servers` for the next page


def _split(package: str, sep: str) -> tuple[str, str | None]:
    # "@scope/name@1.2.3" and "name==1.2.3": the version is after the last separator, and an
    # npm scope's leading "@" is not one.
    name, found, version = package.rpartition(sep)
    if not found or not name:
        return package, None
    return name, version


def _acp_distributions(raw: dict) -> list[Distribution]:
    out: list[Distribution] = []
    for kind, sep in (("npx", "@"), ("uvx", "==")):
        if isinstance(raw.get(kind), dict):
            spec = raw[kind]
            package, version = _split(spec["package"], sep)
            out.append(Distribution(kind, package, version, args=list(spec.get("args", []))))
    for platform, spec in (raw.get("binary") or {}).items():
        if not spec.get("sha256"):
            continue  # the installer refuses an unchecked download, so it is never offered
        out.append(
            Distribution(
                "binary",
                url=spec["archive"],
                sha256=spec.get("sha256"),
                cmd=[spec["cmd"]],
                args=list(spec.get("args", [])),
                platforms=(platform,),
            )
        )
    return out


def _acp_entry(raw: dict) -> RegistryEntry:
    distributions = _acp_distributions(raw["distribution"])
    if not distributions:
        raise ValueError("no distribution")
    return RegistryEntry(
        raw["id"],
        raw["name"],
        str(raw.get("version", "")),
        raw.get("description", ""),
        raw.get("license", ""),
        distributions,
    )


def _required(items: object, safe: str) -> tuple[str, ...]:
    """Names marked isRequired that match `safe` (an env name must fit a `${NAME}` reference)."""
    if not isinstance(items, list):
        return ()
    return tuple(
        i["name"]
        for i in items
        if isinstance(i, dict) and i.get("isRequired") and re.fullmatch(safe, str(i.get("name")))
    )


# An npm (scoped or not) or PyPI name; never starts with `-`, so it is not read as an option.
_PACKAGE = re.compile(r"(@[\w.~-]+/)?[A-Za-z0-9][\w.~-]*")


def _repo(server: dict) -> str:
    repository = server.get("repository")
    url = repository.get("url") if isinstance(repository, dict) else None
    return str(url or server.get("websiteUrl") or "")


def _mcp_entry(raw: dict) -> RegistryEntry:
    server = raw["server"]
    if not (raw.get("_meta") or {}).get(_LATEST, {}).get("isLatest", True):
        raise ValueError("not the latest version")
    out: list[Distribution] = []
    for package in server.get("packages") or []:
        kind = {"npm": "npx", "pypi": "uvx"}.get(package.get("registryType"))
        if kind and re.fullmatch(_PACKAGE, str(package.get("identifier"))):
            env = _required(package.get("environmentVariables"), r"[A-Za-z_]\w*")
            out.append(Distribution(kind, package["identifier"], package.get("version"), env=env))
    for remote in server.get("remotes") or []:
        out.append(
            Distribution(
                "remote",
                url=remote["url"],
                headers=_required(remote.get("headers"), r"[A-Za-z0-9-]+"),
            )
        )
    if not out:
        raise ValueError("no way to run it")
    return RegistryEntry(
        server["name"],
        server.get("title") or server["name"],
        str(server.get("version", "")),
        server.get("description", ""),
        "",
        out,
        repo=_repo(server),
    )


def _parse[T](items: object, one: Callable[[dict], T]) -> list[T]:
    entries: list[T] = []
    for item in items if isinstance(items, list) else []:
        try:
            entries.append(one(item))
        except (KeyError, TypeError, ValueError, AttributeError):
            continue  # one bad entry never hides the rest
    return entries


def _platform_tag(machine: Machine) -> str:
    os_name = {"macos": "darwin"}.get(machine.os, machine.os)
    arch = {"x64": "x86_64", "arm64": "aarch64"}[machine.arch]
    return f"{os_name}-{arch}"


def build_for(entry: RegistryEntry, machine: Machine) -> Distribution | None:
    """The way to run this entry here, or None (a fact Scout reports). Prefers npx, then a
    checksummed binary for this machine, then a hosted remote, then uvx."""
    tag = _platform_tag(machine)
    for kind in ("npx", "binary", "remote", "uvx"):
        for d in entry.distributions:
            if d.kind == "binary" and not d.sha256:
                continue  # the installer would refuse it, so it is not a way to run this
            if d.kind == kind and (kind != "binary" or tag in d.platforms):
                return d
    return None


class Registry:
    def __init__(
        self,
        home: Path,
        get_json: GetJson = real_get_json,
        clock: Callable[[], float] = time.time,
        ttl_s: float = TTL_S,
    ) -> None:
        self._home = home
        self._get = get_json
        self._clock = clock
        self._ttl = ttl_s

    async def acp_agents(self, refresh: bool = False) -> Listing:
        data, stale, at = await self._load("acp", ACP_URL, refresh)
        return Listing(_parse(data.get("agents"), _acp_entry), stale, _iso(at))

    async def mcp_servers(
        self, query: str | None, refresh: bool = False, cursor: str | None = None
    ) -> Listing:
        query = query.strip().lower() if query and query.strip() else None
        url = MCP_URL
        if query:
            url += f"&search={quote(query, safe='')}"
        if cursor:
            url += f"&cursor={quote(cursor, safe='')}"
        # Query and cursor together name the page, so each page has its own cache file.
        key = f"{query}|{cursor}"
        name = f"mcp-{hashlib.sha1(key.encode()).hexdigest()[:12]}" if query or cursor else "mcp"
        data, stale, at = await self._load(name, url, refresh)
        meta = data.get("metadata")
        nxt = meta.get("nextCursor") if isinstance(meta, dict) else None
        nxt = nxt if isinstance(nxt, str) and nxt else None
        return Listing(
            _parse(data.get("servers"), _mcp_entry), stale, _iso(at), nxt is not None, nxt
        )

    async def _load(self, name: str, url: str, refresh: bool) -> tuple[dict, bool, float]:
        path = cache_file(self._home, name)
        cached = self._read_cache(path)
        if cached and not refresh and self._clock() - cached["fetched_at"] < self._ttl:
            return cached["data"], False, cached["fetched_at"]
        try:
            data = json.loads(await self._get(url))
            if not isinstance(data, dict):
                raise ValueError("not an object")
        except Exception as err:  # offline, a bad status or garbage: fall back to the cache
            if cached:
                return cached["data"], True, cached["fetched_at"]
            raise RegistryUnavailable(f"could not read the registry: {err}") from err
        now = self._clock()
        self._write_cache(path, {"fetched_at": now, "data": data})
        return data, False, now

    @staticmethod
    def _read_cache(path: Path) -> dict | None:
        try:
            cached = json.loads(path.read_text(encoding="utf-8"))
            ok = isinstance(cached["data"], dict) and isinstance(cached["fetched_at"], int | float)
            return cached if ok and not isinstance(cached["fetched_at"], bool) else None
        except (OSError, ValueError, KeyError, TypeError):
            return None

    @staticmethod
    def _write_cache(path: Path, payload: dict) -> None:
        # Atomic: a crash leaves the old cache, never half a file.
        part = path.with_name(path.name + ".part")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            part.write_text(json.dumps(payload), encoding="utf-8")
            os.replace(part, path)
        except OSError:
            part.unlink(missing_ok=True)  # the read still succeeded; the cache is only a speed-up


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, UTC).isoformat()
