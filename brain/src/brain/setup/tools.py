"""Scout's setup tools: look at the machine and the registries before suggesting a fix.

All read-only and automatic. They return facts as JSON; Scout decides what to say.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from pathlib import Path

from brain.setup.facts import Machine
from brain.setup.registry import Listing, Registry, RegistryUnavailable, build_for
from brain.setup.store import ExpertStore
from brain.toolbox import Handler, ToolSpec

InspectFn = Callable[[], Awaitable[Machine]]
_INSTALLABLE = ("npx", "binary")  # the kinds install_expert can place; others are not candidates


async def setup_facts(registry: Registry, inspect_fn: InspectFn) -> dict:
    """What a refused hand-off needs for Scout to recommend a fix: this machine in short tokens,
    and the registry experts that can be set up here. Offline with no cache: none, `stale`."""
    machine = await inspect_fn()
    try:
        listing = await registry.acp_agents()
        candidates = [
            e.id
            for e in listing.entries
            if (d := build_for(e, machine)) is not None and d.kind in _INSTALLABLE
        ]
        stale = listing.stale
    except RegistryUnavailable:
        candidates, stale = [], True

    def version(found) -> str | None:
        return found.version if found else None

    return {
        "machine": {
            "os": machine.os,
            "arch": machine.arch,
            "node": version(machine.node),
            "private_node": version(machine.private_node),
            "claude_code": version(machine.claude_code),
        },
        "candidates": candidates,
        "stale": stale,
    }


def setup_tools(
    home: Path, registry: Registry, inspect_fn: InspectFn
) -> list[tuple[ToolSpec, Handler]]:
    async def inspect_machine(args: dict) -> str:
        experts = [asdict(e) for e in ExpertStore(home).list()]
        return json.dumps({"machine": asdict(await inspect_fn()), "experts": experts})

    async def listing(key: str, fetch: Callable[[], Awaitable[Listing]]) -> str:
        try:
            found, machine = await fetch(), await inspect_fn()
        except RegistryUnavailable as err:
            return json.dumps({"error": "registry_unavailable", "detail": str(err)})
        rows = [
            {
                "id": e.id,
                "name": e.name,
                "version": e.version,
                "description": e.description,
                "license": e.license,
                "kinds": [d.kind for d in e.distributions],
                "buildable": build_for(e, machine) is not None,
            }
            for e in found.entries
        ]
        return json.dumps(
            {key: rows, "stale": found.stale, "fetched_at": found.fetched_at, "more": found.more}
        )

    async def find_experts(args: dict) -> str:
        return await listing("experts", registry.acp_agents)

    async def find_apps(args: dict) -> str:
        query = args.get("query")
        query = query.strip() if isinstance(query, str) and query.strip() else None
        return await listing("apps", lambda: registry.mcp_servers(query))

    empty = {"type": "object", "properties": {}}
    return [
        (
            ToolSpec(
                "inspect_machine",
                "What this computer has: OS, CPU, Node, npm, git and Claude Code, and "
                "Tagalong's own Node. Read-only.",
                empty,
                effect="read",
                default_mode="auto",
            ),
            inspect_machine,
        ),
        (
            ToolSpec(
                "find_experts",
                "The experts (coding agents) that could be set up, from the ACP registry, "
                "each with whether it can run on this computer. Read-only.",
                empty,
                effect="read",
                default_mode="auto",
            ),
            find_experts,
        ),
        (
            ToolSpec(
                "find_apps",
                "Search the MCP registry for apps Scout could connect, each with whether it "
                "can run on this computer. Read-only.",
                {"type": "object", "properties": {"query": {"type": "string"}}},
                effect="read",
                default_mode="auto",
            ),
            find_apps,
        ),
    ]
