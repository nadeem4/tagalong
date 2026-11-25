"""Entry point for `uv run brain`.

Loads config, starts the websocket server and runs until stopped. Logging is set up here
so the library's own connection chatter stays quiet and only the brain's lines print.
"""

import asyncio
import ctypes
import errno
import logging
import os
import socket
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime
from functools import partial
from pathlib import Path

from anthropic import AsyncAnthropic
from zeroconf.asyncio import AsyncZeroconf

from brain.apps import Apps, TokenFile
from brain.auth import listener_auth
from brain.bodies import CALLER, Bodies
from brain.bodies_tools import bodies_tools
from brain.bridges import ENTRY, WHATSAPP_SECRETS, BridgeSupervisor, private_node, real_spawn
from brain.build_info import app_version, build_id
from brain.chat_tools import chat_tools
from brain.config import in_quiet_hours, load_config, load_env_file, session_id
from brain.device_tools import device_tools
from brain.discovery import Advertiser, lan_address, tailnet_addresses
from brain.events import EventLog
from brain.events_tools import events_tools
from brain.experts import ExpertHosts
from brain.guardrails import Budget
from brain.identity import load_or_create_identity, server_ssl_context
from brain.lifecycle import clear_pid, real_started, write_pid
from brain.local_token import load_or_create_local_token
from brain.loops.home_tools import loop_home_tools
from brain.loops.reader import HaikuReader
from brain.loops.service import LoopService
from brain.loops.store import LoopStore
from brain.loops.tools import loop_tools
from brain.masking import Masker, SecretLogFilter, mask_json
from brain.mcp_client_tools import connect_ai_tool_tools, mcp_client_tools
from brain.memory import Memory
from brain.memory_mcp import memory_client_tools
from brain.mind.turn import AnthropicModel
from brain.models import chosen as chosen_model
from brain.models import model_name
from brain.node_needs import NodeNeeds
from brain.offers import OfferSettings
from brain.open_items import OpenItems
from brain.pairing import LOOPBACK_KINDS, NETWORK_KINDS, build_pairing
from brain.placements import Placements
from brain.server import start_server
from brain.sessions import Session
from brain.setup.apps import app_setup_tools
from brain.setup.events import SetupEvents
from brain.setup.expert_tools import expert_setup_tools, login_tools
from brain.setup.facts import inspect, real_run_cmd
from brain.setup.flights import not_for_home
from brain.setup.home_tools import (
    SetupProgress,
    home_app_rows,
    home_end_reporter,
    home_setup_tools,
    home_update_tools,
)
from brain.setup.install import NPM_TIMEOUT_S, sweep_staging
from brain.setup.login import LoginDriver
from brain.setup.net import http_fetch, real_get_json
from brain.setup.registry import Registry
from brain.setup.store import ExpertStore, all_experts
from brain.setup.terminal import real_open_terminal
from brain.setup.tools import setup_facts, setup_tools
from brain.setup.updates import Updates
from brain.setup.why import WhyPick
from brain.store.work import WorkStore
from brain.telemetry import LoopLagMonitor, dump_timings
from brain.tools import KeySettings, anthropic_check, brain_status_tools
from brain.voice import stt_choice, tts_choice
from brain.voice.load import ears_fetcher, ears_loader, tts_clip, tts_installed, tts_loader
from brain.voice.service import VoiceService

log = logging.getLogger("brain")


class _KeyedModels:
    """One key for both models: Scout's and the mail reader's."""

    def __init__(self, *models: AnthropicModel) -> None:
        self._models = models

    @property
    def ready(self) -> bool:
        return self._models[0].ready

    def set_key(self, key: str) -> None:
        for m in self._models:
            m.set_key(key)


def cached[T](fn: Callable[[], T], ttl: float, clock: Callable[[], float] = time.monotonic):
    """Reuse fn's result for ttl seconds: one chat save masks many strings, each asking for
    the secret values, and fn re-reads files."""
    box: list = []  # [expires_at, value]

    def get() -> T:
        now = clock()
        if not box or now >= box[0]:
            box[:] = [now + ttl, fn()]
        return box[1]

    get.clear = box.clear  # a new secret must be masked at once, not after the ttl
    return get


async def _run() -> None:
    # A key in the real environment wins over .env; remember that before .env is read.
    from_environment = bool(os.environ.get("ANTHROPIC_API_KEY"))
    # The data dir says where .env is, and .env may hold the other TAGALONG_* settings.
    try:
        load_env_file(load_config().data_dir, os.environ)
        config = load_config()
    except ValueError as err:  # a bad setting: say which, once, instead of a traceback
        log.error("%s", err)
        sys.exit(1)
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:  # not fatal: the app asks for the key and sends it over a Home tool
        log.warning(
            "No Anthropic key yet: add it in the Tagalong app. Scout stays silent until then."
        )
    try:
        memory = Memory(config.data_dir / "tagalong.db")
    except RuntimeError as err:
        log.error("cannot open memory: %s", err)
        sys.exit(1)
    bodies = Bodies()
    # The saved Settings choice wins over TAGALONG_MODEL, read at the start of each turn.
    model = AnthropicModel(
        lambda k: AsyncAnthropic(api_key=k), lambda: chosen_model(memory.db, config.model), key
    )
    build = build_id(config.build, Path(__file__).parent)  # once: hashing reads every source file
    budget = Budget(config.data_dir / "budget.json", config.daily_budget_usd)
    reader_model = AnthropicModel(lambda k: AsyncAnthropic(api_key=k), config.reader_model, key)
    # Its own ledger, so a heavy mail day never silences Scout and a spent Scout budget never
    # stops the reader.
    reader_budget = Budget(config.data_dir / "reader-budget.json", config.reader_daily_usd)
    reader = HaikuReader(reader_model, reader_budget)
    # The one-line "why pick it" shares the reader's model and allowance: one ledger on the file,
    # a second Budget on it would race.
    why_pick = WhyPick(reader_model, reader_budget, config.data_dir)
    experts = ExpertStore(config.data_dir)
    tokens = TokenFile(config.data_dir)
    needs = NodeNeeds(bodies)
    apps = Apps(
        memory,
        bodies.notify,
        os.environ,
        tokens=tokens,
        data_dir=config.data_dir,
        placements=Placements(memory.db),
        bodies=bodies,
        needs=needs,
    )
    local_token = load_or_create_local_token(config.data_dir)
    identity = load_or_create_identity(config.data_dir)

    devices, pairing = build_pairing(
        memory.db,
        identity,
        config.public_host,
        config.network_port,
        on_revoke=lambda device_id: bodies.drop_principal(f"device:{device_id}"),
    )
    auth, network_auth = listener_auth(local_token, devices)
    secrets = cached(
        lambda: [
            local_token,
            *apps.secret_values(),
            os.environ.get("ANTHROPIC_API_KEY"),
            *(os.environ.get(name) for name in WHATSAPP_SECRETS),  # the bridge's output is logged
        ],
        1.0,
    )
    masker = Masker(secrets)
    keys = KeySettings(
        config.data_dir,
        _KeyedModels(model, reader_model),
        bodies.notify,
        "environment" if from_environment else "file" if key else "none",
        anthropic_check,
        on_key=secrets.clear,
    )
    for handler in logging.getLogger().handlers:  # every logger reaches disk or the console here
        handler.addFilter(SecretLogFilter(masker))
    registry = Registry(config.data_dir)
    inspect_machine = partial(inspect, config.data_dir)
    setup_items = OpenItems(memory.db, lambda: datetime.now(UTC))  # install and sign-in cards
    events = EventLog(memory.db, masker, lambda: datetime.now().astimezone())
    events.on_change = lambda: bodies.notify("changed", {"what": "events"})
    # Setup news waits in the event log until a turn tells it; the session exists later.
    emit_event = SetupEvents(lambda event: session.post_event(event), events.finish_matching).emit
    logins = LoginDriver(
        config.data_dir, experts, real_open_terminal, emit_event, setup_items, notify=bodies.notify
    )
    progress = SetupProgress(emit_event)
    # The session exists later; a setup call joins its turn's task, or opens a Do for it.
    # Home's own buttons reach the same handlers and open none (setup/flights.py).
    claim = not_for_home(lambda given, title: session.claim_task(given, "do", title))
    expert_tools, reinstall, stop_installs = expert_setup_tools(
        config.data_dir,
        registry,
        inspect_machine,
        experts,
        partial(real_run_cmd, timeout=NPM_TIMEOUT_S),
        http_fetch,
        real_get_json,
        progress.emit,
        bodies.notify,
        setup_items,
        claim,
    )
    app_tools, stop_watches = app_setup_tools(
        config.data_dir,
        registry,
        inspect_machine,
        apps,
        memory,
        tokens,
        bodies.notify,
        bodies,
        http_fetch,
        real_get_json,
        os.environ,
        emit_event,
        setup_items,
        claim=claim,
    )
    login = login_tools(config.data_dir, logins, claim)

    updates = Updates(
        config.data_dir,
        registry,
        memory,
        experts,
        apps,
        reinstall,
        # session exists by the first tick; a job being started or waiting in line counts too
        lambda: session.jobs.busy(),
        bodies.notify,
        lambda: datetime.now(UTC),
    )
    # Built before the session so Home's loops tools can hold it; the mask and the event path
    # reach the session lazily.
    loops = LoopService(
        LoopStore(
            WorkStore(
                memory.db,
                lambda: datetime.now(UTC),
                lambda text: mask_json(session.guards, "loop", text),
            ),
            memory.db,
            lambda: datetime.now(UTC),
        ),
        emit_event,
        lambda: datetime.now(UTC),
        reader,
        apps,
        config.loop_poll_s,
        config.loop_stale_days,
        bodies.notify,
    )
    started_at = datetime.now(UTC).isoformat()

    def brain_status() -> dict:  # the facts Home's brain card shows; session exists by the call
        return {
            "version": app_version(),
            "build": build,
            "pid": os.getpid(),
            "started_at": started_at,
            "started_by": config.started_by,
            "addr": f"{config.host}:{config.port}",
            "network": config.network,
            "network_port": config.network_port,
            "fingerprint": identity.fingerprint if config.network else None,
            "data_dir": str(config.data_dir),
            "log_path": str(config.data_dir / "brain.log"),
            "places": [{"id": b.id, "kind": b.kind, "name": b.name} for b in bodies.online()],
            "work_running": bool(session.records.running_jobs()),
            "model": model_name(chosen_model(memory.db, config.model)),
        }

    session = Session(
        model,
        budget,
        bodies,
        config.step_cap,
        memory,
        make_run=ExpertHosts(
            config.expert_idle_s,
            quiet_s=config.job_quiet_min * 60,
            placements=Placements(memory.db),
            bodies=bodies,
            needs=needs,
        ),
        experts=lambda: all_experts(experts, config.expert_cmd),
        apps=apps,
        before_job=updates.quiet,  # a job never starts in the middle of an update's swap
        tokens=tokens,
        wakes_per_hour=config.wakes_per_hour,
        quiet=lambda at: in_quiet_hours(config.quiet_hours, at),
        turn_timeout=config.turn_timeout,
        preview_chars=config.tool_preview_chars,
        job_steps_max_entries=config.job_steps_max_entries,
        job_steps_max_bytes=config.job_steps_max_bytes,
        work_keep_days=config.work_keep_days,
        outputs_keep=config.outputs_keep,
        masker=masker,
        events=events,
        keys=keys,
        model_default=config.model,
        stt_default=(config.stt_live, config.stt_final),
        voice_dir=config.data_dir / "voice",
        setup_facts=partial(setup_facts, registry, inspect_machine),
        extra_tools=setup_tools(config.data_dir, registry, inspect_machine)
        + expert_tools
        + app_tools
        + login
        + loop_home_tools(
            loops,
            lambda: [(r.id, r.name) for r in memory.list_apps()],
            OpenItems(memory.db, lambda: datetime.now(UTC)),
        )
        + events_tools(memory.db, lambda: datetime.now(UTC))
        + chat_tools(memory.db)
        + loop_tools(loops)
        + brain_status_tools(brain_status, lambda: bodies.is_local(CALLER.get()))
        + home_update_tools(updates)
        + device_tools(devices, pairing, config.network)
        + memory_client_tools(memory, bodies.notify)
        + mcp_client_tools(devices, pairing, config.network)
        + connect_ai_tool_tools(devices, bodies)
        + bodies_tools(
            bodies, lambda: bridges, config.data_dir, os.environ, bodies.notify, secrets.clear
        )
        + home_setup_tools(
            registry,
            inspect_machine,
            lambda: all_experts(experts, config.expert_cmd),
            lambda: home_app_rows(memory.list_apps(), lambda i: apps.status(i).state),
            lambda tool, args: session.open_card(tool, args),
            lambda **kw: session.approvals.record(**kw),
            expert_tools + app_tools + login,
            progress,
            why_pick,
        ),
        offers=OfferSettings(
            config.offer_min_approvals, config.offer_window_days, config.keep_asking_days
        ),
    )
    session.ask_runner.home_ended = home_end_reporter(progress, bodies.notify)
    bridges: BridgeSupervisor | None = None  # built once the brain's port is known
    update_loop: asyncio.Task | None = None
    network_server = None
    advertiser: Advertiser | None = None
    lag_watch: asyncio.Task | None = None
    perf_dump: asyncio.Task | None = None
    voice = VoiceService(  # models load on first listen and first spoken turn
        bodies,
        ears_loader(
            config.data_dir,
            config.stt_live,
            config.stt_final,
            lambda: (stt_choice.saved_live(memory.db), stt_choice.saved_final(memory.db)),
        ),
        tts_loader(config.data_dir),
        lambda: tts_choice.resolved(memory.db),
        ears_fetcher(
            config.data_dir,
            config.stt_live,
            config.stt_final,
            lambda: (stt_choice.saved_live(memory.db), stt_choice.saved_final(memory.db)),
        ),
        tts_installed(config.data_dir),
        tts_clip(config.data_dir),
    )
    session.voice = voice
    voice.follow_speech(session.presence.mouth)
    voice.follow_download(lambda: bodies.notify("changed", {"what": "voice_download"}))
    session.loops = loops  # focus and tab events also surface loops
    loops.tasks = updates.tasks = session.tasks  # the Watch tasks of mail and update checks
    session.watch_stops += [loops.task_stopped, updates.task_stopped]
    loops.start()  # wakes Scout for a loop already due, and arms the next one

    def serve(host: str, port: int, **kwargs):
        return start_server(
            host,
            port,
            bodies,
            session_id(config.data_dir),
            session,
            (app_version(), build),
            **kwargs,
        )

    try:
        try:
            server = await serve(
                config.host,
                config.port,
                auth=auth,
                redeem=partial(pairing.redeem, kinds=LOOPBACK_KINDS),
            )
        except OSError as err:  # WSAEADDRINUSE (10048) on Windows, EADDRINUSE elsewhere
            if err.errno not in (getattr(errno, "WSAEADDRINUSE", 10048), errno.EADDRINUSE):
                raise
            log.error(
                "cannot listen on %s:%d: another brain is probably running there. "
                "End it with `tagalong stop`.",
                config.host,
                config.port,
            )
            sys.exit(1)
        # Only now, with the port ours: a second brain that failed to bind must not touch it.
        write_pid(config.data_dir, os.getpid(), real_started(os.getpid()))
        if config.network:
            network_server = await serve(
                "0.0.0.0",
                config.network_port,
                auth=network_auth,
                ssl_context=server_ssl_context(identity),
                redeem=partial(pairing.redeem, kinds=NETWORK_KINDS),
                # Per hello: a logon brain starts before Tailscale has an address.
                addrs=lambda: [f"{a}:{config.network_port}" for a in tailnet_addresses()],
            )
            advertiser = Advertiser(AsyncZeroconf)
            try:
                await advertiser.start(socket.gethostname(), config.network_port, lan_address())
            except OSError as err:  # no usable interface: devices can still pair by link
                log.warning("not announcing this brain on the home network: %s", err)
                advertiser = None
        await asyncio.to_thread(
            sweep_staging, config.data_dir
        )  # an install a killed brain left half-staged
        await apps.start()  # connects in the background, so a slow app never delays boot
        session.jobs.fill_slots(settling=True)  # approved jobs a restart left waiting
        port = server.sockets[0].getsockname()[1]
        bridges = BridgeSupervisor(  # the WhatsApp bridge; runs only when on and set up
            env=os.environ,
            brain_addr=f"127.0.0.1:{port}",  # the bridge is local, whatever host we listen on
            local_token=local_token,
            entry=ENTRY,
            ensure_node=private_node(config.data_dir, inspect_machine),
            spawn=real_spawn,
        )
        await bridges.start()  # Node and the bridge come up on their own task
        update_loop = asyncio.ensure_future(updates.run())  # the daily check and waiting updates
        lag_watch = asyncio.ensure_future(LoopLagMonitor(config.loop_lag_ms / 1000).run())
        perf_dump = asyncio.ensure_future(dump_timings())  # `tagalong perf` reads these lines
        log.info("brain listening on ws://%s:%d", config.host, port)
        if network_server:
            log.info("brain listening on wss://0.0.0.0:%d", config.network_port)
        await server.serve_forever()
    finally:
        # The runner stops first: the running turn's events wait for the next run, and news
        # posted while the rest stops (an install, a login, a stopped job) stays new instead of
        # starting a turn. The turn is cancelled and awaited, so its steps are saved.
        await session.stop_turn()
        # Stop the experts and apps while the cancelled loop can still await them, then close
        # memory.
        for task in (update_loop, lag_watch, perf_dump):
            if task is not None:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        await updates.stop()  # an update in flight is cancelled like an install
        await stop_installs()  # cancel running installs; each removes what it staged
        await stop_watches()  # before apps.shutdown(), which would end each watch with an event
        await logins.stop()
        if bridges is not None:
            await bridges.stop()  # before the brain goes, so no bridge is left running
        await voice.close()
        await session.jobs.shutdown()
        await apps.shutdown()
        await session.stop_background()  # tools a talked-over turn left running end here
        memory.close()
        if advertiser is not None:
            await advertiser.stop()
        if network_server:
            network_server.close()
            await network_server.wait_closed()
        clear_pid(config.data_dir, os.getpid())


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("websockets").setLevel(logging.WARNING)
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass


def service_main(argv: list[str] | None = None) -> None:
    """The logon service's windowless launcher (`brain-service`). It has no console and gets no
    environment from the task, so it takes KEY=VALUE arguments and writes to brain.log."""
    for arg in sys.argv[1:] if argv is None else argv:
        name, _, value = arg.partition("=")
        os.environ[name] = value
    home = load_config(os.environ).data_dir
    home.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        # A windowless process has no console, so each console child (experts, the WhatsApp
        # bridge) would open a window of its own; a hidden console here is inherited instead.
        ctypes.windll.kernel32.AllocConsole()
        ctypes.windll.user32.ShowWindow(ctypes.windll.kernel32.GetConsoleWindow(), 0)
    sys.stdout = sys.stderr = open(home / "brain.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
    main()
