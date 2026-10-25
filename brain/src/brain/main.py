"""Entry point for `uv run brain`.

Loads config, starts the websocket server and runs until stopped. Logging is set up here
so the library's own connection chatter stays quiet and only the brain's lines print.
"""

import asyncio
import logging

from brain.bodies import Bodies
from brain.config import load_config, session_id
from brain.server import start_server

log = logging.getLogger("brain")


async def _run() -> None:
    config = load_config()
    session = session_id(config.data_dir)
    server = await start_server(config.host, config.port, Bodies(), session)
    port = server.sockets[0].getsockname()[1]
    log.info("brain listening on ws://%s:%d", config.host, port)
    await server.serve_forever()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("websockets").setLevel(logging.WARNING)
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass
