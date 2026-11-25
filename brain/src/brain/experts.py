"""ExpertRun and ExpertHost: drive an expert in a folder over ACP, knowing nothing of asks or jobs.

One adapter process per expert (the host) serves its sessions, started here or, for an expert
placed on a node, as a command the node runs and pipes back; one session per run, reported
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
from collections.abc import Awaitable, Callable, Sequence
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

from brain.bodies import Bodies
from brain.node_needs import NodeNeeds
from brain.pipes import Pipe
from brain.placements import Choose, Placements, Unavailable, resolve_placement
from brain.protocol import ErrorCode, PipeSpec, RpcError
from brain.setup.env import expert_env
from brain.setup.store import prepend_to_path

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
        placements: Placements | None = None,
        bodies: Bodies | None = None,
        needs: NodeNeeds,
    ) -> None:
        self._placements = placements
        self._bodies = bodies
        self._needs = needs
        self._idle_s = idle_s
        self._quiet_s = quiet_s
        # One sleep seam serves both the hosts' idle timers and the runs' quiet sleepers,
        # so a test that injects it controls every wait the factory creates.
        self._sleep = sleep
        self._clock = clock
        self._hosts: dict[tuple, ExpertHost] = {}
        self.bridge = None  # ExpertApps, set once the toolbox exists; None: no expert gets apps

    def locate(self, expert, pinned: str | None = None) -> str:
        """Where a job for this expert runs: its saved session's host when there is one (a job
        never moves), else the expert's placement. Raises Unavailable for a node that is away."""
        if self._bodies is None:
            return "brain"
        if pinned is not None:
            if pinned != "brain" and not self._bodies.is_online(pinned):
                raise Unavailable(pinned)
            return pinned
        placement = self._placements.get("expert", expert.id) if self._placements else None
        try:
            return resolve_placement(
                placement, self._bodies.is_online, shutil.which(expert.command[0]) is not None
            )
        except Choose:
            return "brain"

    async def folder_exists(self, where: str, folder: str) -> bool:
        return await self._bodies.folder_exists(where, folder)

    def _open_pipe(self, where: str, expert) -> Callable[[PipeSpec], Awaitable[Pipe]]:
        async def open_pipe(spec: PipeSpec) -> Pipe:
            try:
                return await self._needs.open_pipe(where, spec)
            except RpcError as err:
                name = self._bodies.name(where)
                if err.code == ErrorCode.denied:
                    raise ExpertError(
                        f"{expert.name} is not approved on {name}. "
                        f"On that machine run: tagalong node allow --expert {expert.id}"
                    ) from None
                raise ExpertError(
                    f"{expert.name} could not start on {name}: {err.message}"
                ) from None

        return open_pipe

    def _sign_in(self, host: str, expert) -> Callable[[], Awaitable[bool]] | None:
        if host == "brain":
            return None
        return lambda: self._needs.sign_in(host, expert.id)

    def __call__(self, expert, *, host: str = "brain", **callbacks) -> "ExpertRun":
        # A private Node's dir goes first on the child's PATH so the adapter's own scripts find it.
        path_first = expert.private_node_dir() if host == "brain" else None
        # A reinstall with a new command is a new host; so is the same expert on another machine.
        key = (expert.id, tuple(expert.command), host)
        adapter = self._hosts.get(key)
        if adapter is None:
            adapter = self._hosts[key] = ExpertHost(
                expert.command,
                expert.id,
                path_first,
                idle_s=self._idle_s,
                sleep=self._sleep,
                open_pipe=None if host == "brain" else self._open_pipe(host, expert),
                sign_in=self._sign_in(host, expert),
            )
        return ExpertRun(
            host=adapter,
            quiet_s=self._quiet_s,
            sleep=self._sleep,
            clock=self._clock,
            bridge=self.bridge,
            **callbacks,
        )

    def can_resume(self, expert_id: str) -> bool | None:
        """Whether this expert's adapter reopens sessions; None until it has been started once."""
        known = [h.can_resume for (id_, _, _), h in self._hosts.items() if id_ == expert_id]
        return next((k for k in known if k is not None), None)

    async def shutdown(self) -> None:
        for host in self._hosts.values():
            with suppress(Exception):
                await host.shutdown()
        if self.bridge is not None:
            with suppress(Exception):
                await self.bridge.shutdown()


AUTH_REQUIRED = -32000  # ACP's code for an adapter whose login is missing


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
        open_pipe: Callable[[PipeSpec], Awaitable[Pipe]] | None = None,
        sign_in: Callable[[], Awaitable[bool]] | None = None,
    ) -> None:
        self._open_pipe = open_pipe  # None: the adapter is a local child process
        # Asks the person to sign in where the adapter runs; true once they have.
        self.sign_in = sign_in
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
        self._pipe: Pipe | None = None
        self.can_resume: bool | None = None  # known after the first initialize
        self.http_mcp = False  # whether the agent takes an http MCP server; same moment

    @property
    def on_node(self) -> bool:
        return self._open_pipe is not None

    @property
    def lost_node(self) -> bool:
        return self._pipe is not None and self._pipe.ended

    def alive(self) -> bool:
        if self._pipe is not None:
            return not self._pipe.ended
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
            await run.revoke_apps()
            await self._abort()
            raise ExpertError(
                f"The expert did not answer within {self._startup_timeout:g} s while starting."
            ) from None
        except BaseException:
            await run.revoke_apps()
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
            if self.alive():
                return
            await self._shutdown()  # clear what a crashed process left behind
            self._stack = AsyncExitStack()
            try:
                self.conn = await self._connect()
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
            mcp = getattr(init.agent_capabilities, "mcp_capabilities", None)
            self.http_mcp = bool(getattr(mcp, "http", False))

    async def _connect(self):
        if self._open_pipe is not None:
            return await self._connect_pipe()
        exe = shutil.which(self._command[0])
        if exe is None:
            raise ExpertError(f"command not found: {self._command[0]}")
        # Explicit env: ours, minus the keys that would switch this expert off the user's login.
        env = expert_env(self._expert_id, os.environ)
        if self._path_first is not None:
            env["PATH"] = prepend_to_path(env, self._path_first)
        conn, self.process = await self._stack.enter_async_context(
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
        return conn

    async def _connect_pipe(self):
        """The adapter runs on a node; its stdout and stdin are the pipe's two directions."""
        self._pipe = pipe = await self._open_pipe(PipeSpec(expert=self._expert_id))
        reader = asyncio.StreamReader()

        async def pump() -> None:
            while (chunk := await pipe.read()) is not None:
                reader.feed_data(chunk)
            reader.feed_eof()

        pumping = asyncio.ensure_future(pump())
        self._stack.callback(pumping.cancel)
        writer = asyncio.StreamWriter(
            _PipeTransport(pipe),
            asyncio.StreamReaderProtocol(reader),
            reader,
            asyncio.get_running_loop(),
        )
        conn = acp.connect_to_agent(_Client(self), writer, reader, use_unstable_protocol=True)
        self._stack.push_async_callback(conn.close)
        return conn

    async def _open_session(self, run: "ExpertRun", folder: Path, resume: str | None) -> list[Mode]:
        session = None
        servers = await run.apps_server()
        if resume is not None:
            run.resumed, run.fresh_reason = False, "expert cannot reopen sessions"
            if resume in self._sessions:
                # Another job holds it; sharing the id would cross their asks and progress.
                run.fresh_reason = "session is in use by another job"
            elif self.can_resume:
                try:
                    loaded = await self.conn.load_session(
                        cwd=str(folder), session_id=resume, mcp_servers=servers
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
            try:
                session = await self.conn.new_session(cwd=str(folder), mcp_servers=servers)
            except acp.RequestError as err:
                if err.code != AUTH_REQUIRED or self.sign_in is None or not await self.sign_in():
                    raise
                session = await self.conn.new_session(cwd=str(folder), mcp_servers=servers)
            run.session_id = session.session_id
        self._sessions[run.session_id] = run
        modes = session.modes.available_modes if session.modes else []
        run.default_mode = session.modes.current_mode_id if session.modes else None
        return [Mode(m.id, m.name, m.description or "") for m in modes]

    async def release(self, run: "ExpertRun", broken: bool = False) -> None:
        """A session ended: forget it, and stop the process now or after the idle period.

        broken: it ended in error, so the process may be dead or wedged; never keep it warm."""
        await run.revoke_apps()  # the expert's token for the apps dies with its session
        if self._sessions.get(run.session_id) is run:
            del self._sessions[run.session_id]
        if self._sessions or self._opening:
            return
        if self._idle_s <= 0 or broken or not self.alive():
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
        process, pipe, self._pipe = self.process, self._pipe, None
        try:
            if pipe is not None:
                pipe.close()
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
        apps: Sequence[str] = (),
        bridge=None,
        job_id: str | None = None,
    ) -> None:
        self._host = host
        # The apps this part may reach, through the brain's bridge; none means no MCP server.
        self.apps = tuple(apps)
        self._bridge = bridge
        self._job_id = job_id
        self._grant = None
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
        self.default_mode: str | None = None  # the mode the expert's session starts in

    @property
    def process(self) -> asyncio.subprocess.Process | None:
        return self._host.process

    async def apps_server(self) -> list:
        """The `mcp_servers` for this session: the bridge when apps were granted, else none."""
        if not self.apps or self._bridge is None:
            return []
        if self._host.on_node:  # the grant's address and token are the brain's own, not for a node
            return []
        if not self._host.http_mcp:
            log.warning("expert does not accept http MCP servers; apps not offered to it")
            return []
        self._grant = await self._bridge.grant(self._job_id or "", self.apps)
        return [self._grant.descriptor]

    @property
    def has_grant(self) -> bool:
        return self._grant is not None

    async def keep_apps(self, kept: Sequence[str]) -> None:
        """Narrow the granted apps to the kept ones (the person's Send); none kept drops the
        bridge, so the session's token stops working before the expert is given its task."""
        self.apps = tuple(kept)
        if self._grant is None:
            return
        if self.apps:
            self._grant.apps = self.apps
            self._grant.sent = True
        else:
            await self.revoke_apps()

    async def revoke_apps(self) -> None:
        grant, self._grant = self._grant, None
        if grant is not None:
            await self._bridge.revoke(grant)

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
        if self._stopping:  # a stop landed while the mode was set: nothing is to be driven
            raise ExpertError("The run was stopped before it began.")
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
            self._stopping = True  # a `begin` still setting the mode will see it and not drive
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
        except asyncio.CancelledError:
            # Cancelled from outside: the session still ends, so its app token must die too.
            self._active = False
            with suppress(Exception):
                await self._host.release(self, broken=True)
            raise
        except Exception as exc:
            if self._stopping:
                state, reason = "stopped", "stopped"
            elif self._host.lost_node:
                state, reason = "host_lost", "the machine it ran on dropped"
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
            try:
                await self._on_quiet(QuietFacts(self._quiet_s, self._host.alive()))
            except Exception:
                log.exception("expert on_quiet failed")

    async def _message_chunk(self, message_id, text: str) -> None:
        if message_id != self._message_id:
            self._message_id = message_id
            self.progress = ""
        self.progress += text
        await self._on_progress(self.progress)


class _PipeTransport(asyncio.Transport):
    """What ACP's StreamWriter writes to when the adapter is on the other end of a node pipe."""

    def __init__(self, pipe: Pipe) -> None:
        super().__init__()
        self._pipe = pipe

    def write(self, data: bytes) -> None:
        self._pipe.write(data)

    def is_closing(self) -> bool:
        return self._pipe.ended

    def close(self) -> None:
        self._pipe.close()


class _Client:
    """The ACP client interface; it routes each frame to the run that owns its session."""

    def __init__(self, host: ExpertHost) -> None:
        self._host = host

    def on_connect(self, conn) -> None:
        # The adapter sends `auth/status_update`, which the acp library has no route for, so it
        # would log an error each time. The library offers no hook, so the router is wrapped.
        router = conn._conn._handler

        async def handler(method, params, is_notification):
            if method == "auth/status_update":
                log.info("expert %s sent an auth status update", self._host._expert_id)
                return None
            return await router(method, params, is_notification)

        conn._conn._handler = handler

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
