"""Updates: which installed experts and apps have a newer version, and applying it.

An expert's version is the one it was installed at against the ACP registry's; a local app's is
the package version pinned in its command against the MCP registry's; a remote app has none
(the service updates it). The brain checks once a day and on request, and applies an update by
itself only for a group the person left on (Official on, Community off at first). Nothing is ever
changed while a job runs: a due update waits in a queue and `tick` applies it once the job ends.
Last-checked time and the latest versions seen live in `cache/updates.json`, so a restart keeps
them. Failures are logged and shown on the row; the old version stays.
"""

import asyncio
import json
import logging
import os
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

from brain.apps import AppRow
from brain.memory import Memory
from brain.setup.apps import package_spec
from brain.setup.registry import Distribution, Listing, Registry, RegistryEntry, RegistryUnavailable
from brain.setup.store import ExpertStore, InstalledExpert
from brain.setup.trust import is_official_expert
from brain.store.settings import get_setting, set_setting

log = logging.getLogger("brain")
Kind = Literal["app", "expert"]
Key = tuple[str, str]
DAILY = timedelta(hours=24)
CONNECT_WAIT_S = 60.0  # how long a restarted app gets to connect before the update is undone
TICK_S = 30.0  # how often the brain looks for a due check or a waiting update
Reinstall = Callable[[RegistryEntry], Awaitable[object]]
Auto = Callable[[str, bool], bool]
Notify = Callable[[str, dict], None]


def _numbers(version: str) -> tuple[int, ...] | None:
    parts = re.findall(r"\d+", version)
    return tuple(int(p) for p in parts) if parts else None


def newer(latest: str, installed: str) -> bool:
    new, old = _numbers(latest), _numbers(installed)
    return new is not None and old is not None and new > old


@dataclass(frozen=True)
class UpdateItem:
    kind: Kind
    id: str
    name: str
    installed: str
    latest: str | None
    remote: bool
    official: bool
    auto: bool  # the group's setting: whether this one updates by itself

    @property
    def has_update(self) -> bool:
        return not self.remote and self.latest is not None and newer(self.latest, self.installed)


def default_auto(kind: str, official: bool) -> bool:
    return official


def _is_local(row: AppRow) -> bool:
    return row.transport == "stdio"


def _app_entry(found: Listing, row: AppRow) -> tuple[RegistryEntry, Distribution] | None:
    """The registry entry this app was installed from: same title, and a package its command
    still runs (the last argument is `package@version` or `package==version`)."""
    spec = row.config.get("args", [""])[-1] if row.config.get("args") else ""
    for entry in found.entries:
        for dist in entry.distributions:
            sep = "==" if dist.kind == "uvx" else "@"
            if entry.name == row.name and dist.kind in ("npx", "uvx") and dist.package:
                if spec.startswith(dist.package + sep):
                    return entry, dist
    return None


async def latest_versions(
    registry: Registry, apps: list[AppRow], experts: list[InstalledExpert], refresh: bool
) -> dict[Key, str]:
    """The registries' newest version of each installed thing they know. Raises
    RegistryUnavailable when a registry cannot be read at all (nothing cached)."""
    latest: dict[Key, str] = {}
    if any(e.source == "registry" for e in experts):
        versions = {e.id: e.version for e in (await registry.acp_agents(refresh)).entries}
        latest |= {("expert", e.id): versions[e.id] for e in experts if e.id in versions}
    for row in apps:
        if _is_local(row) and row.version:
            hit = _app_entry(await registry.mcp_servers(row.name, refresh), row)
            if hit is not None:
                latest[("app", row.id)] = hit[1].version or hit[0].version
    return latest


def build_items(
    apps: list[AppRow],
    experts: list[InstalledExpert],
    latest: dict[Key, str],
    auto: Auto = default_auto,
) -> list[UpdateItem]:
    items = []
    for row in apps:
        official = row.trust == "official"
        items.append(
            UpdateItem(
                "app",
                row.id,
                row.name,
                row.version,
                latest.get(("app", row.id)),
                not _is_local(row),
                official,
                auto("app", official),
            )  # fmt: skip
        )
    for ex in experts:
        if ex.source != "registry":
            continue  # a custom command has no registry to compare with
        official = is_official_expert(ex.id)
        items.append(
            UpdateItem(
                "expert",
                ex.id,
                ex.name,
                ex.version,
                latest.get(("expert", ex.id)),
                False,
                official,
                auto("expert", official),
            )  # fmt: skip
        )
    return items


async def check(
    registry: Registry,
    apps: list[AppRow],
    experts: list[InstalledExpert],
    refresh: bool,
    auto: Auto = default_auto,
) -> list[UpdateItem]:
    return build_items(apps, experts, await latest_versions(registry, apps, experts, refresh), auto)


def _group(official: bool) -> str:
    return "official" if official else "community"


class Updates:
    def __init__(
        self,
        home: Path,
        registry: Registry,
        memory: Memory,
        experts: ExpertStore,
        apps,
        reinstall: Reinstall,
        jobs_running: Callable[[], bool],
        notify: Notify,
        now: Callable[[], datetime],
    ) -> None:
        self._path = home / "cache" / "updates.json"
        self._registry, self._memory, self._experts, self._apps = registry, memory, experts, apps
        self._reinstall, self._jobs_running, self._notify, self._now = (
            reinstall, jobs_running, notify, now,
        )  # fmt: skip
        self._last, self._latest = self._read()
        self._status: dict[Key, dict] = {}  # waiting / updating / updated / failed, per item
        self._queue: list[Key] = []
        self._drain_task: asyncio.Task | None = None
        self._applying = asyncio.Lock()  # held while one update is swapped in

    # ---- the saved check ----

    def _read(self) -> tuple[str | None, dict[Key, str]]:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            last = data["last_checked"]
            latest = {
                (kind, i): str(v)
                for kind, found in data["latest"].items()
                for i, v in found.items()
            }
            return (last if isinstance(last, str) else None), latest
        except (OSError, ValueError, KeyError, AttributeError, TypeError):
            return None, {}

    def _write(self) -> None:
        latest: dict[str, dict[str, str]] = {"app": {}, "expert": {}}
        for (kind, item_id), version in self._latest.items():
            latest[kind][item_id] = version
        part = self._path.with_name(self._path.name + ".part")
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            part.write_text(json.dumps({"last_checked": self._last, "latest": latest}), "utf-8")
            os.replace(part, self._path)
        except OSError as err:  # the check still worked; only its memory across a restart is lost
            log.warning("could not save the update check: %r", err)
            part.unlink(missing_ok=True)

    # ---- the person's choice per group ----

    def auto(self, kind: str, official: bool) -> bool:
        saved = get_setting(self._memory.db, f"auto_update.{kind}.{_group(official)}")
        return official if saved is None else saved == "1"

    def set_auto(self, kind: str, official: bool, on: bool) -> None:
        set_setting(self._memory.db, f"auto_update.{kind}.{_group(official)}", "1" if on else "0")
        self._notify("changed", {"what": "updates"})

    # ---- what Home shows ----

    def _items(self) -> list[UpdateItem]:
        return build_items(self._memory.list_apps(), self._experts.list(), self._latest, self.auto)

    def state(self) -> dict:
        rows = []
        for item in self._items():
            status = self._status.get((item.kind, item.id), {"state": "idle"})
            rows.append(
                {
                    "kind": item.kind,
                    "id": item.id,
                    "name": item.name,
                    "installed": item.installed,
                    "latest": item.latest if item.has_update else None,
                    "remote": item.remote,
                    "official": item.official,
                    "auto": item.auto,
                    "status": status["state"],
                    **({"error": status["error"]} if "error" in status else {}),
                }
            )
        groups = {
            f"{kind}s": {_group(o): self.auto(kind, o) for o in (True, False)}
            for kind in ("app", "expert")
        }
        return {"checkedAt": self._last, "auto": groups, "items": rows}

    # ---- checking ----

    def _due(self) -> bool:
        if self._last is None:
            return True
        return self._now() - datetime.fromisoformat(self._last) >= DAILY

    async def check(self, refresh: bool) -> None:
        """Read the registries and queue what the person left on auto. A registry that cannot
        be read at all keeps the last known versions and the last time."""
        try:
            self._latest = await latest_versions(
                self._registry, self._memory.list_apps(), self._experts.list(), refresh
            )
        except RegistryUnavailable as err:
            log.warning("update check failed: %s", err)
            return
        self._last = self._now().isoformat()
        self._write()
        self._status = {
            k: v for k, v in self._status.items() if v["state"] in ("waiting", "updating")
        }
        for item in self._items():
            if item.has_update and item.auto:
                self._enqueue((item.kind, item.id))
        self._notify("changed", {"what": "updates"})
        self._kick()

    async def tick(self) -> None:
        """The brain's heartbeat: the daily check when due (read afresh, a cached answer would
        hide the update), else any update that was waiting for a job to end."""
        if self._due():
            await self.check(refresh=True)
        else:
            self._kick()

    async def run(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception:  # one bad tick must not end the heartbeat
                log.exception("update tick failed")
            await asyncio.sleep(TICK_S)

    async def quiet(self) -> None:
        """Returns once no update is being applied. A job waits on this before it starts, so
        it never meets an expert or app halfway through a swap."""
        async with self._applying:
            pass

    # ---- applying ----

    def _enqueue(self, key: Key) -> None:
        if key not in self._queue and self._status.get(key, {}).get("state") != "updating":
            self._queue.append(key)

    def _kick(self) -> None:
        if not self._queue or (self._drain_task and not self._drain_task.done()):
            return
        if self._jobs_running():
            for key in self._queue:
                self._status[key] = {"state": "waiting"}
            self._notify("changed", {"what": "updates"})
            return
        self._drain_task = asyncio.ensure_future(self._drain())

    async def _drain(self) -> None:
        while self._queue:
            # The lock is taken before the last look at the jobs: a job that starts after that
            # look waits in `quiet` until the swap is over.
            async with self._applying:
                if self._jobs_running():  # a job started since: wait for the next tick
                    for key in self._queue:
                        self._status[key] = {"state": "waiting"}
                    break
                key = self._queue.pop(0)
                self._status[key] = {"state": "updating"}
                self._notify("changed", {"what": "updates"})
                try:
                    await self._apply(key)
                    self._status[key] = {"state": "updated"}
                except Exception as err:  # the old version stays; the row says it failed
                    log.warning("update of %s %s failed: %s", key[0], key[1], err)
                    self._status[key] = {"state": "failed", "error": str(err)}
            self._notify("changed", {"what": "updates"})
        self._notify("changed", {"what": "updates"})

    async def stop(self) -> None:
        """At shutdown: cancel an update in flight (an expert's install cleans up after itself)."""
        if self._drain_task and not self._drain_task.done():
            self._drain_task.cancel()
            await asyncio.gather(self._drain_task, return_exceptions=True)

    async def wait(self) -> None:
        while self._drain_task and not self._drain_task.done():
            await asyncio.shield(self._drain_task)

    async def _apply(self, key: Key) -> None:
        kind, item_id = key
        item = next(i for i in self._items() if (i.kind, i.id) == key)
        if kind == "expert":
            found = await self._registry.acp_agents()
            entry = next((e for e in found.entries if e.id == item_id), None)
            if entry is None:
                raise LookupError(f"{item_id} is no longer in the registry")
            await self._reinstall(entry)
            return
        row = next(r for r in self._memory.list_apps() if r.id == item_id)
        hit = _app_entry(await self._registry.mcp_servers(row.name), row)
        if hit is None or item.latest is None:
            raise LookupError(f"{row.name} is no longer in the registry")
        args = [*row.config["args"][:-1], package_spec(hit[1], item.latest)]
        self._memory.set_app_package(item_id, {**row.config, "args": args}, item.latest)
        try:
            await self._apps.restart(item_id)
            settled = await self._apps.wait_settled(item_id, CONNECT_WAIT_S)
            if settled.state not in ("connected", "needs-sign-in", "off"):
                raise RuntimeError(settled.error or "the new version did not start")
        except BaseException:
            # Put the old command back and start it again: the app must not stay down.
            self._memory.set_app_package(item_id, row.config, row.version)
            await asyncio.shield(self._apps.restart(item_id))
            raise
        self._notify("changed", {"what": "apps"})

    def _start(self, keys: list[Key]) -> str | None:
        for key in keys:
            self._enqueue(key)
        waiting = self._jobs_running()
        self._kick()
        return "job" if waiting else None

    async def update(self, kind: str, item_id: str) -> dict:
        item = next((i for i in self._items() if (i.kind, i.id) == (kind, item_id)), None)
        if item is None or not item.has_update:
            return {"error": "no_update"}
        return {"waiting": "job"} if self._start([(kind, item_id)]) else {"started": True}

    async def update_all(self, kind: str) -> dict:
        keys = [
            (i.kind, i.id)
            for i in self._items()
            if i.kind == kind and i.has_update and (i.kind, i.id) not in self._queue
            and self._status.get((i.kind, i.id), {}).get("state") != "updating"
        ]  # fmt: skip
        if not keys:
            return {"started": False, "count": 0}
        waiting = self._start(keys)
        return (
            {"waiting": waiting, "count": len(keys)}
            if waiting
            else {"started": True, "count": len(keys)}
        )
