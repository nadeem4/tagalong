"""Home's tools for the Connections page and the walkthrough: what is set up, and set it up.

`setup_expert` and `setup_app` reuse Scout's install and login tools. The page passes
`approved: false` and gets the Allow card (empty text, facts only); the tour's button press is
the OK itself, so it passes `approved: true`. Progress is the latest `setup_progress` facts.
"""

import json
import re
from collections.abc import Awaitable, Callable
from typing import Any

from brain.asks import ASK_TIMEOUT_S, Answer
from brain.events import Event
from brain.permission import Tier
from brain.protocol import ErrorCode, RpcError
from brain.setup.env import is_tested
from brain.setup.facts import Machine
from brain.setup.registry import Listing, Registry, RegistryUnavailable, build_for
from brain.setup.store import InstalledExpert
from brain.toolbox import Handler, ToolSpec

InspectFn = Callable[[], Awaitable[Machine]]
AskFn = Callable[..., Awaitable[Answer]]
RecordFn = Callable[..., None]
_INSTALLABLE = ("npx", "binary")


class SetupProgress:
    """Remembers the running install's latest facts for `setup_overview`, then passes events on."""

    def __init__(self, emit: Callable[[Event], None]) -> None:
        self._emit = emit
        self._current: dict | None = None
        self._failed: dict | None = None  # the last install that failed, until the next try

    def emit(self, event: Event) -> None:
        if event.kind == "setup_progress":
            self._current, self._failed = dict(event.facts), None
        elif event.kind == "setup_done":
            self._current = None
            if event.facts.get("ok") is False:
                self._failed = {
                    "expert": event.facts.get("expert"),
                    "error": event.facts.get("error"),
                }
        self._emit(event)

    def current(self) -> dict | None:
        return self._current

    def failed(self) -> dict | None:
        return self._failed


def _numbers(version: str) -> tuple[int, ...] | None:
    parts = re.findall(r"\d+", version)
    return tuple(int(p) for p in parts) if parts else None


def _newer(registry_version: str, installed: str) -> bool:
    new, old = _numbers(registry_version), _numbers(installed)
    return new is not None and old is not None and new > old


def _token(message: str) -> str | None:
    """The `error` token of a tool's `{"error": ...}` answer, or None for any other text."""
    try:
        token = json.loads(message).get("error")
    except (ValueError, AttributeError):
        return None
    return token if isinstance(token, str) else None


def home_setup_tools(
    registry: Registry,
    inspect_fn: InspectFn,
    experts: Callable[[], list[InstalledExpert]],
    apps: Callable[[], list[dict]],
    ask: AskFn,
    record: RecordFn,
    inner: list[tuple[ToolSpec, Handler]],
    progress: SetupProgress,
) -> list[tuple[ToolSpec, Handler]]:
    by_name = {spec.name: (spec, handler) for spec, handler in inner}

    async def listing(fetch: Callable[[], Awaitable[Listing]]) -> tuple[Listing | None, bool]:
        try:
            found = await fetch()
        except RegistryUnavailable:
            return None, True
        return found, found.stale

    def rows(found: Listing | None, machine: Machine, skip: set[str], kinds=None) -> list[dict]:
        out = []
        for e in found.entries if found else []:
            dist = build_for(e, machine)
            if dist is None or e.id in skip or e.name in skip or (kinds and dist.kind not in kinds):
                continue
            out.append(
                {"id": e.id, "name": e.name, "version": e.version, "description": e.description}
            )
        return out

    def state(expert: InstalledExpert, latest: dict[str, str]) -> str:
        if expert.source == "custom":
            return "ready"
        if _newer(latest.get(expert.id, ""), expert.version):
            return "needs_update"
        return "ready" if expert.logged_in is True else "needs_login"

    async def overview(args: dict) -> str:
        machine = await inspect_fn()
        acp, stale_acp = await listing(registry.acp_agents)
        query = args.get("query")
        query = query.strip() if isinstance(query, str) and query.strip() else None
        mcp, stale_mcp = await listing(lambda: registry.mcp_servers(query))
        latest = {e.id: e.version for e in acp.entries} if acp else {}
        installed = experts()
        return json.dumps(
            {
                "experts": [
                    {
                        "id": e.id,
                        "name": e.name,
                        "version": e.version,
                        "state": state(e, latest),
                        "tested": is_tested(e.id),
                    }
                    for e in installed
                ],
                "apps": apps(),
                "browse_experts": rows(acp, machine, {e.id for e in installed}, _INSTALLABLE),
                "browse_apps": rows(mcp, machine, {a["name"] for a in apps()}),
                "stale": stale_acp or stale_mcp,
                "progress": progress.current(),
                "failed": progress.failed(),
            }
        )

    async def run_with_card(
        tool: str, args: dict, approved: bool, community_ok: bool = False
    ) -> str:
        spec, handler = by_name[tool]
        # An app always has its facts built: they say whether it is Official, which decides if
        # a press is enough. An expert's card is only built when the press is not the OK.
        if not approved or tool == "install_app":
            # The card's facts come from the same code Scout's own install uses; a failing card
            # raises its tool error and nothing is asked or installed. A `{error: token}` one is
            # answered instead, so Home words it like the tool's own refusals.
            try:
                facts = await spec.card(args) if spec.card else dict(args)
            except RpcError as err:
                if err.code == ErrorCode.tool_failed and (token := _token(err.message)):
                    return json.dumps({"error": token})
                raise
            summary = f"{tool} {json.dumps(facts, sort_keys=True, separators=(',', ':'))}"

            # The same history the gate keeps, so these installs count in Home's approvals.
            def log(outcome: str) -> None:
                decided = "none" if outcome in ("no_one", "timed_out") else "person"
                record(
                    source="scout_tool",
                    tool=tool,
                    summary=summary,
                    input=facts,
                    group_key=tool,
                    outcome=outcome,
                    decided_by=decided,
                )

            # A press is the OK for an Official app, and "Connect anyway" on the check card is
            # the OK for a community one; a bare `approved` never installs community code.
            if tool == "install_app" and approved:
                if facts.get("official") is True:
                    return await handler(args)
                if community_ok:
                    log("approved")
                    return await handler(args)
            try:
                answer = await ask(
                    text="",
                    options=["allow", "deny"],
                    tool=tool,
                    input=facts,
                    timeout=ASK_TIMEOUT_S,
                )
            except RpcError as err:
                if err.code == ErrorCode.timeout:
                    log("timed_out")
                raise
            outcome = {"allow": "approved", None: "no_one"}.get(answer.option, "refused")
            log(outcome)
            if outcome != "approved":
                return json.dumps({"error": "denied"})
        return await handler(args)

    def parts(args: dict) -> tuple[dict, bool]:
        inner_args = {k: v for k, v in args.items() if k not in ("approved", "community_ok")}
        return inner_args, args.get("approved") is True

    async def setup_expert(args: dict) -> str:
        inner_args, approved = parts(args)
        installed = {e.id: e for e in experts()}
        found = installed.get(str(args.get("id")))
        tool = "install_expert"
        if found is not None:
            acp, _ = await listing(registry.acp_agents)
            latest = {e.id: e.version for e in acp.entries} if acp else {}
            current = state(found, latest)
            if current == "ready":
                return json.dumps({"error": "already_ready", "detail": found.id})
            if current == "needs_login":
                tool = "login_expert"
        return await run_with_card(tool, inner_args, approved)

    async def setup_app(args: dict) -> str:
        inner_args, approved = parts(args)
        community_ok = args.get("community_ok") is True
        return await run_with_card("install_app", inner_args, approved, community_ok)

    def schema(*extra: str, flags: tuple[str, ...] = ()) -> dict[str, Any]:
        props: dict[str, Any] = {"id": {"type": "string"}, "approved": {"type": "boolean"}}
        props.update({name: {"type": "string"} for name in extra})
        props.update({name: {"type": "boolean"} for name in flags})
        return {"type": "object", "properties": props, "required": ["id", "approved"]}

    home = frozenset({"home"})
    return [
        (
            ToolSpec(
                "setup_overview",
                "What is set up: installed experts and apps with their state, what could be "
                "added (an optional query searches the app registry), and the running install's "
                "progress.",
                {"type": "object", "properties": {"query": {"type": "string"}}},
                home,
                effect="read",
            ),
            overview,
        ),
        (
            ToolSpec(
                "setup_expert",
                "Install, update or log in an expert by id. approved false opens the Allow card.",
                schema(),
                home,
                effect="change",
                tier=Tier.auto,  # asks for itself, so the gate adds none
            ),
            setup_expert,
        ),
        (
            ToolSpec(
                "setup_app",
                "Add an app from the registry by id. approved true connects an Official app "
                "at once; a community one still opens the check card until community_ok "
                "(Connect anyway) is true.",
                schema("query", flags=("community_ok",)),
                home,
                effect="change",
                tier=Tier.auto,  # asks for itself, so the gate adds none
            ),
            setup_app,
        ),
    ]
