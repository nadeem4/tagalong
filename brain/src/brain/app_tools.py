"""Maps a connected app's MCP tools to toolbox specs, and runs them as a toolbox source.

Names become `app__tool` (safe characters, short enough for the model API). Permissions come
from the tool's hints, but a risky word in the name always locks it, since hints are the
app's own claim and cannot be trusted to lower the bar. Results come back fenced as data.
"""

import json
import logging
import re
from typing import TYPE_CHECKING, Literal
from urllib.parse import urlsplit, urlunsplit

from mcp.types import (
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    ResourceLink,
    TextContent,
    TextResourceContents,
    Tool,
)

from brain.apps import (
    AUTHS,
    TRANSPORTS,
    AppError,
    AppRow,
    Apps,
    TokenFile,
    split_secrets,
    validate_app,
)
from brain.bodies import Bodies
from brain.mind.turn import Call
from brain.protocol import ErrorCode, RpcError
from brain.toolbox import NAME_MAX, SEP, Handler, ToolSpec
from brain.tools import Notify, _fence_safe

if TYPE_CHECKING:
    from brain.memory import Memory

log = logging.getLogger("brain")

# Whole words that mean money or data leaves or is lost; these always ask.
RISKY = frozenset({"send", "delete", "remove", "destroy", "trash", "pay", "charge"})


def _words(name: str) -> list[str]:
    """Split on `_ - . space` and camelCase, lowercased."""
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    return [w.lower() for w in re.split(r"[_\-. ]+", spaced) if w]


def classify(tool: Tool) -> tuple[Literal["read", "change"], bool]:
    """Return (effect, locked). No annotations means a change; risk wins over hints."""
    hints = tool.annotations
    locked = bool(hints and hints.destructive_hint) or bool(RISKY & set(_words(tool.name)))
    read = bool(hints and hints.read_only_hint) and not locked
    return ("read" if read else "change"), locked


def _tool_part(name: str, app_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)[: NAME_MAX - len(app_id) - len(SEP)]


def spec_for(app_id: str, tool: Tool) -> ToolSpec | None:
    """One MCP tool as a scout-only spec; None when it has no usable name."""
    part = _tool_part(tool.name, app_id)
    if not part:
        return None
    effect, locked = classify(tool)
    return ToolSpec(
        f"{app_id}{SEP}{part}",
        tool.description or "",
        tool.input_schema,
        effect=effect,
        locked=locked,
    )


_warned: set[tuple[str, str, str]] = set()  # specs run every turn; warn once per bad name


def _first_time(kind: str, key: str, name: str) -> bool:
    item = (kind, key, name)
    if item in _warned:
        return False
    _warned.add(item)
    return True


def specs_for(app_id: str, tools: list[Tool]) -> list[ToolSpec]:
    """All of an app's specs; when two names collide the first wins and the rest are logged."""
    out: dict[str, ToolSpec] = {}
    for tool in tools:
        spec = spec_for(app_id, tool)
        if spec is None:
            if _first_time("empty", app_id, tool.name):
                log.warning("app tool has no usable name, dropped: %s/%r", app_id, tool.name)
        elif spec.name in out:
            if _first_time("clash", spec.name, tool.name):
                log.warning("app tool name clash, dropped: %s (from %r)", spec.name, tool.name)
        else:
            out[spec.name] = spec
    return list(out.values())


RESULT_MAX = 8000  # characters of an app's answer that reach the model


def _first_line(text: str) -> str:
    lines = text.strip().splitlines()
    return lines[0] if lines else "no reason given"


def _block_text(block: object) -> str:
    if isinstance(block, TextContent):
        return block.text
    if isinstance(block, ResourceLink):
        return f"{block.name} {block.uri}"
    if isinstance(block, ImageContent):
        return f"[image: {block.mime_type}]"
    if isinstance(block, EmbeddedResource):
        res = block.resource
        return res.text if isinstance(res, TextResourceContents) else f"[resource: {res.uri}]"
    return ""


def result_text(result: CallToolResult) -> str:
    parts = [t for t in (_block_text(b) for b in result.content) if t]
    if parts:
        return "\n".join(parts)
    if result.structured_content is not None:
        return json.dumps(result.structured_content)
    return ""


def format_result(app_id: str, result: CallToolResult) -> str:
    """An app's answer as capped, fenced data the model reads but never obeys."""
    body = result_text(result)
    if len(body) > RESULT_MAX:
        body = body[: RESULT_MAX - 1] + "\u2026"
    return f'<data kind="app" app="{app_id}">\n{_fence_safe(body)}\n</data>'


def app_home_tools(
    apps: Apps, memory: "Memory", tokens: TokenFile, notify: Notify, bodies: Bodies
) -> list[tuple[ToolSpec, Handler]]:
    """Home-only calls to manage apps. Refusals are plain lines raised as invalid_params.

    `bodies` is how sign-in reaches a browser: Apps knows no bodies, so the open_url it is
    handed here asks an online body to run its own open_url tool."""

    def refuse(message: str) -> RpcError:
        return RpcError(ErrorCode.invalid_params, message)

    def known(args: dict) -> str:
        app_id = args.get("id")
        if not any(r.id == app_id for r in memory.list_apps()):
            raise refuse(f"There is no app called {app_id}.")
        return app_id

    def target(row) -> dict:
        """Where the app runs, for Home. Never env, tokens or url secrets (userinfo, query)."""
        if row.transport == "http":
            try:
                parts = urlsplit(row.config.get("url", ""))
                host = parts.hostname or ""
                if ":" in host:
                    host = f"[{host}]"
                netloc = f"{host}:{parts.port}" if parts.port else host
                return {"url": urlunsplit((parts.scheme, netloc, parts.path, "", ""))}
            except ValueError:  # one bad row must not hide every app
                return {"url": ""}
        return {"command": row.config.get("command", ""), "args": row.config.get("args", [])}

    async def list_apps(args: dict) -> str:
        rows = []
        for row in memory.list_apps():
            status = apps.status(row.id)
            tools = [
                {"name": s.name, "effect": s.effect, "locked": s.locked}
                for s in specs_for(row.id, apps.tools(row.id))
            ]
            rows.append(
                {
                    "id": row.id,
                    "name": row.name,
                    "transport": row.transport,
                    "auth": row.auth,
                    "enabled": row.enabled,
                    **target(row),
                    "status": status.state,
                    "error": status.error,
                    "tools": tools,
                }
            )
        return json.dumps({"apps": rows})

    async def add_app(args: dict) -> str:
        args = dict(args)
        token = args.pop("token", None)
        config = {k: args[k] for k in ("command", "args", "env", "url") if k in args}
        params = {k: args[k] for k in ("name", "transport", "auth") if k in args}
        try:
            row = validate_app(
                {**params, "config": config}, taken={r.id for r in memory.list_apps()}
            )
        except AppError as exc:
            raise refuse(str(exc)) from None
        if row.auth == "token" and not (isinstance(token, str) and token):
            raise refuse("an app with token sign-in needs its token.")
        if token is not None and row.auth != "token":
            raise refuse("a token only goes with auth token.")
        clean, secrets = split_secrets(row.id, row.config, row.transport)
        row = AppRow(row.id, row.name, row.transport, clean, row.auth, row.enabled)
        try:
            if token is not None:
                tokens.set(row.id, token)
            for key, value in secrets.items():
                tokens.set(key, value)
            memory.add_app(row)
        except BaseException:
            tokens.clear_app(row.id)  # a failed save must not leave a secret behind
            raise
        await apps.restart(row.id)
        notify("changed", {"what": "apps"})
        return json.dumps({"id": row.id})

    async def set_app_enabled(args: dict) -> str:
        app_id = known(args)
        enabled = args.get("enabled")
        if not isinstance(enabled, bool):
            raise refuse("set_app_enabled needs enabled true or false.")
        memory.set_app_enabled(app_id, enabled)
        await apps.restart(app_id)
        notify("changed", {"what": "apps"})
        return json.dumps({"id": app_id, "enabled": enabled})

    async def remove_app(args: dict) -> str:
        app_id = known(args)
        memory.remove_app(app_id)
        tokens.clear_app(app_id)
        try:
            await apps.restart(app_id)  # row gone: it stops the app and forgets its slot
        except AppError:
            pass
        notify("changed", {"what": "apps"})
        return json.dumps({"id": app_id, "removed": True})

    async def restart_app(args: dict) -> str:
        app_id = known(args)
        await apps.restart(app_id)
        return json.dumps({"id": app_id, "restarting": True})

    def browser_body() -> str | None:
        """An online body that can open a web page on the person's machine."""
        return next(
            (b for b in bodies.online_ids() if any(t.name == "open_url" for t in bodies.tools(b))),
            None,
        )

    async def sign_in_app(args: dict) -> str:
        app_id = known(args)
        row = next(r for r in memory.list_apps() if r.id == app_id)
        if row.auth != "oauth":
            raise refuse(f"{row.name} does not use sign-in.")
        if not row.enabled:
            raise refuse(f"Turn {row.name} on before signing in.")
        body_id = browser_body()
        if body_id is None:
            raise refuse("Open Tagalong on the machine the brain runs on to sign in.")

        async def open_url(url: str) -> None:
            await bodies.use(body_id, f"sign-in-{app_id}", "open_url", {"url": url})

        try:
            await apps.sign_in(app_id, open_url)
        except AppError as exc:
            raise refuse(str(exc)) from None
        return json.dumps({"id": app_id, "status": "connecting"})

    home = frozenset({"home"})
    by_id = {
        "type": "object",
        "properties": {"id": {"type": "string"}},
        "required": ["id"],
    }
    add_schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "transport": {"type": "string", "enum": list(TRANSPORTS)},
            "command": {"type": "string"},
            "args": {"type": "array", "items": {"type": "string"}},
            "env": {"type": "object", "additionalProperties": {"type": "string"}},
            "url": {"type": "string"},
            "auth": {"type": "string", "enum": list(AUTHS)},
            "token": {"type": "string"},
        },
        "required": ["name", "transport"],
    }
    enabled_schema = {
        "type": "object",
        "properties": {"id": {"type": "string"}, "enabled": {"type": "boolean"}},
        "required": ["id", "enabled"],
    }
    return [
        (
            ToolSpec(
                "list_apps",
                "Every connected app with its status and tools.",
                {"type": "object", "properties": {}},
                home,
                effect="read",
            ),
            list_apps,
        ),
        (
            ToolSpec("add_app", "Add an app and connect it.", add_schema, home, effect="change"),
            add_app,
        ),
        (
            ToolSpec(
                "set_app_enabled",
                "Turn an app on or off.",
                enabled_schema,
                home,
                effect="change",
            ),
            set_app_enabled,
        ),
        (
            ToolSpec("remove_app", "Remove an app.", by_id, home, effect="change"),
            remove_app,
        ),
        (
            ToolSpec("restart_app", "Reconnect an app.", by_id, home, effect="change"),
            restart_app,
        ),
        (
            ToolSpec(
                "sign_in_app",
                "Open an app's sign-in page in the browser; it connects when the person finishes.",
                by_id,
                home,
                effect="change",
            ),
            sign_in_app,
        ),
    ]


class AppSource:
    """Connected apps' tools as a toolbox source; modes reuse the permissions table."""

    approval_source = "app"

    def __init__(self, apps: Apps) -> None:
        self._apps = apps

    def specs(self) -> list[ToolSpec]:
        return [
            spec
            for app_id in self._apps.ids()
            if self._apps.status(app_id).state == "connected"
            for spec in specs_for(app_id, self._apps.tools(app_id))
        ]

    def known_specs(self) -> list[ToolSpec]:
        return [
            spec
            for app_id in self._apps.ids()
            for spec in specs_for(app_id, self._apps.tools(app_id))
        ]

    async def run(self, call: Call, tool: str) -> str | list[dict]:
        app_id, _, part = tool.partition(SEP)
        name = self._apps.name(app_id)
        real = next(
            (t.name for t in self._apps.tools(app_id) if _tool_part(t.name, app_id) == part), None
        )
        if real is None:
            raise RpcError(ErrorCode.unknown_tool, f"No tool named {tool}.")
        try:
            result = await self._apps.call(app_id, real, call.input)
        except AppError as exc:
            raise RpcError(ErrorCode.tool_failed, str(exc)) from None
        if result.is_error:
            reason = _first_line(result_text(result))
            raise RpcError(ErrorCode.tool_failed, f"{name} could not do that: {reason}")
        return format_result(app_id, result)

    def unavailable(self, name: str) -> RpcError | None:
        app_id, sep, _ = name.partition(SEP)
        if sep and app_id in self._apps.ids() and self._apps.status(app_id).state != "connected":
            return RpcError(
                ErrorCode.body_offline, f"{self._apps.name(app_id)} is not connected right now."
            )
        return None
