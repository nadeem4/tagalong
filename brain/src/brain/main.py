"""Entry point for `uv run brain`.

Loads config, starts the websocket server and runs until stopped. Logging is set up here
so the library's own connection chatter stays quiet and only the brain's lines print.
"""

import asyncio
import logging
import os
import sys

from anthropic import AsyncAnthropic

from brain.bodies import Bodies
from brain.config import load_config, load_env_file, session_id
from brain.guardrails import Budget
from brain.memory import Memory
from brain.mind.turn import AnthropicModel
from brain.server import start_server
from brain.sessions import Session

log = logging.getLogger("brain")


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
    session = Session(model, budget, bodies, config.step_cap, memory)
    try:
        server = await start_server(
            config.host, config.port, bodies, session_id(config.data_dir), session
        )
        port = server.sockets[0].getsockname()[1]
        log.info("brain listening on ws://%s:%d", config.host, port)
        await server.serve_forever()
    finally:
        memory.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("websockets").setLevel(logging.WARNING)
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass
