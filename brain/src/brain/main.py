"""Entry point for `uv run brain`.

Loads config, starts the websocket server and runs until stopped. Logging is set up here
so the library's own connection chatter stays quiet and only the brain's lines print.
"""

import asyncio
import logging
import os
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime
from functools import partial

from anthropic import AsyncAnthropic

from brain.apps import Apps, TokenFile
from brain.bodies import Bodies
from brain.bodies_tools import bodies_tools
from brain.bridges import ENTRY, WHATSAPP_SECRETS, BridgeSupervisor, private_node, real_spawn
from brain.config import load_config, load_env_file, session_id
from brain.experts import ExpertHosts
from brain.guardrails import Budget
from brain.lifecycle import clear_pid, real_started, write_pid
from brain.loops.home_tools import loop_home_tools
from brain.loops.reader import HaikuReader
from brain.loops.service import LoopService
from brain.loops.store import LoopStore
from brain.loops.tools import loop_tools
from brain.masking import Masker, SecretLogFilter, mask_json
from brain.memory import Memory
from brain.mind.turn import AnthropicModel
from brain.offers import OfferSettings
from brain.server import start_server
from brain.sessions import Session
from brain.setup.apps import app_setup_tools
from brain.setup.expert_tools import expert_setup_tools, login_tools
from brain.setup.facts import inspect, real_run_cmd
from brain.setup.home_tools import SetupProgress, home_setup_tools
from brain.setup.install import NPM_TIMEOUT_S
from brain.setup.login import LoginDriver
from brain.setup.net import http_fetch, real_get_json
from brain.setup.registry import Registry
from brain.setup.store import ExpertStore, all_experts
from brain.setup.terminal import real_open_terminal
from brain.setup.tools import setup_facts, setup_tools
from brain.store.work import WorkStore
from brain.tools import KeySettings, anthropic_check
from brain.voice.load import ears_loader, tts_loader
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
    load_env_file(load_config().data_dir, os.environ)
    config = load_config()
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
    model = AnthropicModel(lambda k: AsyncAnthropic(api_key=k), config.model, key)
    budget = Budget(config.data_dir / "budget.json", config.daily_budget_usd)
    reader_model = AnthropicModel(lambda k: AsyncAnthropic(api_key=k), config.reader_model, key)
    # Its own ledger, so a heavy mail day never silences Scout and a spent Scout budget never
    # stops the reader.
    reader = HaikuReader(
        reader_model, Budget(config.data_dir / "reader-budget.json", config.reader_daily_usd)
    )
    experts = ExpertStore(config.data_dir)
    tokens = TokenFile(config.data_dir)
    apps = Apps(memory, bodies.notify, os.environ, tokens=tokens, data_dir=config.data_dir)
    secrets = cached(
        lambda: [
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
    emit_event = lambda event: session.scheduler.emit(event)  # noqa: E731 - session exists later
    logins = LoginDriver(
        config.data_dir, experts, real_open_terminal, emit_event, notify=bodies.notify
    )
    progress = SetupProgress(emit_event)
    expert_tools, stop_installs = expert_setup_tools(
        config.data_dir,
        registry,
        inspect_machine,
        experts,
        partial(real_run_cmd, timeout=NPM_TIMEOUT_S),
        http_fetch,
        real_get_json,
        progress.emit,
        bodies.notify,
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
    )
    login = login_tools(config.data_dir, logins)
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
    session = Session(
        model,
        budget,
        bodies,
        config.step_cap,
        memory,
        make_run=ExpertHosts(config.expert_idle_s, quiet_s=config.job_quiet_min * 60),
        experts=lambda: all_experts(experts, config.expert_cmd),
        apps=apps,
        tokens=tokens,
        wakes_per_hour=config.wakes_per_hour,
        turn_timeout=config.turn_timeout,
        preview_chars=config.tool_preview_chars,
        job_steps_max_entries=config.job_steps_max_entries,
        job_steps_max_bytes=config.job_steps_max_bytes,
        work_keep_days=config.work_keep_days,
        outputs_keep=config.outputs_keep,
        masker=masker,
        keys=keys,
        setup_facts=partial(setup_facts, registry, inspect_machine),
        extra_tools=setup_tools(config.data_dir, registry, inspect_machine)
        + expert_tools
        + app_tools
        + login
        + loop_home_tools(loops, lambda: [(r.id, r.name) for r in memory.list_apps()])
        + loop_tools(loops)
        + bodies_tools(
            bodies, lambda: bridges, config.data_dir, os.environ, bodies.notify, secrets.clear
        )
        + home_setup_tools(
            registry,
            inspect_machine,
            lambda: all_experts(experts, config.expert_cmd),
            lambda: [
                {"id": r.id, "name": r.name, "state": apps.status(r.id).state}
                for r in memory.list_apps()
            ],
            lambda **kw: session.asks.open(**kw),
            lambda **kw: session.approvals.record(**kw),
            expert_tools + app_tools + login,
            progress,
        ),
        offers=OfferSettings(
            config.offer_min_approvals, config.offer_window_days, config.keep_asking_days
        ),
    )
    bridges: BridgeSupervisor | None = None  # built once the brain's port is known
    session.voice = VoiceService(  # models load on first listen and first spoken turn
        bodies, ears_loader(config.data_dir), tts_loader(config.data_dir)
    )
    session.loops = loops  # focus and tab events also surface loops
    loops.start()  # wakes Scout for a loop already due, and arms the next one
    try:
        server = await start_server(
            config.host, config.port, bodies, session_id(config.data_dir), session
        )
        # Only now, with the port ours: a second brain that failed to bind must not touch it.
        write_pid(config.data_dir, os.getpid(), real_started(os.getpid()))
        await apps.start()  # connects in the background, so a slow app never delays boot
        port = server.sockets[0].getsockname()[1]
        bridges = BridgeSupervisor(  # the WhatsApp bridge; runs only when on and set up
            env=os.environ,
            brain_addr=f"127.0.0.1:{port}",  # the bridge is local, whatever host we listen on
            entry=ENTRY,
            ensure_node=private_node(config.data_dir, inspect_machine),
            spawn=real_spawn,
        )
        await bridges.start()  # Node and the bridge come up on their own task
        log.info("brain listening on ws://%s:%d", config.host, port)
        await server.serve_forever()
    finally:
        # Stop the experts and apps while the cancelled loop can still await them, then close
        # memory.
        await stop_installs()  # cancel running installs; each removes what it staged
        await stop_watches()  # before apps.shutdown(), which would end each watch with an event
        await logins.stop()
        if bridges is not None:
            await bridges.stop()  # before the brain goes, so no bridge is left running
        await session.jobs.shutdown()
        await apps.shutdown()
        memory.close()
        clear_pid(config.data_dir, os.getpid())


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("websockets").setLevel(logging.WARNING)
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass
