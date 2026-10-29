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
from brain.experts import ExpertRun
from brain.guardrails import Budget
from brain.masking import Masker, SecretLogFilter
from brain.memory import Memory
from brain.mind.turn import AnthropicModel
from brain.offers import OfferSettings
from brain.server import start_server
from brain.sessions import Session

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

    return get


async def _run() -> None:
    # The data dir says where .env is, and .env may hold the other TAGALONG_* settings.
    load_env_file(load_config().data_dir, os.environ)
    config = load_config()
    if not os.environ.get("ANTHROPIC_API_KEY"):
        log.error(
            "ANTHROPIC_API_KEY is missing: put it in %s or the environment",
            config.data_dir / ".env",
        )
        sys.exit(1)
    try:
        memory = Memory(config.data_dir / "tagalong.db")
    except RuntimeError as err:
        log.error("cannot open memory: %s", err)
        sys.exit(1)
    bodies = Bodies()
    model = AnthropicModel(AsyncAnthropic(), config.model)
    budget = Budget(config.data_dir / "budget.json", config.daily_budget_usd)
    make_run = partial(ExpertRun, command=config.expert_cmd, timeout=config.expert_timeout)
    tokens = TokenFile(config.data_dir)
    apps = Apps(memory, bodies.notify, os.environ, tokens=tokens, data_dir=config.data_dir)
    masker = Masker(
        cached(lambda: [*apps.secret_values(), os.environ.get("ANTHROPIC_API_KEY")], 1.0)
    )
    for handler in logging.getLogger().handlers:  # every logger reaches disk or the console here
        handler.addFilter(SecretLogFilter(masker))
    session = Session(
        model,
        budget,
        bodies,
        config.step_cap,
        memory,
        make_run=make_run,
        apps=apps,
        tokens=tokens,
        wakes_per_hour=config.wakes_per_hour,
        turn_timeout=config.turn_timeout,
        masker=masker,
        offers=OfferSettings(
            config.offer_min_approvals, config.offer_window_days, config.keep_asking_days
        ),
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
