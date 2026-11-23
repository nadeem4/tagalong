"""The node process: dials the brain over wss as a body of kind `node` and answers its
`pipe_open`, `pipe_data`, `pipe_close` and `folder_check`. It holds no memory and makes no
decisions; the allow-list on this machine decides what may run. It imports nothing of the
voice models, so a machine without them can run it.
"""

import asyncio
import hashlib
import json
import logging
import socket
import ssl
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

from brain.node.allowlist import Allowlist
from brain.node.pipes import Pipes, Spawn, spawn_process
from brain.protocol import (
    PROTOCOL,
    ErrorCode,
    FolderCheckParams,
    PipeCloseParams,
    PipeDataParams,
    PipeOpenParams,
    RpcError,
)

log = logging.getLogger("node")
HELLO_ID = "h1"
RETRY_S = 2.0
MAX_FRAME = 28_000_000


class HelloRefused(Exception):
    """The brain turned this node away (a revoked token); retrying cannot help."""


class Socket(Protocol):
    async def send(self, frame: str) -> None: ...

    def __aiter__(self) -> AsyncIterator[str | bytes]: ...


class NodeSession:
    def __init__(self, allowlist: Allowlist, spawn: Spawn = spawn_process) -> None:
        self._allowlist = allowlist
        self._spawn = spawn

    async def run(self, ws: Socket, token: str, body_id: str, name: str) -> None:
        out: asyncio.Queue[str | None] = asyncio.Queue()

        def notify(method: str, params: dict) -> None:
            out.put_nowait(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}))

        async def drain() -> None:
            while (frame := await out.get()) is not None:
                await ws.send(frame)

        pipes = Pipes(self._allowlist, notify, self._spawn)
        writer = asyncio.create_task(drain())
        hello = {
            "protocol": PROTOCOL,
            "token": token,
            "body": {"id": body_id, "kind": "node", "name": name, "display": False},
            "tools": [],
        }
        out.put_nowait(
            json.dumps({"jsonrpc": "2.0", "id": HELLO_ID, "method": "hello", "params": hello})
        )
        try:
            async for raw in ws:
                message = _parse(raw)
                if message is None:
                    continue
                if "method" not in message:
                    if message.get("id") == HELLO_ID and "error" in message:
                        raise HelloRefused(str(message["error"].get("message", "refused")))
                    continue
                reply = await self._handle(message, pipes)
                if reply is not None:
                    out.put_nowait(json.dumps({"jsonrpc": "2.0", "id": message["id"], **reply}))
        finally:
            await pipes.close_all()
            out.put_nowait(None)
            await asyncio.gather(writer, return_exceptions=True)

    async def _handle(self, message: dict, pipes: Pipes) -> dict | None:
        method, raw = message["method"], message.get("params")
        is_request = "id" in message
        try:
            if method == "pipe_open":
                params = PipeOpenParams.model_validate(raw)
                await pipes.open(params.pipe, params.spec)
                return {"result": {}}
            if method == "pipe_data":
                data = PipeDataParams.model_validate(raw)
                pipes.write(data.pipe, data.data)
            elif method == "pipe_close":
                await pipes.close(PipeCloseParams.model_validate(raw).pipe)
            elif method == "folder_check":
                path = FolderCheckParams.model_validate(raw).path
                return {"result": {"exists": Path(path).is_dir()}}
            elif is_request:
                return _error(ErrorCode.method_not_found, f"Unknown method: {method}")
        except ValidationError:
            # Fixed text: the pydantic error would quote the params.
            return (
                _error(ErrorCode.invalid_params, f"{method} has bad params.")
                if is_request
                else None
            )
        except RpcError as exc:
            return _error(exc.code, exc.message) if is_request else None
        return None


def _error(code: ErrorCode, message: str) -> dict:
    return {"error": {"code": int(code), "message": message}}


def _parse(raw: str | bytes) -> dict[str, Any] | None:
    try:
        message = json.loads(raw)
    except ValueError:
        return None
    return message if isinstance(message, dict) else None


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


async def run_node(
    env: Mapping[str, str],
    allowlist: Allowlist,
    dial: Callable[[str, str], Awaitable[Any]] = connect_pinned,
) -> None:
    """Stay connected until the brain refuses this node's token."""
    addr, fingerprint = env["TAGALONG_NODE_ADDR"], env["TAGALONG_NODE_FP"]
    token, body_id = env["TAGALONG_NODE_TOKEN"], env["TAGALONG_NODE_ID"]
    session = NodeSession(allowlist)
    while True:
        try:
            ws = await dial(addr, fingerprint)
            async with ws:
                await session.run(ws, token, body_id, socket.gethostname())
        except HelloRefused:
            raise
        except (OSError, ssl.SSLError, ConnectionClosed) as err:
            log.warning("the brain is not reachable: %s", err)
        await asyncio.sleep(RETRY_S)
