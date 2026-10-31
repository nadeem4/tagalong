"""Websocket server for contract v1: hello, tools, error replies and the per-connection writer.

Each connection owns one queue drained by a single writer task, so Peer.send never raises
or awaits (Bodies.notify loops over peers) and the hello result always precedes its backlog.
Hello, tools, say, call, answer and cancel are handled, and listen, mic, unlisten and hush
go to the voice seam (Session.voice); any other request answers method_not_found.
`call` runs in its own task and replies through the peer queue.
A body that joins without a usable backlog is sent the asks still open.
Response frames (a body's answer to `use`) go to Bodies.resolve.
"""

import asyncio
import base64
import json
import logging
from typing import Any

from pydantic import BaseModel, ValidationError
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from brain.bodies import Bodies
from brain.protocol import (
    LIMITS,
    PROTOCOL,
    AnswerParams,
    CallParams,
    CallResult,
    CancelTurnParams,
    ErrorCode,
    EventParams,
    HelloParams,
    HelloResult,
    ListenParams,
    MicParams,
    RpcError,
    SayParams,
    ToolsParams,
)
from brain.sessions import Session

MAX_FRAME = 28_000_000
VOICE_METHODS = {"listen", "mic", "unlisten", "hush"}
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
    calls: set[asyncio.Task] = set()
    listening: set[str] = set()  # holds the body id once this connection has listened
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
            if method == "call":
                if "id" in message:  # a notification has nowhere to reply
                    task = asyncio.create_task(_call(message, req_id, peer, session))
                    calls.add(task)
                    task.add_done_callback(calls.discard)
                continue
            try:
                if method in VOICE_METHODS:
                    if not bodies.is_current(body_id, peer):
                        continue  # a replaced connection may still deliver queued frames
                    reply = _voice(method, message, req_id, body_id, session, listening)
                else:
                    reply = _dispatch(method, message, req_id, body_id, peer, bodies, session)
            except Exception:
                log.exception("handler failed for %s", method)
                reply = _error(req_id, ErrorCode.internal_error, "Internal error")
            if reply is not None and "id" in message:
                peer.send(reply)
    except ConnectionClosed:
        pass
    finally:
        for task in calls:
            task.cancel()  # nobody is left to read their replies
        if body_id is not None:
            was_current = bodies.disconnect(body_id, peer)
            # A replaced connection must not tear down the listening its successor started.
            if was_current and body_id in listening and session.voice is not None:
                session.voice.unlisten(body_id)  # a gone body's mic must not keep a session
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
        protocol=PROTOCOL,
        session=session_id,
        tools=session.home_tools(),
        seq=joined.seq,
        resync=joined.resync,
    )
    peer.send(_result(req_id, result))
    for frame in joined.backlog:
        peer.send(frame)
    if joined.resync or params.last_seq is None:
        # The backlog cannot show asks this body missed, so send the ones still open again.
        for ask in session.open_asks():
            bodies.notify_one(params.body.id, "ask", ask)
    return params.body.id


async def _call(message: dict, req_id: Any, peer: _Peer, session: Session) -> None:
    """Run a Home tool in its own task so a slow one never blocks the read loop, which must
    keep delivering `use` responses and answers."""
    try:
        try:
            params = CallParams.model_validate(message.get("params"))
        except ValidationError:
            # Fixed text: the pydantic error quotes the params, and set_api_key's hold a key.
            raise RpcError(
                ErrorCode.invalid_params, "call needs a tool and an input object."
            ) from None
        text = await session.call_home(params.tool, params.input)
        reply = _result(req_id, CallResult(output=[{"type": "text", "text": text}]))
    except ValidationError as exc:
        reply = _error(req_id, ErrorCode.invalid_params, str(exc))
    except RpcError as exc:
        reply = _error(req_id, exc.code, str(exc))
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        reply = _error(req_id, ErrorCode.tool_failed, str(exc) or type(exc).__name__)
    peer.send(reply)


def _voice(
    method: str, message: dict, req_id: Any, body_id: str, session: Session, listening: set[str]
) -> str | None:
    """Route the voice methods to the seam. Without a voice, `listen` is unknown and the
    notifications are ignored; a bad or untimely `mic` frame is dropped, never answered."""
    voice = session.voice
    if voice is None:
        return _error(req_id, ErrorCode.method_not_found, f"Unknown method: {method}")
    raw = message.get("params")
    is_request = "id" in message
    if method == "listen":
        if not is_request:
            return None
        try:
            params = ListenParams.model_validate(raw)
        except ValidationError as exc:
            return _error(req_id, ErrorCode.invalid_params, str(exc))
        voice.listen(body_id, params.mode)  # first: a raising hook must not mark it listening
        listening.add(body_id)
        return _result(req_id, {})
    if method == "mic":
        if is_request or body_id not in listening:
            return None
        try:
            frame = MicParams.model_validate(raw)
            if len(frame.pcm) > 4 * ((LIMITS["mic_frame"] + 2) // 3):
                return None  # too big to decode
            pcm = base64.b64decode(frame.pcm, validate=True)
        except ValueError:  # a bad shape or bad base64
            log.debug("dropped a bad mic frame")
            return None
        if len(pcm) > LIMITS["mic_frame"]:
            return None
        voice.mic(body_id, pcm)
        return None
    if method == "unlisten":
        listening.discard(body_id)
        voice.unlisten(body_id)
    else:  # hush
        voice.hush(body_id)
    return _result(req_id, {}) if is_request else None


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
            session.answer(reply.ask, reply.option, body_id, reply.text)
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
    if method == "event":
        # A notification: a bad shape is dropped, never answered.
        try:
            event = EventParams.model_validate(message.get("params"))
        except ValidationError as exc:
            log.debug("dropped a bad event frame: %s", exc)
            return None
        session.body_event(body_id, event.name, event.data)
        return None
    # Unknown notifications are dropped by the caller.
    return _error(req_id, ErrorCode.method_not_found, f"Unknown method: {method}")


async def start_server(
    host: str, port: int, bodies: Bodies, session_id: str, session: Session
) -> Server:
    async def handler(ws: ServerConnection) -> None:
        await _handler(ws, bodies, session_id, session)

    return await serve(handler, host, port, max_size=MAX_FRAME)
