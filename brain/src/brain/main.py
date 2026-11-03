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
from functools import partial

from anthropic import AsyncAnthropic

from brain.apps import Apps, TokenFile
from brain.bodies import Bodies
from brain.config import load_config, load_env_file, session_id
from brain.experts import ExpertHosts
from brain.guardrails import Budget
from brain.masking import Masker, SecretLogFilter
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
from brain.tools import KeySettings, anthropic_check
from brain.voice.load import ears_loader, tts_loader
from brain.voice.service import VoiceService

log = logging.getLogger("brain")


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
    experts = ExpertStore(config.data_dir)
    tokens = TokenFile(config.data_dir)
    apps = Apps(memory, bodies.notify, os.environ, tokens=tokens, data_dir=config.data_dir)
    secrets = cached(lambda: [*apps.secret_values(), os.environ.get("ANTHROPIC_API_KEY")], 1.0)
    masker = Masker(secrets)
    keys = KeySettings(
        config.data_dir,
        model,
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
    app_tools = app_setup_tools(
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
        masker=masker,
        keys=keys,
        setup_facts=partial(setup_facts, registry, inspect_machine),
        extra_tools=setup_tools(config.data_dir, registry, inspect_machine)
        + expert_tools
        + app_tools
        + login
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
    session.voice = VoiceService(  # models load on first listen and first spoken turn
        bodies, ears_loader(config.data_dir), tts_loader(config.data_dir)
    )
    try:
        server = await start_server(
            config.host, config.port, bodies, session_id(config.data_dir), session
        )
        await apps.start()  # connects in the background, so a slow app never delays boot
        port = server.sockets[0].getsockname()[1]
        log.info("brain listening on ws://%s:%d", config.host, port)
        await server.serve_forever()
    finally:
        # Stop the experts and apps while the cancelled loop can still await them, then close
        # memory.
        await stop_installs()  # cancel running installs; each removes what it staged
        await logins.stop()
        await session.jobs.shutdown()
        await apps.shutdown()
        memory.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("websockets").setLevel(logging.WARNING)
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass
