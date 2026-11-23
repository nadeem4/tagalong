"""An ASGI app served on 127.0.0.1 only, for the brain's two MCP servers (the experts' bridge and
the memory endpoint). Port 0 lets the system pick one.
"""

import asyncio
import contextlib
import socket

import uvicorn


class _Server(uvicorn.Server):
    def capture_signals(self):
        # The brain owns Ctrl+C; uvicorn must not take its signal handlers over.
        return contextlib.nullcontext()


@contextlib.asynccontextmanager
async def serve_loopback(app, port: int = 0):
    """Serve `app` until the block ends; yields the port it listens on. Raises OSError when the
    port is taken."""
    sock = socket.socket()
    try:
        sock.bind(("127.0.0.1", port))
    except OSError:
        sock.close()
        raise
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
