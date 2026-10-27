"""ExpertRun: drives Claude Code in a folder over ACP, knowing nothing of asks or jobs.

It spawns the ACP adapter, runs one session, and reports through callbacks (all async):
on_permission(request) -> option id | None, on_question(question) -> answer dict | None
(None cancels), on_progress(text), on_end(state, reason, result) with state done, error
or stopped. The API key variables are stripped from the child so Claude Code bills the
user's own login. The adapter may be a .cmd shim and spawn children, so teardown kills
the whole tree if closing stdin does not end it.
"""

import asyncio
import os
import shutil
import subprocess
import sys
from collections.abc import Awaitable, Callable
from contextlib import AsyncExitStack, suppress
from dataclasses import dataclass
from pathlib import Path

import acp
from acp.schema import (
    AcceptElicitationResponse,
    AllowedOutcome,
    CancelElicitationResponse,
    ClientCapabilities,
    DeniedOutcome,
    ElicitationCapabilities,
    ElicitationFormCapabilities,
    RequestPermissionResponse,
)

STRIPPED_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")
INSTALL_STEP = "npm install -g @agentclientprotocol/claude-agent-acp"
_NO_MESSAGE = object()


class ExpertError(RuntimeError):
    pass


@dataclass(frozen=True)
class Mode:
    id: str
    name: str
    description: str


@dataclass(frozen=True)
class PermissionOption:
    id: str
    name: str
    kind: str


@dataclass(frozen=True)
class PermissionRequest:
    title: str
    kind: str
    input: dict
    options: list[PermissionOption]


@dataclass(frozen=True)
class QuestionField:
    key: str  # answer under this key; free text goes under f"{key}_custom"
    title: str
    options: list[str]


@dataclass(frozen=True)
class Question:
    message: str
    fields: list[QuestionField]


async def kill_tree(process: asyncio.subprocess.Process) -> None:
    """End the process and its children; taskkill /T is the only way to reach them on Windows."""
    if process.returncode is not None:
        return
    if sys.platform == "win32":
        killer = await asyncio.create_subprocess_exec(
            "taskkill",
            "/PID",
            str(process.pid),
            "/T",
            "/F",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        await killer.wait()
    else:
        with suppress(ProcessLookupError):
            process.kill()
    await process.wait()


class ExpertRun:
    def __init__(
        self,
        *,
        command: list[str],
        timeout: float,
        on_permission: Callable[[PermissionRequest], Awaitable[str | None]],
        on_question: Callable[[Question], Awaitable[dict | None]],
        on_progress: Callable[[str], Awaitable[None]],
        on_end: Callable[[str, str, str | None], Awaitable[None]],
        grace: float = 3.0,
    ) -> None:
        self._command = command
        self._timeout = timeout
        self._grace = grace
        self._on_permission = on_permission
        self._on_question = on_question
        self._on_progress = on_progress
        self._on_end = on_end
        self._stack: AsyncExitStack | None = None
        self._conn = None
        self._task: asyncio.Task | None = None
        self._notes: list[str] = []
        self._active = False
        self._stopping = False
        self._message_id: object = _NO_MESSAGE
        self.process: asyncio.subprocess.Process | None = None
        self.session_id = ""
        self.progress = ""
        self.result: str | None = None

    async def start(self, folder: Path) -> list[Mode]:
        exe = shutil.which(self._command[0])
        if exe is None:
            raise ExpertError(
                f"Cannot find the expert command {self._command[0]!r}. "
                f"Install the Claude Code adapter with: {INSTALL_STEP}"
            )
        # Explicit env: the parent's, minus the two keys that would override the user's login.
        env = {k: v for k, v in os.environ.items() if k not in STRIPPED_ENV}
        self._stack = AsyncExitStack()
        try:
            self._conn, self.process = await self._stack.enter_async_context(
                acp.spawn_agent_process(
                    _Client(self),
                    exe,
                    *self._command[1:],
                    env=env,
                    # Nobody reads the adapter's stderr; a full pipe would stall it.
                    transport_kwargs={"stderr": subprocess.DEVNULL},
                    use_unstable_protocol=True,
                )
            )
            caps = ClientCapabilities(
                elicitation=ElicitationCapabilities(form=ElicitationFormCapabilities())
            )
            await self._conn.initialize(
                protocol_version=acp.PROTOCOL_VERSION, client_capabilities=caps
            )
            session = await self._conn.new_session(cwd=str(folder), mcp_servers=[])
        except BaseException:
            await self._shutdown()
            raise
        self.session_id = session.session_id
        return [Mode(m.id, m.name, m.description or "") for m in session.modes.available_modes]

    async def begin(self, mode_id: str, task: str) -> None:
        await self._conn.set_session_mode(session_id=self.session_id, mode_id=mode_id)
        self._active = True
        self._task = asyncio.ensure_future(self._drive(task))

    def note(self, text: str) -> bool:
        """Queue a follow-up prompt; False when the run is not active any more."""
        if not self._active:
            return False
        self._notes.append(text)
        return True

    async def stop(self) -> None:
        if self._task is None or self._task.done():
            await self._shutdown()
            return
        self._stopping = True
        self._notes.clear()
        with suppress(Exception):
            await self._conn.cancel(session_id=self.session_id)
        done, _ = await asyncio.wait({self._task}, timeout=self._grace)
        if not done:
            await self._shutdown()  # the prompt call then fails and the run ends stopped
        await self._task

    async def close(self) -> None:
        await self.stop()

    async def _drive(self, first: str) -> None:
        state, reason = "done", "end_turn"
        prompt = first
        try:
            async with asyncio.timeout(self._timeout):
                while True:
                    self._message_id = _NO_MESSAGE
                    response = await self._conn.prompt(
                        session_id=self.session_id, prompt=[acp.text_block(prompt)]
                    )
                    reason = response.stop_reason
                    if self._stopping:
                        state, reason = "stopped", "stopped"
                        break
                    if not self._notes:
                        break
                    prompt = self._notes.pop(0)
        except TimeoutError:
            state, reason = "error", "timeout"
        except Exception as exc:
            if self._stopping:
                state, reason = "stopped", "stopped"
            else:
                state, reason = (
                    "error",
                    f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__,
                )
        self._active = False
        self.result = self.progress or None
        await self._shutdown()
        await self._on_end(state, reason, self.result)

    async def _shutdown(self) -> None:
        stack, self._stack = self._stack, None
        if stack is None:
            return
        process = self.process
        with suppress(Exception):
            process.stdin.close()  # the adapter exits by itself when stdin closes
        try:
            await asyncio.wait_for(process.wait(), self._grace)
        except TimeoutError:
            await kill_tree(process)
        await stack.aclose()

    async def _message_chunk(self, message_id, text: str) -> None:
        if message_id != self._message_id:
            self._message_id = message_id
            self.progress = ""
        self.progress += text
        await self._on_progress(self.progress)


class _Client:
    """The ACP client interface; it only translates frames to ExpertRun's callbacks."""

    def __init__(self, run: ExpertRun) -> None:
        self._run = run

    def on_connect(self, conn) -> None:
        pass

    async def session_update(self, session_id, update, **kw) -> None:
        if update.session_update == "agent_message_chunk" and hasattr(update.content, "text"):
            await self._run._message_chunk(update.message_id, update.content.text)

    async def request_permission(self, session_id, tool_call, options, **kw):
        request = PermissionRequest(
            title=tool_call.title or "",
            kind=str(tool_call.kind or "other"),
            input=tool_call.raw_input if isinstance(tool_call.raw_input, dict) else {},
            options=[PermissionOption(o.option_id, o.name, str(o.kind)) for o in options],
        )
        chosen = await self._run._on_permission(request)
        outcome = (
            DeniedOutcome(outcome="cancelled")
            if chosen is None
            else AllowedOutcome(outcome="selected", option_id=chosen)
        )
        return RequestPermissionResponse(outcome=outcome)

    async def create_elicitation(self, message, mode, **kw):
        answer = await self._run._on_question(Question(message, _fields(mode.requested_schema)))
        if answer is None:
            return CancelElicitationResponse(action="cancel")
        return AcceptElicitationResponse(action="accept", content=answer)

    async def ext_method(self, method, params):
        return {}

    async def ext_notification(self, method, params) -> None:
        pass


def _fields(schema) -> list[QuestionField]:
    """One field per question property; the "_custom" free-text boxes are implied."""
    fields = []
    for key, prop in schema.properties.items():
        if key.endswith("_custom"):
            continue
        prop = prop if isinstance(prop, dict) else prop.model_dump(by_alias=True)
        choices = prop.get("oneOf") or (prop.get("items") or {}).get("anyOf") or []
        fields.append(QuestionField(key, prop.get("title") or "", [c["const"] for c in choices]))
    return fields
