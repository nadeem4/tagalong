"""ExpertRun and ExpertHost: drive an expert in a folder over ACP, knowing nothing of asks or jobs.

One adapter process per expert (the host) serves its sessions; one session per run, reported
through async callbacks: on_permission -> option id | None,
on_question -> answer dict | None (None cancels), on_progress, on_end(done|error|stopped).
Each expert's API key variables are stripped from the child so it runs on the user's own login.
The adapter may be a .cmd shim with children, so teardown kills the tree if stdin close fails.
"""

import asyncio
import logging
import os
import shutil
import subprocess
import sys
import time
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

from brain.setup.env import expert_env

_NO_MESSAGE = object()
# Tells the adapter to send a command's output and exit code as structured `_meta` (Claude
# Code's adapter does; one that ignores the key keeps sending the console text block).
CLIENT_META = {"terminal_output": True}
log = logging.getLogger(__name__)


class ExpertError(RuntimeError):
    pass


@dataclass(frozen=True)
class QuietFacts:
    """What the quiet clock reports: how long nothing happened and whether the adapter lives."""

    quiet_s: float
    adapter_alive: bool


def counts_as_activity(update: object, seen: dict[str, str | None]) -> bool:
    """Whether an ACP update is real progress. A repeated status with no content is a
    heartbeat and must not hide a stuck command; `seen` remembers each call's last status."""
    kind = getattr(update, "session_update", None)
    if kind in ("agent_message_chunk", "plan"):
        return True
    if kind not in ("tool_call", "tool_call_update"):
        return False
    step = getattr(update, "tool_call_id", None)
    status = str(update.status) if getattr(update, "status", None) else None
    changed = status is not None and status != seen.get(step)
    if status is not None:
        seen[step] = status
    meta = getattr(update, "field_meta", None) or {}
    output = bool(
        getattr(update, "content", None)
        or getattr(update, "raw_output", None)
        or meta.get("terminal_output")
    )
    return kind == "tool_call" or changed or output


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
    description: str = ""  # the question's own text; the elicitation message is generic
    multi: bool = False  # array field: the answer is a list of option labels


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


class ExpertHosts:
    """The Jobs factory: one ExpertHost per installed expert, a session handle per job."""

    def __init__(
        self,
        idle_s: float = 0.0,
        *,
        quiet_s: float = 1200.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._idle_s = idle_s
        self._quiet_s = quiet_s
        # One sleep seam serves both the hosts' idle timers and the runs' quiet sleepers,
        # so a test that injects it controls every wait the factory creates.
        self._sleep = sleep
        self._clock = clock
        self._hosts: dict[tuple, ExpertHost] = {}

    def __call__(self, expert, **callbacks) -> "ExpertRun":
        # A private Node's dir goes first on the child's PATH so the adapter's own scripts find it.
        path_first = Path(expert.command[0]).parent if expert.node == "private" else None
        key = (expert.id, tuple(expert.command))  # a reinstall with a new command is a new host
        host = self._hosts.get(key)
        if host is None:
            host = self._hosts[key] = ExpertHost(
                expert.command, expert.id, path_first, idle_s=self._idle_s, sleep=self._sleep
            )
        return ExpertRun(
            host=host, quiet_s=self._quiet_s, sleep=self._sleep, clock=self._clock, **callbacks
        )

    def can_resume(self, expert_id: str) -> bool | None:
        """Whether this expert's adapter reopens sessions; None until it has been started once."""
        known = [h.can_resume for (id_, _), h in self._hosts.items() if id_ == expert_id]
        return next((k for k in known if k is not None), None)

    async def shutdown(self) -> None:
        for host in self._hosts.values():
            with suppress(Exception):
                await host.shutdown()


class ExpertHost:
    """One adapter process for one expert, shared by its sessions.

    The process starts with the first session and stops idle_s after the last one ends (0 stops
    it at once), so a follow-up soon after a job reuses a warm adapter. A crash fails every open
    session through its own prompt call; the next session starts a new process.
    """

    def __init__(
        self,
        command: list[str],
        expert_id: str = "custom",
        path_first: Path | None = None,
        *,
        idle_s: float = 0.0,
        grace: float = 3.0,
        # The real adapter needs ~5 s to load the user's plugins and MCP servers; 60 s leaves
        # room for a cold start without waiting forever on an adapter that never answers.
        startup_timeout: float = 60.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._command = command
        self._expert_id = expert_id
        self._path_first = path_first
        self._idle_s = idle_s
        self._grace = grace
        self._startup_timeout = startup_timeout
        self._sleep = sleep
        self._sessions: dict[str, ExpertRun] = {}
        self._opening = 0  # sessions being opened; the process must outlive them
        self._lock = asyncio.Lock()
        self._stack: AsyncExitStack | None = None
        self._idle_task: asyncio.Task | None = None
        self._shutdown_task: asyncio.Future | None = None
        self.conn = None
        self.process: asyncio.subprocess.Process | None = None
        self.can_resume: bool | None = None  # known after the first initialize

    def _alive(self) -> bool:
        return self.process is not None and self.process.returncode is None

    async def open(self, run: "ExpertRun", folder: Path, resume: str | None) -> list[Mode]:
        """Start the process if needed and open the run's session (resumed when asked and able)."""
        self._opening += 1
        self._cancel_idle()
        try:
            async with asyncio.timeout(self._startup_timeout):
                await self._ensure()
                modes = await self._open_session(run, folder, resume)
        except TimeoutError:
            await self._abort()
            raise ExpertError(
                f"The expert did not answer within {self._startup_timeout:g} s while starting."
            ) from None
        except BaseException:
            await self._abort()
            raise
        finally:
            self._opening -= 1
        return modes

    async def _abort(self) -> None:
        # Only this opening session is left: nobody else needs the process.
        if not self._sessions and self._opening == 1:
            await self._shutdown()

    async def _ensure(self) -> None:
        async with self._lock:
            if self._shutdown_task is not None:
                await self._shutdown_task
            if self._alive():
                return
            await self._shutdown()  # clear what a crashed process left behind
            exe = shutil.which(self._command[0])
            if exe is None:
                raise ExpertError(f"command not found: {self._command[0]}")
            # Explicit env: ours, minus the keys that would switch this expert off the user's login.
            env = expert_env(self._expert_id, os.environ)
            if self._path_first is not None:
                env["PATH"] = str(self._path_first) + os.pathsep + env.get("PATH", "")
            self._stack = AsyncExitStack()
            try:
                self.conn, self.process = await self._stack.enter_async_context(
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
                    elicitation=ElicitationCapabilities(form=ElicitationFormCapabilities()),
                    field_meta=CLIENT_META,
                )
                init = await self.conn.initialize(
                    protocol_version=acp.PROTOCOL_VERSION, client_capabilities=caps
                )
            except BaseException:
                await self._shutdown()
                raise
            load = getattr(init.agent_capabilities, "load_session", None)
            self.can_resume = bool(load)

    async def _open_session(self, run: "ExpertRun", folder: Path, resume: str | None) -> list[Mode]:
        session = None
        if resume is not None:
            run.resumed, run.fresh_reason = False, "expert cannot reopen sessions"
            if resume in self._sessions:
                # Another job holds it; sharing the id would cross their asks and progress.
                run.fresh_reason = "session is in use by another job"
            elif self.can_resume:
                try:
                    loaded = await self.conn.load_session(
                        cwd=str(folder), session_id=resume, mcp_servers=[]
                    )
                    if loaded.modes and loaded.modes.available_modes:
                        session = loaded
                        run.resumed, run.fresh_reason = True, None
                        run.session_id = resume
                    else:  # no modes means the user could not pick one: start over
                        run.fresh_reason = "session reported no modes"
                except acp.RequestError:  # the adapter no longer has it: start over
                    run.fresh_reason = "session could not be loaded"
        if session is None:
            session = await self.conn.new_session(cwd=str(folder), mcp_servers=[])
            run.session_id = session.session_id
        self._sessions[run.session_id] = run
        modes = session.modes.available_modes if session.modes else []
        return [Mode(m.id, m.name, m.description or "") for m in modes]

    async def release(self, run: "ExpertRun", broken: bool = False) -> None:
        """A session ended: forget it, and stop the process now or after the idle period.

        broken: it ended in error, so the process may be dead or wedged; never keep it warm."""
        if self._sessions.get(run.session_id) is run:
            del self._sessions[run.session_id]
        if self._sessions or self._opening:
            return
        if self._idle_s <= 0 or broken or not self._alive():
            await self._shutdown()
        elif self._idle_task is None:
            self._idle_task = asyncio.ensure_future(self._stop_when_idle())

    async def _stop_when_idle(self) -> None:
        try:
            await self._sleep(self._idle_s)
        finally:
            if self._idle_task is asyncio.current_task():
                self._idle_task = None
        if not self._sessions and not self._opening:
            await asyncio.shield(self._shutdown())

    def _cancel_idle(self) -> None:
        if self._idle_task is not None:
            self._idle_task.cancel()
            self._idle_task = None

    def session_for(self, session_id: str | None) -> "ExpertRun | None":
        """The run a frame belongs to; a lone session owns a frame that names none."""
        if session_id is None and len(self._sessions) == 1:
            return next(iter(self._sessions.values()))
        return self._sessions.get(session_id)

    async def shutdown(self) -> None:
        self._cancel_idle()
        await self._shutdown()

    def _shutdown(self) -> asyncio.Future:
        # One shared teardown: every caller awaits the same task, so nobody returns (or
        # reports the end) before the process is gone.
        if self._shutdown_task is None:
            self._shutdown_task = asyncio.ensure_future(self._do_shutdown())
        return self._shutdown_task

    async def _do_shutdown(self) -> None:
        stack, self._stack = self._stack, None
        process = self.process
        try:
            if process is not None:
                with suppress(Exception):
                    process.stdin.close()  # the adapter exits by itself when stdin closes
                try:
                    await asyncio.wait_for(process.wait(), self._grace)
                except TimeoutError:
                    await kill_tree(process)
        finally:
            if stack is not None:
                await stack.aclose()
            self._shutdown_task = None


class ExpertRun:
    """One session on a host, with the callbacks of the job that owns it."""

    def __init__(
        self,
        *,
        host: ExpertHost,
        on_permission: Callable[[PermissionRequest], Awaitable[str | None]],
        on_question: Callable[[Question], Awaitable[dict | None]],
        on_progress: Callable[[str], Awaitable[None]],
        on_end: Callable[[str, str, str | None], Awaitable[None]],
        on_update: Callable[[object], Awaitable[None]] | None = None,
        on_quiet: Callable[[QuietFacts], Awaitable[None]] | None = None,
        quiet_s: float = 1200.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
        grace: float = 3.0,
        startup_timeout: float = 60.0,
    ) -> None:
        self._host = host
        self._on_quiet = on_quiet
        self._quiet_s = quiet_s
        self._sleep = sleep
        self._clock = clock
        self._seen: dict[str, str | None] = {}
        self._quiet_task: asyncio.Task | None = None
        self._quiet_from = 0.0
        self.last_step_at = 0.0
        self._grace = grace
        self._startup_timeout = startup_timeout
        self._on_permission = on_permission
        self._on_question = on_question
        self._on_progress = on_progress
        self._on_end = on_end
        self._on_update = on_update
        self._task: asyncio.Task | None = None
        self._notes: list[str] = []
        self._active = False
        self._stopping = False
        self._asks: set[asyncio.Future] = set()
        self._message_id: object = _NO_MESSAGE
        self.session_id = ""
        self.progress = ""
        self.result: str | None = None
        # Set when a resume was asked: True = reopened, False = fresh session and why.
        self.resumed: bool | None = None
        self.fresh_reason: str | None = None

    @property
    def process(self) -> asyncio.subprocess.Process | None:
        return self._host.process

    async def start(self, folder: Path, resume: str | None = None) -> list[Mode]:
        return await self._host.open(self, folder, resume)

    async def begin(self, mode_id: str, task: str) -> None:
        try:
            async with asyncio.timeout(self._startup_timeout):
                await self._host.conn.set_session_mode(session_id=self.session_id, mode_id=mode_id)
        except TimeoutError:
            await self._host.release(self, broken=True)
            raise ExpertError(
                f"The expert did not answer within {self._startup_timeout:g} s to a mode change."
            ) from None
        self._active = True
        self._start_quiet()
        self._task = asyncio.ensure_future(self._drive(task))

    def note(self, text: str) -> bool:
        """Queue a follow-up prompt; False when the run has ended or is being stopped."""
        if not self._active or self._stopping:
            return False
        self._notes.append(text)
        return True

    async def stop(self) -> None:
        task = self._task
        # From inside on_end (or after the run) there is nothing to wait for, and a task
        # must not await itself.
        if task is None or task.done() or task is asyncio.current_task() or not self._active:
            await self._host.release(self)
            return
        if not self._stopping:
            self._stopping = True
            self._notes.clear()
            with suppress(Exception):
                await self._host.conn.cancel(session_id=self.session_id)
            # ACP: after session/cancel every pending ask must be answered as cancelled.
            for ask in list(self._asks):
                ask.cancel()
        done, _ = await asyncio.wait({task}, timeout=self._grace)
        if not done:
            # A wedged adapter: the process goes (sessions sharing it end in error too), and the
            # prompt call then fails so this run ends stopped.
            await self._host.shutdown()
        await task

    async def close(self) -> None:
        await self.stop()

    async def _ask(self, callback, arg):
        """Run an ask callback so stop() can cancel it; a stop-cancelled ask answers None."""
        ask = asyncio.ensure_future(callback(arg))
        self._asks.add(ask)
        try:
            return await ask
        except asyncio.CancelledError:
            if ask.cancelled() and self._stopping:
                return None
            raise
        finally:
            self._asks.discard(ask)
            if not self._asks:  # time with an ask open never counts as quiet
                self._quiet_from = max(self._quiet_from, self._clock())

    async def _drive(self, first: str) -> None:
        state, reason = "done", "end_turn"
        prompt = first
        try:
            try:
                while True:
                    self._message_id = _NO_MESSAGE
                    response = await self._host.conn.prompt(
                        session_id=self.session_id, prompt=[acp.text_block(prompt)]
                    )
                    reason = response.stop_reason
                    if self._stopping:
                        state, reason = "stopped", "stopped"
                        break
                    if not self._notes:
                        break
                    prompt = self._notes.pop(0)
            finally:
                await self._stop_quiet()  # also when cancelled: no leaked sleeper
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
        try:
            await self._host.release(self, broken=state == "error")
        except Exception:
            log.exception("expert shutdown failed")
        try:
            await self._on_end(state, reason, self.result)
        except Exception:
            log.exception("expert on_end failed")

    async def _update(self, update: object) -> None:
        """Every ACP update of this session. Dropped before begin: a resumed session replays
        its old chat first, and that must not reach the job's log."""
        if not self._active:
            return
        if counts_as_activity(update, self._seen):
            self.last_step_at = self._clock()
        if self._on_update is None:
            return
        try:
            await self._on_update(update)
        except Exception:
            log.exception("expert on_update failed")

    def _start_quiet(self) -> None:
        self.last_step_at = self._quiet_from = self._clock()
        if self._on_quiet is not None:
            self._quiet_task = asyncio.ensure_future(self._watch_quiet())

    async def _stop_quiet(self) -> None:
        task, self._quiet_task = self._quiet_task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    def _deadline(self) -> float:
        return max(self.last_step_at, self._quiet_from) + self._quiet_s

    async def _watch_quiet(self) -> None:
        """Wake the owner of this run when nothing real has happened for quiet_s. Code never
        stops a quiet run; a job waiting on an ask is waiting for a person, so it is not counted."""
        while True:
            await self._sleep(max(0.0, self._deadline() - self._clock()))
            if self._clock() < self._deadline():  # activity moved the deadline while we slept
                continue
            self._quiet_from = self._clock()
            if self._asks:
                continue
            process = self._host.process
            alive = process is not None and process.returncode is None
            try:
                await self._on_quiet(QuietFacts(self._quiet_s, alive))
            except Exception:
                log.exception("expert on_quiet failed")

    async def _message_chunk(self, message_id, text: str) -> None:
        if message_id != self._message_id:
            self._message_id = message_id
            self.progress = ""
        self.progress += text
        await self._on_progress(self.progress)


class _Client:
    """The ACP client interface; it routes each frame to the run that owns its session."""

    def __init__(self, host: ExpertHost) -> None:
        self._host = host

    def on_connect(self, conn) -> None:
        pass

    async def session_update(self, session_id, update, **kw) -> None:
        run = self._host.session_for(session_id)  # a replayed or unknown session is dropped
        if run is None:
            return
        if update.session_update == "agent_message_chunk" and hasattr(update.content, "text"):
            await run._message_chunk(update.message_id, update.content.text)
        await run._update(update)

    async def request_permission(self, session_id, tool_call, options, **kw):
        run = self._host.session_for(session_id)
        if run is None:
            return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))
        request = PermissionRequest(
            title=tool_call.title or "",
            kind=str(tool_call.kind or "other"),
            input=tool_call.raw_input if isinstance(tool_call.raw_input, dict) else {},
            options=[PermissionOption(o.option_id, o.name, str(o.kind)) for o in options],
        )
        chosen = await run._ask(run._on_permission, request)
        outcome = (
            DeniedOutcome(outcome="cancelled")
            if chosen is None
            else AllowedOutcome(outcome="selected", option_id=chosen)
        )
        return RequestPermissionResponse(outcome=outcome)

    async def create_elicitation(self, message, mode, **kw):
        run = self._host.session_for(getattr(mode, "session_id", None))
        if run is None:
            return CancelElicitationResponse(action="cancel")
        answer = await run._ask(run._on_question, Question(message, _fields(mode.requested_schema)))
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
        fields.append(
            QuestionField(
                key,
                prop.get("title") or "",
                [c["const"] for c in choices],
                prop.get("description") or "",
                prop.get("type") == "array",
            )
        )
    return fields
