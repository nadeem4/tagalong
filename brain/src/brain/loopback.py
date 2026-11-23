"""An ASGI app served on 127.0.0.1 only, for the experts' MCP bridge. The system picks the port."""

import asyncio
import contextlib
import socket

import uvicorn


class _Server(uvicorn.Server):
    def capture_signals(self):
        # The brain owns Ctrl+C; uvicorn must not take its signal handlers over.
        return contextlib.nullcontext()


@contextlib.asynccontextmanager
async def serve_loopback(app):
    """Serve `app` until the block ends; yields the port it listens on."""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    config = uvicorn.Config(
        app, interface="asgi3", log_level="warning", lifespan="off", access_log=False
    )
    server = _Server(config)
    serving = asyncio.create_task(server.serve(sockets=[sock]))
    try:
        while not server.started:
            if serving.done():
                serving.result()
            await asyncio.sleep(0.01)
        yield sock.getsockname()[1]
    finally:
        server.should_exit = True
        await serving
