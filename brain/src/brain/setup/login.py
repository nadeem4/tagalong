"""Log an installed expert in, on its own subscription: nothing secret passes through Tagalong.

A terminal method (Claude's `claude auth login`) opens a visible window running the adapter's
own command; a browser method (Codex, Gemini) is ACP `authenticate`, and the adapter opens the
browser. Either way a background task waits, re-checks login through ACP, records it and emits
one waking `setup_login` event of facts. API-key methods are never picked.
"""

import asyncio
import os
import shutil
import tempfile
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Literal

import acp
from acp.schema import (
    AuthCapabilities,
    ClientCapabilities,
    DeniedOutcome,
    RequestPermissionResponse,
)

from brain.events import Event
from brain.experts import kill_tree
from brain.setup.env import expert_env
from brain.setup.paths import login_done_file
from brain.setup.store import ExpertStore, InstalledExpert
from brain.setup.terminal import OpenTerminal

LOGIN_TIMEOUT_S = 600.0
CHECK_TIMEOUT_S = 60.0
AUTH_REQUIRED = -32000
# Subscription browser methods, by the ids the adapters use (20a spike).
_BROWSER_IDS = ("chat-gpt", "oauth-personal")


@dataclass(frozen=True)
class Method:
    id: str
    name: str
    kind: Literal["terminal", "browser", "env_var"]
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class LoggedIn:
    pass


@dataclass(frozen=True)
class NotLoggedIn:
    methods: list[Method]


@dataclass(frozen=True)
class Waiting:
    kind: Literal["terminal", "browser"]


@dataclass(frozen=True)
class Failed:
    detail: str


@dataclass(frozen=True)
class Unknown:
    pass


LoginState = LoggedIn | NotLoggedIn | Waiting | Failed | Unknown


def _is_key(method: Method) -> bool:
    return method.kind == "env_var" or "api-key" in method.id or "api_key" in method.id


def pick_method(methods: list[Method]) -> Method | None:
    """A subscription login: Claude's terminal login, else the one terminal method, else a
    known browser one. Never a key."""
    usable = [m for m in methods if not _is_key(m)]
    terminals = [m for m in usable if m.kind == "terminal"]
    for m in terminals:
        if m.id == "claude-ai-login":
            return m
    if len(terminals) == 1:
        return terminals[0]
    browsers = {m.id: m for m in usable if m.kind == "browser"}
    return next((browsers[i] for i in _BROWSER_IDS if i in browsers), None)


def _method(raw) -> Method:
    kind = getattr(raw, "type", None)
    return Method(
        raw.id,
        raw.name,
        "terminal" if kind == "terminal" else "env_var" if kind == "env_var" else "browser",
        list(getattr(raw, "args", None) or []),
        dict(getattr(raw, "env", None) or {}),
    )


class _Client:
    """Login never prompts: anything the adapter asks is cancelled."""

    def on_connect(self, conn) -> None:
        pass

    async def session_update(self, session_id, update, **kw) -> None:
        pass

    async def request_permission(self, session_id, tool_call, options, **kw):
        return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))

    async def ext_method(self, method, params):
        return {}

    async def ext_notification(self, method, params) -> None:
        pass


@asynccontextmanager
async def _agent(expert: InstalledExpert) -> AsyncIterator[tuple[object, list[Method]]]:
    """The expert's adapter, initialized with the terminal-login capability (without it Claude
    lists no methods). Its whole process tree is gone on exit, however we leave."""
    exe = shutil.which(expert.command[0])
    if exe is None:
        raise FileNotFoundError(expert.command[0])
    async with acp.spawn_agent_process(
        _Client(),
        exe,
        *expert.command[1:],
        env=expert_env(expert.id, os.environ),
        transport_kwargs={"stderr": asyncio.subprocess.DEVNULL},
        use_unstable_protocol=True,
    ) as (conn, process):
        try:
            hello = await conn.initialize(
                protocol_version=acp.PROTOCOL_VERSION,
                client_capabilities=ClientCapabilities(auth=AuthCapabilities(terminal=True)),
            )
            yield conn, [_method(m) for m in hello.auth_methods or []]
        finally:
            with suppress(Exception):
                process.stdin.close()
            await asyncio.shield(kill_tree(process))


class LoginDriver:
    def __init__(
        self,
        home: Path,
        store: ExpertStore,
        open_terminal: OpenTerminal,
        emit: Callable[[Event], None],
        timeout_s: float = LOGIN_TIMEOUT_S,
        poll_s: float = 0.5,
    ) -> None:
        self._home, self._store, self._open = home, store, open_terminal
        self._emit, self._timeout, self._poll = emit, timeout_s, poll_s
        self._tasks: dict[str, asyncio.Task] = {}

    async def check(self, expert: InstalledExpert) -> LoginState:
        """Is the expert logged in? Starts a session and sends no prompt."""
        methods: list[Method] = []
        try:
            async with asyncio.timeout(CHECK_TIMEOUT_S):
                async with _agent(expert) as (conn, methods):
                    with tempfile.TemporaryDirectory() as scratch:
                        await conn.new_session(cwd=scratch, mcp_servers=[])
            return LoggedIn()
        except acp.RequestError as err:
            return NotLoggedIn(methods) if err.code == AUTH_REQUIRED else Unknown()
        except Exception:  # cannot start or answer: we do not know
            return Unknown()

    async def start(self, expert: InstalledExpert) -> LoginState:
        """Begin a login and return at once; the end arrives as a `setup_login` event.
        Raises NoTerminal where no window can open (Scout then gives the command)."""
        state = await self.check(expert)
        if isinstance(state, LoggedIn):
            self._store.set_login(expert.id, True)
        if not isinstance(state, NotLoggedIn):
            return state
        method = pick_method(state.methods)
        if method is None:
            return Failed("no subscription login method this computer can run")
        await self._cancel(expert.id)
        if method.kind == "terminal":
            done = login_done_file(self._home, expert.id)
            done.parent.mkdir(parents=True, exist_ok=True)
            done.unlink(missing_ok=True)
            argv = [*expert.command, *method.args]
            await self._open(argv, {**expert_env(expert.id, os.environ), **method.env}, done)
            wait = partial(self._wait_window, done)
            waiting = Waiting("terminal")
        else:
            wait = partial(self._wait_browser, expert, method)
            waiting = Waiting("browser")
        self._tasks[expert.id] = task = asyncio.ensure_future(self._finish(expert, wait))
        task.add_done_callback(
            lambda t: self._tasks.get(expert.id) is t and self._tasks.pop(expert.id)
        )
        return waiting

    async def stop(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _cancel(self, expert_id: str) -> None:
        if task := self._tasks.pop(expert_id, None):
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _wait_window(self, done: Path) -> str:
        """'' when the window's command ended with 0, else what went wrong."""
        try:
            async with asyncio.timeout(self._timeout):
                while not done.exists():
                    await asyncio.sleep(self._poll)
        except TimeoutError:
            return "timeout"
        code = done.read_text(encoding="utf-8", errors="replace").strip()
        return "" if code in ("", "0") else f"the window ended with exit code {code}"

    async def _wait_browser(self, expert: InstalledExpert, method: Method) -> str:
        try:
            async with asyncio.timeout(self._timeout):
                async with _agent(expert) as (conn, _):
                    await conn.authenticate(method_id=method.id)
        except TimeoutError:
            return "timeout"
        except Exception as err:
            return f"{type(err).__name__}: {err}" if str(err) else type(err).__name__
        return ""

    async def _finish(self, expert: InstalledExpert, wait) -> None:
        detail = await wait()
        if detail == "timeout":
            self._tell(expert.id, "failed", "timeout")
            return
        state = await self.check(expert)
        if isinstance(state, LoggedIn):
            self._store.set_login(expert.id, True)
            self._tell(expert.id, "logged_in")
        elif isinstance(state, Unknown):
            self._store.set_login(expert.id, None)
            self._tell(expert.id, "unknown", detail)
        else:
            self._store.set_login(expert.id, False)
            self._tell(expert.id, "failed", detail or "still not logged in")

    def _tell(self, expert_id: str, state: str, detail: str = "") -> None:
        facts: dict[str, str | int] = {"expert": expert_id, "state": state}
        if detail:
            facts["detail"] = detail
        self._emit(Event("setup_login", facts, key=expert_id))
