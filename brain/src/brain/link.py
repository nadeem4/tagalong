"""The client side of the brain link: what the node and the memory bridge share when they dial
the brain as a body does. Loopback is plain ws; any other address is wss pinned to the brain's
certificate fingerprint. Also the frame size limit and the hello and request framing.
"""

import hashlib
import json
import ssl
from typing import Any

from websockets.asyncio.client import ClientConnection, connect

from brain.protocol import PROTOCOL

MAX_FRAME = 28_000_000


async def connect_pinned(addr: str, fingerprint: str) -> ClientConnection:
    """wss to the brain, trusting only the certificate with this SHA-256 fingerprint. The brain's
    certificate is self-signed, so names and chains mean nothing; the pin is its identity. A
    mismatch closes the socket before anything, the token included, is sent."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ws = await connect(f"wss://{addr}", ssl=ctx, max_size=MAX_FRAME)
    ssl_object = ws.transport.get_extra_info("ssl_object")
    der = ssl_object.getpeercert(binary_form=True) if ssl_object else None
    if der is None or hashlib.sha256(der).hexdigest() != fingerprint.lower():
        await ws.close()
        raise ssl.SSLError("The brain showed a certificate other than the one paired with.")
    return ws


async def dial(addr: str, fingerprint: str | None) -> ClientConnection:
    """No fingerprint means the brain's own machine, reached over loopback ws."""
    if fingerprint is None:
        return await connect(f"ws://{addr}", max_size=MAX_FRAME)
    return await connect_pinned(addr, fingerprint)


def request(req_id: str | int, method: str, params: dict[str, Any]) -> str:
    return json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})


def hello_params(token: str, body_id: str, kind: str, name: str) -> dict[str, Any]:
    return {
        "protocol": PROTOCOL,
        "token": token,
        "body": {"id": body_id, "kind": kind, "name": name, "display": False},
        "tools": [],
    }
