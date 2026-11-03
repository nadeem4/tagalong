"""Add an app from an MCP Registry entry: Scout's `install_app`.

`app_params` turns an entry into the params `validate_app` takes, so the app is saved by the
same path as one added by hand. A package runs through a Node's own `npm exec` by absolute path
(never a PATH edit); a remote entry signs in through `Apps`. Required env becomes `${VAR}`
references, so no secret value is ever stored. Failures are facts (`InstallError`), not prose.
An app that connects inside the call is reported in its result (with its tool names); one that
finishes later (a browser sign-in, a slow start) ends in a `setup_done` event, so Scout can pick
the person's earlier request back up in the same conversation.
"""

import asyncio
import json
import os
import shutil
from collections.abc import Awaitable, Callable, Mapping
from functools import partial
from pathlib import Path
from urllib.parse import urlsplit

from brain.app_tools import browser_opener, save_app
from brain.apps import AppError, Apps, OpenUrl, TokenFile
from brain.bodies import Bodies
from brain.events import Event
from brain.memory import Memory
from brain.protocol import ErrorCode, RpcError
from brain.setup.facts import Machine
from brain.setup.install import (
    InstallError,
    NoBuild,
    node_download_fact,
    node_for,
    usable_node,
)
from brain.setup.net import GetJson
from brain.setup.registry import (
    Distribution,
    Registry,
    RegistryEntry,
    RegistryUnavailable,
    build_for,
)
from brain.toolbox import Handler, ToolSpec
from brain.voice.models import Fetch

InspectFn = Callable[[], Awaitable[Machine]]
CONNECT_WAIT_S = 20.0  # how long install_app waits to report connected; a slow app stays connecting
SIGN_IN_WAIT_S = 600.0  # how long to watch for a person finishing sign-in before giving up
MAX_TOOLS_LISTED = 30


def _spec(dist: Distribution, version: str) -> str:
    sep = "==" if dist.kind == "uvx" else "@"
    return f"{dist.package}{sep}{version}" if version else str(dist.package)


def app_params(
    entry: RegistryEntry,
    dist: Distribution | None,
    machine: Machine,
    home: Path,
    which: Callable[[str], str | None] | None = None,
) -> dict:
    """The `validate_app` params for one entry on this machine, or an InstallError fact:
    no_build, node_missing, uv_missing, needs_token."""
    if dist is None:
        raise NoBuild(f"{machine.os}-{machine.arch}")
    if dist.kind == "remote":
        if dist.headers:  # a header is a secret the person must supply: not Scout's to guess
            raise InstallError("needs_token", ",".join(dist.headers))
        # The registry does not say which servers sign in; `oauth` only prompts on a 401.
        return {
            "name": entry.name,
            "transport": "http",
            "auth": "oauth",
            "config": {"url": dist.url},
        }
    env = {name: f"${{{name}}}" for name in dist.env}
    spec = _spec(dist, dist.version or entry.version)
    if dist.kind == "npx":
        node = usable_node(home, machine)
        if node is None:
            raise InstallError("node_missing", "no Node 22 or newer")
        # npm exec runs the package; its own Node first on PATH so the package's scripts find it.
        env["PATH"] = str(node.node.parent) + os.pathsep + "${PATH}"
        command, args = str(node.node), [str(node.npm_cli), "exec", "--yes", "--", spec]
    elif dist.kind == "uvx":
        found = (which or shutil.which)("uvx")
        if found is None:
            raise InstallError("uv_missing", "uvx")
        command, args = found, ["--", spec]
    else:
        raise InstallError("unsupported", dist.kind)
    return {
        "name": entry.name,
        "transport": "stdio",
        "auth": "none",
        "config": {"command": command, "args": args, "env": env},
    }


async def app_card(entry: RegistryEntry, home: Path, machine: Machine, get_json: GetJson) -> dict:
    """What adding this entry would do, as facts for the Allow card (and the CLI's question):
    host for a remote app; package, version and env names for a stdio one; any Node download.
    Raises an InstallError fact when it cannot be added."""
    dist = build_for(entry, machine)
    if dist is None:
        raise NoBuild(f"{machine.os}-{machine.arch}")
    facts: dict = {"app": entry.id, "node_download": None}
    if dist.kind == "remote":
        if dist.headers:
            raise InstallError("needs_token", ",".join(dist.headers))
        facts["transport"] = "http"
        facts["host"] = urlsplit(dist.url or "").hostname or ""
        return facts
    if dist.kind == "npx":
        facts["node_download"] = await node_download_fact(home, machine, get_json)
    elif dist.kind == "uvx" and shutil.which("uvx") is None:
        raise InstallError("uv_missing", "uvx")
    facts.update(
        transport="stdio",
        runs=dist.kind,
        package=dist.package,
        version=dist.version or entry.version,
        env=list(dist.env),
    )
    return facts


async def add_registry_app(
    entry: RegistryEntry,
    home: Path,
    inspect_fn: InspectFn,
    fetch: Fetch,
    get_json: GetJson,
    apps: Apps,
    memory: Memory,
    tokens: TokenFile,
    notify: Callable[[str, dict], None],
):
    """Save the entry as an app row, fetching Node first if its package needs one. Raises
    InstallError (already_added is checked first, so a repeat never downloads) or AppError."""
    existing = next((r for r in memory.list_apps() if r.name == entry.name), None)
    if existing is not None:
        raise InstallError("already_added", entry.name, id=existing.id)
    machine = await inspect_fn()
    dist = build_for(entry, machine)
    if dist is not None and dist.kind == "npx" and usable_node(home, machine) is None:
        await node_for(home, machine, fetch, get_json, lambda step: None)  # named on the card
        machine = await inspect_fn()
    params = app_params(entry, dist, machine, home)
    return await save_app(apps, memory, tokens, notify, params)


def app_setup_tools(
    home: Path,
    registry: Registry,
    inspect_fn: InspectFn,
    apps: Apps,
    memory: Memory,
    tokens: TokenFile,
    notify: Callable[[str, dict], None],
    bodies: Bodies,
    fetch: Fetch,
    get_json: GetJson,
    env: Mapping[str, str],
    emit: Callable[[Event], None],
    wait_s: float = CONNECT_WAIT_S,
    sign_in_wait_s: float = SIGN_IN_WAIT_S,
    opener: Callable[[str], OpenUrl | None] | None = None,
) -> list[tuple[ToolSpec, Handler]]:
    def fail(error: str, detail: str = "", **more) -> str:
        return json.dumps({"error": error, "detail": detail, **more})

    async def entry_for(args: dict) -> RegistryEntry | None:
        query = args.get("query")
        query = query.strip() if isinstance(query, str) and query.strip() else None
        found = await registry.mcp_servers(query)
        return next((e for e in found.entries if e.id == args.get("id")), None)

    async def card(args: dict) -> dict:
        try:
            entry = await entry_for(args)
            if entry is None:
                raise InstallError("unknown_app", str(args.get("id")))
            return await app_card(entry, home, await inspect_fn(), get_json)
        except (InstallError, RegistryUnavailable) as err:
            kind = err.kind if isinstance(err, InstallError) else "registry_unavailable"
            raise RpcError(ErrorCode.tool_failed, fail(kind, str(err))) from err

    async def settle(app_id: str) -> str:
        """The app's state once it stops connecting, or after the wait; the facts Scout words."""
        loop = asyncio.get_running_loop()
        end = loop.time() + wait_s
        while apps.status(app_id).state == "connecting" and loop.time() < end:
            await asyncio.sleep(0.2)
        return apps.status(app_id).state

    def tool_names(app_id: str) -> list[str]:
        return [t.name for t in apps.tools(app_id)][:MAX_TOOLS_LISTED]

    watching: set[asyncio.Task] = set()  # held so a watch is not collected mid-wait

    async def announce(app_id: str, name: str) -> None:
        """Wait for the app to stop connecting, then tell Scout how it ended."""
        loop = asyncio.get_running_loop()
        end = loop.time() + sign_in_wait_s
        while apps.status(app_id).state == "connecting" and loop.time() < end:
            await asyncio.sleep(0.2)
        status = apps.status(app_id)
        facts: dict = {
            "app": app_id,
            "name": name,
            "ok": status.state == "connected",
            "state": status.state,
        }
        if status.state == "connected":
            facts["tools"] = ", ".join(tool_names(app_id))
        elif status.error:
            facts["detail"] = status.error
        emit(Event("setup_done", facts, key=app_id))

    def watch(app_id: str, name: str) -> None:
        task = asyncio.get_running_loop().create_task(announce(app_id, name))
        watching.add(task)
        task.add_done_callback(watching.discard)

    async def install(args: dict) -> str:
        try:
            entry = await entry_for(args)
        except RegistryUnavailable as err:
            return fail("registry_unavailable", str(err))
        if entry is None:
            return fail("unknown_app", str(args.get("id")))
        try:
            row = await add_registry_app(
                entry, home, inspect_fn, fetch, get_json, apps, memory, tokens, notify
            )
        except InstallError as err:
            return fail(err.kind, err.detail, **({"id": err.id} if err.id else {}))
        except AppError as err:
            return fail("refused", str(err))
        out: dict = {"id": row.id, "transport": row.transport, "auth": row.auth}
        if row.auth == "oauth":
            open_url = (opener or partial(browser_opener, bodies))(row.id)
            if open_url is not None:
                try:
                    await apps.sign_in(row.id, open_url)
                except AppError as err:
                    return fail("refused", str(err), id=row.id)
                watch(row.id, row.name)
                return json.dumps({**out, "status": "signing_in"})
            out["browser"] = False
        missing = [n for n in row.config.get("env", {}) if n != "PATH" and n not in env]
        if missing:
            out["needs_env"] = missing
        out["status"] = await settle(row.id)
        if out["status"] == "connected":
            out["tools"] = tool_names(row.id)
        elif out["status"] == "connecting":  # still starting: the end arrives as an event
            watch(row.id, row.name)
        return json.dumps(out)

    spec = ToolSpec(
        "install_app",
        "Add an app from the MCP registry, by its id from find_apps (pass the same query too). "
        "The owner sees an Allow card naming what it runs and any Node download. It reports "
        "connected (with its tool names), signing_in, needs_sign_in or needs_env (names of "
        "variables to set). When it ends later (sign-in finished, slow start) a setup_done "
        "event says how.",
        {
            "type": "object",
            "properties": {"id": {"type": "string"}, "query": {"type": "string"}},
            "required": ["id"],
        },
        effect="change",
        locked=True,  # the card has no Always button
        person_only=True,  # only the person allows it, every time
        card=card,
    )
    return [(spec, install)]
