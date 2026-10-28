"""Connected apps (MCP servers): the row type, helpers, validation, and the Apps manager.

The store lives in memory.py (which imports this module, so Memory is type-only here). Secrets
never enter a row: `${VAR}` refs stay verbatim and are expanded only at connect time, and tokens
go to their own file. Apps keeps one long-lived task per app so each SDK transport opens and
closes in the same task (anyio cancel scopes break when they are closed from another one).
"""

import asyncio
import json
import logging
import os
import re
import shutil
from collections.abc import Callable, Mapping
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client
from mcp.shared.exceptions import MCPError
from mcp.types import (
    CONNECTION_CLOSED,
    CallToolResult,
    PaginatedRequestParams,
    Tool,
    ToolListChangedNotification,
)

if TYPE_CHECKING:
    from brain.memory import Memory

log = logging.getLogger("brain")

# Ids the brain's own bodies use; an app slug must never shadow them.
RESERVED_IDS = frozenset({"desktop", "extension", "brain"})
SLUG_MAX = 24
TRANSPORTS = ("stdio", "http")
AUTHS = ("none", "token", "oauth")
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_ENV_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


class AppError(Exception):
    """A refusal as one plain line the model or user can read and act on."""


@dataclass(frozen=True)
class AppRow:
    id: str
    name: str
    transport: str
    config: dict[str, Any]
    auth: str
    enabled: bool


def slug_for(name: str, taken: set[str] | frozenset[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:SLUG_MAX].strip("-") or "app"
    blocked = set(taken) | RESERVED_IDS
    if base not in blocked:
        return base
    n = 2
    while True:
        suffix = f"-{n}"
        slug = base[: SLUG_MAX - len(suffix)].rstrip("-") + suffix
        if slug not in blocked:
            return slug
        n += 1


def expand_env(value: str, env: dict[str, str] | Any) -> str:
    """Replace ${VAR} and ${VAR:-default}; an unset variable raises naming only the variable."""

    def sub(m: re.Match[str]) -> str:
        name, default = m.group(1), m.group(2)
        if name in env:
            return env[name]
        if default is not None:
            return default
        raise AppError(f"needs {name} set in brain's environment")

    return _ENV_REF.sub(sub, value)


def _check_stdio(config: dict[str, Any]) -> dict[str, Any]:
    command = config.get("command")
    if not isinstance(command, str) or not command.strip():
        raise AppError("a stdio app needs a command.")
    args = config.get("args", [])
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        raise AppError("args must be a list of strings.")
    env = config.get("env", {})
    if not isinstance(env, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in env.items()
    ):
        raise AppError("env must map names to strings.")
    return {"command": command, "args": args, "env": env}


def _check_http(config: dict[str, Any]) -> dict[str, Any]:
    url = config.get("url")
    if not isinstance(url, str) or not url.strip():
        raise AppError("an http app needs a url.")
    parts = urlparse(url)
    local = parts.hostname in _LOCAL_HOSTS
    if parts.scheme != "https" and not (parts.scheme == "http" and local):
        raise AppError("the url must use https (http is only allowed for localhost).")
    return {"url": url}


def validate_app(params: dict[str, Any], taken: set[str] | frozenset[str] = frozenset()) -> AppRow:
    if "token" in params:
        raise AppError("a token is never part of an app; it is stored separately.")
    name = params.get("name")
    if not isinstance(name, str) or not name.strip():
        raise AppError("the app needs a name.")
    transport = params.get("transport")
    if transport not in TRANSPORTS:
        raise AppError(f"transport must be one of: {', '.join(TRANSPORTS)}.")
    auth = params.get("auth", "none")
    if auth not in AUTHS:
        raise AppError(f"auth must be one of: {', '.join(AUTHS)}.")
    config = params.get("config")
    if not isinstance(config, dict):
        raise AppError("the app needs a config.")
    checked = _check_stdio(config) if transport == "stdio" else _check_http(config)
    name = name.strip()
    return AppRow(slug_for(name, taken), name, transport, checked, auth, True)


class TokenFile:
    """App tokens live in `data_dir/app-tokens.json`, never in the apps table or an error line.

    Kept owner-only (0600) where the platform honours it; on Windows chmod does little, so the
    file relies on the user's profile folder permissions.
    """

    def __init__(self, data_dir: Path | str) -> None:
        self._path = Path(data_dir) / "app-tokens.json"

    def _read(self) -> dict[str, str]:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write(self, data: dict[str, str]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, self._path)

    def get(self, app_id: str) -> str | None:
        return self._read().get(app_id)

    def set(self, app_id: str, token: str) -> None:
        self._write({**self._read(), app_id: token})

    def delete(self, app_id: str) -> None:
        data = self._read()
        if data.pop(app_id, None) is not None:
            self._write(data)


@dataclass(frozen=True)
class AppStatus:
    state: str  # off | connecting | connected | needs-sign-in | error
    error: str = ""
    tool_count: int = 0


@dataclass
class _Slot:
    row: AppRow
    state: str = "off"
    error: str = ""
    tools: list[Tool] = field(default_factory=list)  # kept after a disconnect for the UI
    session: ClientSession | None = None
    task: asyncio.Task | None = None
    wake: asyncio.Event = field(default_factory=asyncio.Event)
    stopping: bool = False
    relist: bool = False
    dropped: bool = False  # the connection closed; the app task then tears down
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)  # serialises stop and restart


def _plain(exc: BaseException) -> str:
    """The first line of the real error; never anything from env values."""
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    if isinstance(exc, TimeoutError):
        return "did not answer in time"
    lines = str(exc).strip().splitlines()
    return lines[0] if lines else type(exc).__name__


class Apps:
    def __init__(
        self,
        memory: "Memory",
        notify: Callable[[str, dict], None],
        env: Mapping[str, str],
        connect_timeout: float = 30,
        ping_interval: float = 30,
        tokens: TokenFile | None = None,
    ) -> None:
        self._memory = memory
        self._notify = notify
        self._env = env
        self._connect_timeout = connect_timeout
        self._ping_interval = ping_interval  # how often an idle connection is checked alive
        self._tokens = tokens
        self._slots: dict[str, _Slot] = {}

    async def start(self) -> None:
        """Begin connecting every enabled app in the background and return at once."""
        for row in self._memory.list_apps():
            self._launch(row)

    async def restart(self, app_id: str) -> None:
        row = next((r for r in self._memory.list_apps() if r.id == app_id), None)
        old = self._slots.get(app_id)
        if row is None:
            await self.stop(app_id)
            self._slots.pop(app_id, None)
            raise AppError(f"no app {app_id}.")
        if old is None:
            self._launch(row)
            return
        async with old.lock:  # shared by every slot of this app, so re-read the current one
            current = self._slots[app_id]
            await self._stop(current)
            self._launch(row)

    async def stop(self, app_id: str) -> None:
        slot = self._slots.get(app_id)
        if slot is not None:
            async with slot.lock:
                await self._stop(self._slots[app_id])

    async def _stop(self, slot: _Slot) -> None:
        if slot.task is None:
            return
        task, slot.task = slot.task, None
        slot.stopping = True
        slot.wake.set()
        if slot.state == "connecting":
            task.cancel()
        done, _ = await asyncio.wait({task}, timeout=15)
        if not done:  # a stuck close must not hang shutdown
            task.cancel()
            await asyncio.wait({task}, timeout=5)
        self._set(slot, "off")

    async def shutdown(self) -> None:
        await asyncio.gather(*(self.stop(app_id) for app_id in list(self._slots)))

    def status(self, app_id: str) -> AppStatus:
        slot = self._slots.get(app_id)
        if slot is None:
            return AppStatus("off")
        return AppStatus(slot.state, slot.error, len(slot.tools))

    def ids(self) -> list[str]:
        return list(self._slots)

    def name(self, app_id: str) -> str:
        slot = self._slots.get(app_id)
        return slot.row.name if slot else app_id

    def tools(self, app_id: str) -> list[Tool]:
        slot = self._slots.get(app_id)
        return list(slot.tools) if slot else []

    async def call(
        self, app_id: str, tool: str, args: dict[str, Any], timeout: float = 60
    ) -> CallToolResult:
        slot = self._slots.get(app_id)
        if slot is None:
            raise AppError(f"no app {app_id}.")
        session = slot.session
        if slot.state != "connected" or session is None:
            raise AppError(f"{slot.row.name} is not connected.")
        try:
            async with asyncio.timeout(timeout):
                return await session.call_tool(tool, args)
        except TimeoutError:
            raise AppError(f"{slot.row.name} did not answer in time.") from None
        except MCPError as exc:
            if exc.code != CONNECTION_CLOSED:
                raise AppError(f"{slot.row.name} said: {_plain(exc)}") from None
            raise self._drop(slot) from None
        except Exception as exc:
            raise AppError(f"{slot.row.name}: {_plain(exc)}") from None

    def _drop(self, slot: _Slot) -> AppError:
        message = f"The connection {slot.row.name} closed."
        self._set(slot, "error", message)
        slot.dropped = True
        slot.wake.set()
        return AppError(message)

    def _launch(self, row: AppRow) -> None:
        old = self._slots.get(row.id)
        slot = _Slot(row, tools=old.tools if old else [], lock=old.lock if old else asyncio.Lock())
        self._slots[row.id] = slot
        if not row.enabled:
            return
        self._set(slot, "connecting")
        slot.task = asyncio.create_task(self._run(slot))

    def _set(self, slot: _Slot, state: str, error: str = "") -> None:
        if (slot.state, slot.error) != (state, error):
            slot.state, slot.error = state, error
            self._notify("changed", {"what": "apps"})

    async def _run(self, slot: _Slot) -> None:
        # Everything, including the error handling, sits outside the stack's `async with` so a
        # failure unwinds through the transport's own cancel scopes before we look at it.
        try:
            async with AsyncExitStack() as stack:
                async with asyncio.timeout(self._connect_timeout):
                    session = await self._connect(stack, slot)
                    await session.initialize()
                    tools = await self._list(session)
                slot.session, slot.tools = session, tools
                self._set(slot, "connected")
                while True:
                    try:
                        await asyncio.wait_for(slot.wake.wait(), self._ping_interval)
                    except TimeoutError:
                        await self._ping(slot, session)
                    slot.wake.clear()
                    if slot.stopping:
                        return
                    if slot.dropped:
                        raise AppError(f"The connection {slot.row.name} closed.")
                    if slot.relist:
                        slot.relist = False
                        try:
                            async with asyncio.timeout(self._connect_timeout):
                                slot.tools = await self._list(session)
                            self._notify("changed", {"what": "apps"})
                        except Exception:
                            log.warning(
                                "could not refresh tools for %s", slot.row.id, exc_info=True
                            )
        except Exception as exc:
            self._set(slot, "error", _plain(exc))
        finally:
            slot.session = None

    async def _ping(self, slot: _Slot, session: ClientSession) -> None:
        try:
            async with asyncio.timeout(self._connect_timeout):
                await session.send_ping()
        except Exception:
            slot.dropped = True
            slot.wake.set()

    async def _connect(self, stack: AsyncExitStack, slot: _Slot) -> ClientSession:
        row = slot.row
        if row.transport == "stdio":
            command = row.config["command"]
            exe = shutil.which(command)
            if exe is None:
                raise AppError(f"cannot find the command {command}")
            env = {k: expand_env(v, self._env) for k, v in row.config.get("env", {}).items()}
            params = StdioServerParameters(command=exe, args=row.config.get("args", []), env=env)
            errlog = stack.enter_context(open(os.devnull, "w"))  # noqa: SIM115
            read, write = await stack.enter_async_context(stdio_client(params, errlog=errlog))
        else:
            headers = None
            if row.auth == "token":
                token = self._tokens.get(row.id) if self._tokens else None
                if not token:
                    raise AppError(f"{row.name} needs its token added again.")
                headers = {"Authorization": f"Bearer {token}"}
            client = await stack.enter_async_context(create_mcp_http_client(headers=headers))
            read, write = await stack.enter_async_context(
                streamable_http_client(row.config["url"], http_client=client)
            )

        async def on_message(message: object) -> None:
            # Re-listing here would wait on the receive loop that is running this handler.
            if isinstance(message, ToolListChangedNotification):
                slot.relist = True
                slot.wake.set()

        return await stack.enter_async_context(
            ClientSession(read, write, message_handler=on_message)
        )

    async def _list(self, session: ClientSession) -> list[Tool]:
        tools: list[Tool] = []
        params = None
        while True:
            page = await session.list_tools(params=params)
            tools.extend(page.tools)
            if not page.next_cursor:
                return tools
            params = PaginatedRequestParams(cursor=page.next_cursor)
