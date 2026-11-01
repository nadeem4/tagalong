"""Reads the ACP agent registry and the MCP server registry, with a 24 h on-disk cache.

Entries are parsed leniently (unknown fields ignored, a malformed entry skipped) because the
registries are other people's files. Offline, the cache is served and flagged `stale`.
"""

import json
import os
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
MCP_URL = "https://registry.modelcontextprotocol.io/v0/servers?limit=100&version=latest"
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


@dataclass(frozen=True)
class RegistryEntry:
    id: str
    name: str
    version: str
    description: str
    license: str
    distributions: list[Distribution]
    requires: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Listing:
    entries: list[RegistryEntry]
    stale: bool
    fetched_at: str


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


def _mcp_entry(raw: dict) -> RegistryEntry:
    server = raw["server"]
    if not (raw.get("_meta") or {}).get(_LATEST, {}).get("isLatest", True):
        raise ValueError("not the latest version")
    out: list[Distribution] = []
    for package in server.get("packages") or []:
        kind = {"npm": "npx", "pypi": "uvx"}.get(package.get("registryType"))
        if kind:
            out.append(Distribution(kind, package["identifier"], package.get("version")))
    for remote in server.get("remotes") or []:
        out.append(Distribution("remote", url=remote["url"]))
    if not out:
        raise ValueError("no way to run it")
    return RegistryEntry(
        server["name"],
        server.get("title") or server["name"],
        str(server.get("version", "")),
        server.get("description", ""),
        "",
        out,
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
    binary for this machine, then a hosted remote, then uvx."""
    tag = _platform_tag(machine)
    for kind in ("npx", "binary", "remote", "uvx"):
        for d in entry.distributions:
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

    async def mcp_servers(self, query: str | None, refresh: bool = False) -> Listing:
        url = MCP_URL + (f"&search={quote(query)}" if query else "")
        name = "mcp" if not query else f"mcp-{quote(query, safe='')}"
        data, stale, at = await self._load(name, url, refresh)
        return Listing(_parse(data.get("servers"), _mcp_entry), stale, _iso(at))

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
            return cached if isinstance(cached["data"], dict) else None
        except (OSError, ValueError, KeyError, TypeError):
            return None

    @staticmethod
    def _write_cache(path: Path, payload: dict) -> None:
        # Atomic: a crash leaves the old cache, never half a file.
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            part = path.with_name(path.name + ".part")
            part.write_text(json.dumps(payload), encoding="utf-8")
            os.replace(part, path)
        except OSError:
            pass  # the read still succeeded; the cache is only an optimisation


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, UTC).isoformat()
