"""The node trusts one certificate: the brain's, by fingerprint. A throwaway identity made at
run time serves a loopback wss echo; no network beyond 127.0.0.1.
"""

import ssl

import pytest
from websockets.asyncio.server import serve

from brain.identity import load_or_create_identity, server_ssl_context
from brain.node.main import connect_pinned


async def hello(ws) -> None:
    await ws.send("hi")


async def test_a_matching_fingerprint_connects_and_a_different_one_never_does(tmp_path):
    identity = load_or_create_identity(tmp_path)
    async with serve(hello, "127.0.0.1", 0, ssl=server_ssl_context(identity)) as server:
        addr = f"127.0.0.1:{server.sockets[0].getsockname()[1]}"
        ws = await connect_pinned(addr, identity.fingerprint)
        assert await ws.recv() == "hi"
        await ws.close()
        with pytest.raises(ssl.SSLError):
            await connect_pinned(addr, "0" * 64)
