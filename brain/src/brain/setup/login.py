"""Log an installed expert in, on its own subscription: nothing secret passes through Tagalong.

A terminal method (Claude's `claude auth login`) opens a visible window running the adapter's
own command; a browser method (Codex) is ACP `authenticate`, and the adapter opens the
browser. `start` returns at once with a `signin` open item; one background flight per expert
checks login through ACP (so the card never waits on it), signs in, re-checks, records it and
emits one waking `setup_login` event of facts. A second request joins the running flight.
API-key methods are never picked.
"""

import asyncio
import os
import shutil
import tempfile
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
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
from brain.open_items import OpenItem, OpenItems
from brain.setup.env import expert_env
from brain.setup.flights import Flights
from brain.setup.paths import login_done_file
from brain.setup.store import ExpertStore, InstalledExpert
from brain.setup.terminal import NoTerminal, OpenTerminal

LOGIN_TIMEOUT_S = 600.0
CHECK_TIMEOUT_S = 60.0
AUTH_REQUIRED = -32000
# Subscription browser methods, by the ids the adapters use (20a spike).
_BROWSER_IDS = ("chat-gpt",)


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
class Unknown:
    pass


LoginState = LoggedIn | NotLoggedIn | Unknown


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


def _read_code(done: Path) -> str:
    try:
        return done.read_text(encoding="utf-8", errors="replace").strip()
    except FileNotFoundError:
        return ""


class LoginDriver:
    def __init__(
        self,
        home: Path,
        store: ExpertStore,
        open_terminal: OpenTerminal,
        emit: Callable[[Event], None],
        items: OpenItems,
        timeout_s: float = LOGIN_TIMEOUT_S,
        poll_s: float = 0.5,
        notify: Callable[[str, dict], None] | None = None,
    ) -> None:
        self._home, self._store, self._open = home, store, open_terminal
        self._emit, self._timeout, self._poll = emit, timeout_s, poll_s
        self._notify = notify or (lambda *_: None)
        self._items = items
        self._flights = Flights(items, "signin")

    async def check(self, expert: InstalledExpert) -> LoginState:
        """Is the expert logged in? Starts a session and sends no prompt."""
        methods: list[Method] = []
        try:
            async with asyncio.timeout(CHECK_TIMEOUT_S):
                async with _agent(expert) as (conn, methods):
                    # Windows: the adapter may still hold the folder, and a failed cleanup
                    # must never turn a good check into Unknown.
                    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as scratch:
                        await conn.new_session(cwd=scratch, mcp_servers=[])
            return LoggedIn()
        except acp.RequestError as err:
            return NotLoggedIn(methods) if err.code == AUTH_REQUIRED else Unknown()
        except Exception:  # cannot start or answer: we do not know
            return Unknown()

    def start(self, expert: InstalledExpert) -> tuple[OpenItem, bool]:
        """Begin a sign-in and return at once with its open item (and whether it joined one
        already running). Every check and the window run in the background; the end arrives
        as one `setup_login` event."""
        flight = self._flights.start(expert.id, lambda: self._run(expert))
        return flight.item, flight.joined

    async def stop(self) -> None:
        await self._flights.stop()

    async def _run(self, expert: InstalledExpert) -> None:
        state = await self.check(expert)
        detail = ""
        if isinstance(state, NotLoggedIn):
            method = pick_method(state.methods)
            if method is None:
                self._conclude(
                    expert.id, state, "no subscription login method this computer can run"
                )
                return
            try:
                detail = await self._sign_in(expert, method)
            except NoTerminal as err:  # Scout gives the person the command to run themselves
                self._tell(expert.id, "failed", "no_terminal", command=err.command)
                return
            if detail == "timeout":
                self._tell(expert.id, "failed", "timeout")
                return
            state = await self.check(expert)
        self._conclude(expert.id, state, detail)

    async def _sign_in(self, expert: InstalledExpert, method: Method) -> str:
        """Open the window (or start the browser method) and wait; '' when it ended well."""
        if method.kind == "browser":
            return await self._wait_browser(expert, method)
        done = login_done_file(self._home, expert.id)
        done.parent.mkdir(parents=True, exist_ok=True)
        done.unlink(missing_ok=True)
        argv = [*expert.command, *method.args]
        await self._open(argv, {**expert_env(expert.id, os.environ), **method.env}, done)
        return await self._wait_window(done)

    async def _wait_window(self, done: Path) -> str:
        """'' when the window's command ended with 0, else what went wrong."""
        try:
            async with asyncio.timeout(self._timeout):
                # Writers create the file before its text lands, and every writer writes
                # something, so an empty file means "not yet", never success.
                while not (code := _read_code(done)):
                    await asyncio.sleep(self._poll)
        except TimeoutError:
            return "timeout"
        return "" if code == "0" else f"the window ended with exit code {code}"

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

    def _conclude(self, expert_id: str, state: LoginState, detail: str) -> None:
        try:
            if isinstance(state, LoggedIn):
                self._store.set_login(expert_id, True)
                self._tell(expert_id, "logged_in")
            elif isinstance(state, Unknown):
                self._store.set_login(expert_id, None)
                self._tell(expert_id, "unknown", detail)
            else:
                self._store.set_login(expert_id, False)
                self._tell(expert_id, "failed", detail or "still not logged in")
        except OSError as err:
            self._tell(expert_id, "failed", f"could not save the result: {err}")

    def _tell(self, expert_id: str, state: str, detail: str = "", command: str = "") -> None:
        facts: dict[str, str | int] = {"expert": expert_id, "state": state}
        if detail:
            facts["detail"] = detail
        if command:
            facts["command"] = command
        self._emit(Event("setup_login", facts, key=expert_id))
        self._notify("changed", {"what": "setup"})  # Home's chip and the tour reload
