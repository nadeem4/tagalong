"""Websocket server for contract v1: hello, tools, error replies and the per-connection writer.

Each connection owns one queue drained by a single writer task, so Peer.send never raises
or awaits (Bodies.notify loops over peers) and the hello result always precedes its backlog.
Hello, tools, say, answer and cancel are handled; any other request answers method_not_found.
A body that joins without a usable backlog is sent the asks still open.
Response frames (a body's answer to `use`) go to Bodies.resolve.
"""

import asyncio
import json
import logging
from typing import Any

from pydantic import BaseModel, ValidationError
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from brain.bodies import Bodies
from brain.protocol import (
    PROTOCOL,
    AnswerParams,
    CancelTurnParams,
    ErrorCode,
    HelloParams,
    HelloResult,
    RpcError,
    SayParams,
    ToolsParams,
)
from brain.sessions import Session

MAX_FRAME = 28_000_000
log = logging.getLogger("brain")


class _Peer:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[str | None] = asyncio.Queue()

    def send(self, frame: str) -> None:
        self.queue.put_nowait(frame)

    def close(self) -> None:
        self.queue.put_nowait(None)


def _error(req_id: Any, code: ErrorCode, message: str, data: Any = None) -> str:
    error: dict[str, Any] = {"code": int(code), "message": message}
    if data is not None:
        error["data"] = data
    return json.dumps({"jsonrpc": "2.0", "id": req_id, "error": error})


def _result(req_id: Any, result: BaseModel | dict) -> str:
    body = result.model_dump(exclude_none=True) if isinstance(result, BaseModel) else result
    return json.dumps({"jsonrpc": "2.0", "id": req_id, "result": body})


def _usable_id(message: dict) -> Any:
    value = message.get("id")
    return value if isinstance(value, str | int) and not isinstance(value, bool) else None


async def _writer(ws: ServerConnection, peer: _Peer) -> None:
    while (frame := await peer.queue.get()) is not None:
        await ws.send(frame)
    await ws.close()


def _parse(raw: str | bytes) -> dict | str:
    """Return the message, or the error frame to send back."""
    if isinstance(raw, bytes):
        return _error(None, ErrorCode.parse_error, "Binary frames are not allowed")
    try:
        message = json.loads(raw)
    except ValueError:
        return _error(None, ErrorCode.parse_error, "Frame is not valid JSON")
    if not isinstance(message, dict):
        return _error(None, ErrorCode.invalid_request, "Frame is not a JSON object")
    if message.get("jsonrpc") != "2.0":
        return _error(_usable_id(message), ErrorCode.invalid_request, "jsonrpc must be 2.0")
    is_response = "result" in message or "error" in message
    if not isinstance(message.get("method"), str) and not is_response:
        return _error(_usable_id(message), ErrorCode.invalid_request, "No method")
    return message


async def _handler(ws: ServerConnection, bodies: Bodies, session_id: str, session: Session) -> None:
    peer = _Peer()
    writer = asyncio.create_task(_writer(ws, peer))
    body_id: str | None = None
    try:
        async for raw in ws:
            message = _parse(raw)
            if isinstance(message, str):
                peer.send(message)
                if body_id is None:
                    break
                continue
            method = message.get("method")
            req_id = _usable_id(message)
            if body_id is None:
                if method != "hello":  # method may be None for a response
                    peer.send(_error(req_id, ErrorCode.invalid_request, "hello must come first"))
                    break
                body_id = _hello(message, req_id, peer, bodies, session_id, session)
                if body_id is None:
                    break
                continue
            if not isinstance(method, str):
                try:
                    bodies.resolve(body_id, peer, message)  # a response to a `use`
                except Exception:
                    log.exception("bad response frame")
                continue
            try:
                reply = _dispatch(method, message, req_id, body_id, peer, bodies, session)
            except Exception:
                log.exception("handler failed for %s", method)
                reply = _error(req_id, ErrorCode.internal_error, "Internal error")
            if reply is not None and "id" in message:
                peer.send(reply)
    except ConnectionClosed:
        pass
    finally:
        if body_id is not None:
            bodies.disconnect(body_id, peer)
        peer.close()
        await asyncio.gather(writer, return_exceptions=True)


def _hello(
    message: dict, req_id: Any, peer: _Peer, bodies: Bodies, session_id: str, session: Session
) -> str | None:
    """Join the body and queue the result, the backlog, then any open asks it cannot have;
    None means hello failed."""
    raw = message.get("params")
    # Check the version first: a future protocol may change the shape, and its body
    # should learn "mismatch", not "invalid params".
    version = raw.get("protocol") if isinstance(raw, dict) else None
    if isinstance(version, int) and not isinstance(version, bool) and version != PROTOCOL:
        data = {"protocol": PROTOCOL}
        peer.send(_error(req_id, ErrorCode.version_mismatch, "Unsupported protocol", data))
        return None
    try:
        params = HelloParams.model_validate(raw)
    except ValidationError as exc:
        peer.send(_error(req_id, ErrorCode.invalid_params, str(exc)))
        return None
    joined = bodies.connect(params.body, params.tools, peer, params.last_seq)
    result = HelloResult(
        protocol=PROTOCOL, session=session_id, tools=[], seq=joined.seq, resync=joined.resync
    )
    peer.send(_result(req_id, result))
    for frame in joined.backlog:
        peer.send(frame)
    if joined.resync or params.last_seq is None:
        # The backlog cannot show asks this body missed, so send the ones still open again.
        for ask in session.open_asks():
            bodies.notify_one(params.body.id, "ask", ask)
    return params.body.id


def _dispatch(
    method: str,
    message: dict,
    req_id: Any,
    body_id: str,
    peer: _Peer,
    bodies: Bodies,
    session: Session,
) -> str | None:
    if method == "hello":
        return _error(req_id, ErrorCode.invalid_request, "hello was already sent")
    if method == "tools":
        try:
            parsed = ToolsParams.model_validate(message.get("params"))
        except ValidationError as exc:
            return _error(req_id, ErrorCode.invalid_params, str(exc))
        bodies.set_tools(body_id, peer, parsed.tools)
        return _result(req_id, {})
    if method == "say":
        if "id" not in message:
            return None
        try:
            say = SayParams.model_validate(message.get("params"))
            return _result(req_id, session.say(body_id, say))
        except ValueError as exc:  # ValidationError is a ValueError
            return _error(req_id, ErrorCode.invalid_params, str(exc))
    if method == "answer":
        try:
            reply = AnswerParams.model_validate(message.get("params"))
            session.answer(reply.ask, reply.option, body_id)
        except ValidationError as exc:
            return _error(req_id, ErrorCode.invalid_params, str(exc))
        except RpcError as exc:
            return _error(req_id, exc.code, str(exc))
        return _result(req_id, {})
    if method == "cancel":
        try:
            cancel = CancelTurnParams.model_validate(message.get("params"))
        except ValidationError as exc:
            return _error(req_id, ErrorCode.invalid_params, str(exc))
        session.cancel(cancel.turn)
        return _result(req_id, {})
    # event, progress and unknown notifications are dropped by the caller.
    return _error(req_id, ErrorCode.method_not_found, f"Unknown method: {method}")


async def start_server(
    host: str, port: int, bodies: Bodies, session_id: str, session: Session
) -> Server:
    async def handler(ws: ServerConnection) -> None:
        await _handler(ws, bodies, session_id, session)

    return await serve(handler, host, port, max_size=MAX_FRAME)
