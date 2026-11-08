"""Scout's tools that change the machine: install an expert and log it in.

Each asks the person through the normal Allow card, with facts built here so the card names
what will be downloaded. Only the person can allow it: no preference, no Always. An install
runs in the background, outside the turn: the tool returns at once and the end arrives as a
`setup_done` event of facts; a login likewise ends in a `setup_login` event. Scout words them.
"""

import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from pathlib import Path

from brain.events import Event
from brain.permission import Tier
from brain.protocol import ErrorCode, RpcError
from brain.setup.facts import Machine, RunCmd
from brain.setup.install import InstallError, install_card, install_expert
from brain.setup.login import (
    Failed,
    LoggedIn,
    LoginDriver,
    NotLoggedIn,
    Unknown,
    Waiting,
    pick_method,
)
from brain.setup.net import GetJson
from brain.setup.registry import Registry, RegistryEntry, RegistryUnavailable
from brain.setup.store import ExpertStore
from brain.setup.terminal import NoTerminal
from brain.toolbox import Handler, ToolSpec
from brain.voice.models import Fetch

InspectFn = Callable[[], Awaitable[Machine]]
_ID_SCHEMA = {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}


def expert_setup_tools(
    home: Path,
    registry: Registry,
    inspect_fn: InspectFn,
    store: ExpertStore,
    run: RunCmd,
    fetch: Fetch,
    get_json: GetJson,
    emit: Callable[[Event], None],
    notify: Callable[[str, dict], None],
) -> tuple[list[tuple[ToolSpec, Handler]], Callable[[], Awaitable[None]]]:
    """The tools, and a `stop` that cancels running installs (each cleans up) at shutdown."""
    running: dict[str, asyncio.Task] = {}
    shown: dict[str, str] = {}  # the version each Allow card named, until its install starts

    async def entry_for(args: dict) -> RegistryEntry | None:
        wanted = args.get("id")
        found = await registry.acp_agents()
        return next((e for e in found.entries if e.id == wanted), None)

    def failure(error: str, detail: str = "") -> str:
        return json.dumps({"error": error, "detail": detail})

    async def card(args: dict) -> dict:
        try:
            entry = await entry_for(args)
            if entry is None:
                raise InstallError("unknown_expert", str(args.get("id")))
            card_facts = await install_card(entry, home, await inspect_fn(), get_json)
            shown[entry.id] = entry.version
            return card_facts
        except (InstallError, RegistryUnavailable) as err:
            # Facts only, as the error text Scout reads; nothing was asked or installed.
            raise RpcError(ErrorCode.tool_failed, failure(*_facts(err))) from err

    async def run_install(entry: RegistryEntry) -> None:
        def progress(step: dict) -> None:
            facts = {"expert": entry.id, **{k: v for k, v in step.items() if v is not None}}
            emit(Event("setup_progress", facts, key=entry.id))
            notify("changed", {"what": "setup"})

        try:
            expert = await install_expert(
                entry, home, await inspect_fn(), run, fetch, get_json, store, progress
            )
            facts = {"expert": entry.id, "ok": True, "installed": json.dumps(asdict(expert))}
        except InstallError as err:
            facts = {"expert": entry.id, "ok": False, "error": err.kind, "detail": err.detail}
        except Exception as err:  # the person is told something, never left waiting
            facts = {"expert": entry.id, "ok": False, "error": "failed", "detail": repr(err)}
        # A cancel (shutdown) skips this: nobody is left to tell.
        emit(Event("setup_done", facts, key=entry.id))
        notify("changed", {"what": "setup"})

    async def install(args: dict) -> str:
        try:
            entry = await entry_for(args)
        except RegistryUnavailable as err:
            return failure("registry_unavailable", str(err))
        if entry is None:
            return failure("unknown_expert", str(args.get("id")))
        if entry.id in running:
            return failure("already_installing", entry.id)
        # The person allowed the version the card named; a registry that moved on since then
        # needs a fresh card, not a silent install of something else.
        was = shown.pop(entry.id, None)
        if was is not None and was != entry.version:
            return failure("version_changed", f"{was} -> {entry.version}")
        task = asyncio.ensure_future(run_install(entry))
        running[entry.id] = task
        task.add_done_callback(lambda _: running.pop(entry.id, None))
        return json.dumps({"started": entry.id})

    async def stop() -> None:
        tasks = list(running.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    spec = ToolSpec(
        "install_expert",
        "Install one expert (coding agent) from the registry, by its id from find_experts. "
        "Downloads into Tagalong's own folder, never the system. The owner sees an Allow card "
        "naming everything it will download. It returns at once with {started}; the end comes "
        "later as a setup_done event.",
        _ID_SCHEMA,
        effect="change",
        tier=Tier.person_only,  # only the person allows it, every time; no Always button
        card=card,
    )
    return [(spec, install)], stop


def _facts(err: Exception) -> tuple[str, str]:
    if isinstance(err, InstallError):
        return err.kind, err.detail
    return "registry_unavailable", str(err)


def login_tools(home: Path, driver: LoginDriver) -> list[tuple[ToolSpec, Handler]]:
    """`login_expert`: the person logs in on their own subscription, in a terminal window or the
    browser the expert opens. No link or code passes through Scout. Like install, it asks every
    time, and the window or browser opens only after the OK."""

    def found(args: dict):
        return ExpertStore(home).get(str(args.get("id")))

    async def card(args: dict) -> dict:
        expert = found(args)
        if expert is None:
            raise RpcError(ErrorCode.tool_failed, json.dumps({"error": "unknown_expert"}))
        state = await driver.check(expert)
        method = pick_method(state.methods) if isinstance(state, NotLoggedIn) else None
        if method is None:
            if isinstance(state, LoggedIn):
                driver.record_logged_in(expert.id)
                error = "already_logged_in"
            elif isinstance(state, Unknown):
                error = "unknown"
            else:
                error = "no_login_method"
            raise RpcError(ErrorCode.tool_failed, json.dumps({"error": error}))
        opens = "terminal window" if method.kind == "terminal" else "browser"
        return {"expert": expert.id, "method": method.id, "opens": opens}

    async def login(args: dict) -> str:
        expert = found(args)
        if expert is None:
            return json.dumps({"error": "unknown_expert", "detail": str(args.get("id"))})
        try:
            state = await driver.start(expert)
        except NoTerminal as err:
            return json.dumps({"error": "no_terminal", "command": err.command})
        if isinstance(state, Waiting):
            return json.dumps({"state": "waiting", "kind": state.kind})
        if isinstance(state, Failed):
            return json.dumps({"state": "failed", "detail": state.detail})
        return json.dumps({"state": "logged_in" if isinstance(state, LoggedIn) else "unknown"})

    spec = ToolSpec(
        "login_expert",
        "Log an installed expert in, by its id. Opens a terminal window or the browser for the "
        "owner to sign in on their own subscription, after they allow it. It returns at once; "
        "the end comes later as a setup_login event. Never ask for or relay a code or link.",
        _ID_SCHEMA,
        effect="change",
        tier=Tier.person_only,
        card=card,
    )
    return [(spec, login)]
