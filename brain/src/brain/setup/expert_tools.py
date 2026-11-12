"""Scout's tools that change the machine: install an expert and log it in.

Each asks the person through the normal Allow card, with facts built here so the card names
what will be downloaded. Only the person can allow it: no preference, no Always. An install
runs in the background, outside the turn: the tool returns at once with its `install` open item
and the end arrives as a `setup_done` event of facts; a login likewise returns a `signin` item
and ends in a `setup_login` event. A second request for the same expert joins the one running
(the same item comes back), and a card needs no check first, so it shows at once.
Scout words the events.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from pathlib import Path

from brain.events import Event
from brain.open_items import OpenItems
from brain.permission import Tier
from brain.protocol import ErrorCode, RpcError
from brain.setup.facts import Machine, RunCmd
from brain.setup.flights import Flights
from brain.setup.install import InstallError, install_card, install_expert
from brain.setup.login import LoginDriver
from brain.setup.net import GetJson
from brain.setup.registry import Registry, RegistryEntry, RegistryUnavailable
from brain.setup.store import ExpertStore, InstalledExpert
from brain.toolbox import Handler, ToolSpec
from brain.voice.models import Fetch

log = logging.getLogger(__name__)
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
    items: OpenItems,
) -> tuple[
    list[tuple[ToolSpec, Handler]],
    Callable[[RegistryEntry], Awaitable[InstalledExpert]],
    Callable[[], Awaitable[None]],
]:
    """The tools, `update` (a reinstall for the updates check, under the same one-per-expert
    flight, so two installs never share `tools/<id>.part`), and a `stop` that cancels running
    installs (each cleans up) at shutdown."""
    flights = Flights(items, "install")
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

    async def run_install(entry: RegistryEntry) -> InstalledExpert:
        """Install and tell the front door how it ended; the failure is raised after telling, for
        `update`, which waits on the same flight (a joiner of either kind gets the same events)."""

        def progress(step: dict) -> None:
            facts = {"expert": entry.id, **{k: v for k, v in step.items() if v is not None}}
            emit(Event("setup_progress", facts, key=entry.id))
            notify("changed", {"what": "setup"})

        try:
            expert = await install_expert(
                entry, home, await inspect_fn(), run, fetch, get_json, store, progress
            )
        except Exception as err:  # the person is told something, never left waiting
            if isinstance(err, InstallError):
                log.warning("install of %s failed: %s: %s", entry.id, err.kind, err.detail)
                facts = {"expert": entry.id, "ok": False, "error": err.kind, "detail": err.detail}
            else:
                log.warning("install of %s failed: %r", entry.id, err)
                facts = {"expert": entry.id, "ok": False, "error": "failed", "detail": repr(err)}
            emit(Event("setup_done", facts, key=entry.id))
            notify("changed", {"what": "setup"})
            raise
        facts = {"expert": entry.id, "ok": True, "installed": json.dumps(asdict(expert))}
        emit(Event("setup_done", facts, key=entry.id))
        notify("changed", {"what": "setup"})
        return expert

    async def background_install(entry: RegistryEntry) -> None:
        try:
            await run_install(entry)
        except Exception:  # already told and logged by run_install
            pass

    async def install(args: dict) -> str:
        try:
            entry = await entry_for(args)
        except RegistryUnavailable as err:
            return failure("registry_unavailable", str(err))
        if entry is None:
            return failure("unknown_expert", str(args.get("id")))
        # The person allowed the version the card named; a registry that moved on since then
        # needs a fresh card, not a silent install of something else.
        was = shown.pop(entry.id, None)
        if was is not None and was != entry.version:
            return failure("version_changed", f"{was} -> {entry.version}")
        flight = flights.start(entry.id, lambda: background_install(entry))
        out: dict = {"started": entry.id, "item": flight.item.id}
        if flight.joined:  # already installing: the one running install is the answer
            out["joined"] = True
        return json.dumps(out)

    async def update(entry: RegistryEntry) -> InstalledExpert:
        if flights.has(entry.id):
            raise InstallError("already_installing", entry.id)
        flight = flights.start(entry.id, lambda: run_install(entry))
        return await flight.task  # a cancel of the caller cancels the install, which cleans up

    spec = ToolSpec(
        "install_expert",
        "Install one expert (coding agent) from the registry, by its id from find_experts. "
        "Downloads into Tagalong's own folder, never the system. The owner sees an Allow card "
        "naming everything it will download. It returns at once with {started, item}; asking "
        "again while it runs joins it ({joined}). The end comes later as a setup_done event.",
        _ID_SCHEMA,
        effect="change",
        tier=Tier.person_only,  # only the person allows it, every time; no Always button
        card=card,
    )
    return [(spec, install)], update, flights.stop


def _facts(err: Exception) -> tuple[str, str]:
    if isinstance(err, InstallError):
        return err.kind, err.detail
    return "registry_unavailable", str(err)


def login_tools(home: Path, driver: LoginDriver) -> list[tuple[ToolSpec, Handler]]:
    """`login_expert`: the person logs in on their own subscription, in a terminal window or the
    browser the expert opens. No link or code passes through Scout. Like install, it asks every
    time, and the window or browser opens only after the OK. The card needs no check, so it
    shows at once; the checks run after the OK, in the background flight."""

    def found(args: dict):
        return ExpertStore(home).get(str(args.get("id")))

    async def card(args: dict) -> dict:
        expert = found(args)
        if expert is None:
            raise RpcError(ErrorCode.tool_failed, json.dumps({"error": "unknown_expert"}))
        return {"expert": expert.id}

    async def login(args: dict) -> str:
        expert = found(args)
        if expert is None:
            return json.dumps({"error": "unknown_expert", "detail": str(args.get("id"))})
        item, joined = driver.start(expert)
        out: dict = {"state": "waiting", "item": item.id}
        if joined:  # a sign-in is already running: it is the answer
            out["joined"] = True
        return json.dumps(out)

    spec = ToolSpec(
        "login_expert",
        "Log an installed expert in, by its id. Opens a terminal window or the browser for the "
        "owner to sign in on their own subscription, after they allow it. It returns at once "
        "with {state: waiting, item}; asking again while it runs joins it ({joined}). The end "
        "comes later as a setup_login event. Never ask for or relay a code or link.",
        _ID_SCHEMA,
        effect="change",
        tier=Tier.person_only,
        card=card,
    )
    return [(spec, login)]
