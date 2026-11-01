"""Scout's tools that change the machine: install an expert (and, later, log it in).

Each asks the person through the normal Allow card, with facts built here so the card names
what will be downloaded. A preference never skips the card. Results are JSON facts; Scout words
them.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from pathlib import Path

from brain.events import Event
from brain.protocol import ErrorCode, RpcError
from brain.setup.facts import Machine, RunCmd
from brain.setup.install import InstallError, install_card, install_expert
from brain.setup.net import GetJson
from brain.setup.registry import Registry, RegistryEntry, RegistryUnavailable
from brain.setup.store import ExpertStore
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
) -> list[tuple[ToolSpec, Handler]]:
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
            return await install_card(entry, home, await inspect_fn(), get_json)
        except (InstallError, RegistryUnavailable) as err:
            # Facts only, as the error text Scout reads; nothing was asked or installed.
            raise RpcError(ErrorCode.tool_failed, failure(*_facts(err))) from err

    async def install(args: dict) -> str:
        try:
            entry = await entry_for(args)
        except RegistryUnavailable as err:
            return failure("registry_unavailable", str(err))
        if entry is None:
            return failure("unknown_expert", str(args.get("id")))

        def progress(step: dict) -> None:
            facts = {"expert": entry.id, **{k: v for k, v in step.items() if v is not None}}
            emit(Event("setup_progress", facts, key=entry.id))
            notify("changed", {"what": "setup"})

        try:
            expert = await install_expert(
                entry, home, await inspect_fn(), run, fetch, get_json, store, progress
            )
        except InstallError as err:
            notify("changed", {"what": "setup"})
            return failure(err.kind, err.detail)
        return json.dumps(asdict(expert))

    return [
        (
            ToolSpec(
                "install_expert",
                "Install one expert (coding agent) from the registry, by its id from "
                "find_experts. Downloads into Tagalong's own folder, never the system. The "
                "owner sees an Allow card naming everything it will download.",
                _ID_SCHEMA,
                effect="change",  # never auto by default: installing always asks
                card=card,
            ),
            install,
        )
    ]


def _facts(err: Exception) -> tuple[str, str]:
    if isinstance(err, InstallError):
        return err.kind, err.detail
    return "registry_unavailable", str(err)
