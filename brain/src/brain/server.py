"""Websocket server for contract v3: hello (token checked first), tools, error replies and the
per-connection writer.

Each connection owns one bounded queue drained by a single writer task, so Peer.send never raises
or awaits (Bodies.notify loops over peers) and the hello result always precedes its backlog.
Hello, tools, say, call, answer and cancel are handled, and listen, mic, unlisten and hush
go to the voice seam (Session.voice); any other request answers method_not_found.
`speech_state` (the desktop's speaker) feeds presence, which follows it over the mouth.
`call` runs in its own task and replies through the peer queue.
A body that joins without a usable backlog is sent the asks still open.
Response frames (a body's answer to `use`) go to Bodies.resolve.
A memory client (`mcp_client`, an outside AI tool's bridge) joins with its own token, is no body,
and may only `call` the three memory tools; its token is checked again on every call.
"""

import asyncio
import base64
import json
import logging
import ssl
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, ValidationError
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from brain.auth import BODY_KINDS, CLIENT_KINDS, Authenticator, Principal
from brain.bodies import CALLER, Bodies, WriteQueue
from brain.link import MAX_FRAME
from brain.memory_mcp import call_memory_tool
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
    KnowMeStartParams,
    KnowMeStartResult,
    ListenParams,
    MicParams,
    PairParams,
    PairResult,
    RpcError,
    SayParams,
    SayResult,
    SpeechStateParams,
    ToolsParams,
)
from brain.sessions import Session

Redeem = Callable[[str, str, str], tuple[str, str] | None]
KNOW_ME_PDF_MAX = 10 * 1024 * 1024  # decoded bytes
VOICE_METHODS = {"listen", "mic", "unlisten", "hush"}
log = logging.getLogger("brain")


class _Peer:
    def __init__(self) -> None:
        self.queue = WriteQueue()

    def send(self, frame: str) -> None:
        self.queue.put(frame)

    def close(self) -> None:
        self.queue.close()


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


async def _handler(
    ws: ServerConnection,
    bodies: Bodies,
    session_id: str,
    session: Session,
    build: tuple[str, str] | None,
    auth: Authenticator,
    redeem: Redeem | None,
    addrs: Callable[[], list[str]],
) -> None:
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
                if method == "pair":  # one attempt per connection, whatever the answer
                    peer.send(_pair(message, req_id, redeem))
                    break
                if method != "hello":  # method may be None for a response
                    peer.send(_error(req_id, ErrorCode.invalid_request, "hello must come first"))
                    break
                joined = _identify(message, req_id, peer, auth)
                if joined is None:
                    break
                principal, params = joined
                if params.body.kind == "mcp_client":
                    # A memory client is no body: it gets the result and may only call.
                    result = HelloResult(
                        protocol=PROTOCOL, session=session_id, tools=[], seq=0, resync=False
                    )
                    peer.send(_result(req_id, result))
                    await _client_session(ws, peer, session, auth, params.token)
                    break
                body_id = _join_body(
                    req_id, peer, bodies, session_id, session, build, principal, params, addrs()
                )
                if body_id is None:
                    break
                # A new connection of this body: what an older one reported no longer holds.
                session.presence.speech_gone(body_id)
                continue
            if not isinstance(method, str):
                try:
                    bodies.resolve(body_id, peer, message)  # a response to a `use`
                except Exception:
                    log.exception("bad response frame")
                continue
            if method == "say":
                if "id" in message:  # its answer comes when the door delivers it
                    task = asyncio.create_task(_say(message, req_id, body_id, peer, session))
                    calls.add(task)
                    task.add_done_callback(calls.discard)
                continue
            if method == "call":
                if "id" in message:  # a notification has nowhere to reply
                    task = asyncio.create_task(_call(message, req_id, body_id, peer, session))
                    calls.add(task)
                    task.add_done_callback(calls.discard)
                continue
            if method == "know_me_start":
                if "id" in message:  # a notification has nowhere to reply
                    task = asyncio.create_task(
                        _know_me_start(message, req_id, body_id, peer, session)
                    )
                    calls.add(task)
                    task.add_done_callback(calls.discard)
                continue
            if method == "speech_state":  # a notification: a bad shape is dropped
                if bodies.is_current(body_id, peer):
                    _speech_state(message, body_id, session)
                continue
            if method in ("pipe_data", "pipe_close"):  # a node's bytes; a notification
                bodies.pipe_event(body_id, peer, method, message.get("params"))
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
            if was_current:
                session.body_gone(body_id)
            # A replaced connection must not tear down the listening its successor started.
            if was_current and body_id in listening and session.voice is not None:
                session.voice.unlisten(body_id)  # a gone body's mic must not keep a session
            if was_current:  # a replaced connection's claim was cleared by its successor's hello
                session.presence.speech_gone(body_id)
        peer.close()
        await asyncio.gather(writer, return_exceptions=True)


# The speaker's frames in presence's words: a sentence started is talking, one ended is a
# break until the next starts.
_SPEECH_STATES = {
    "started": "talking",
    "ended": "sentence_break",
    "paused": "paused",
    "idle": "idle",
}


def _speech_state(message: dict, body_id: str, session: Session) -> None:
    try:
        params = SpeechStateParams.model_validate(message.get("params"))
    except ValidationError as exc:
        log.debug("dropped a bad speech_state frame: %s", exc)
        return
    session.presence.speech(body_id, _SPEECH_STATES[params.state], params.turn, params.n)


def _pair(message: dict, req_id: Any, redeem: Redeem | None) -> str:
    if redeem is None:
        return _error(req_id, ErrorCode.method_not_found, "Unknown method: pair")
    try:
        params = PairParams.model_validate(message.get("params"))
    except ValidationError:
        # Fixed text: the pydantic error quotes the params, and they hold the code.
        return _error(req_id, ErrorCode.invalid_params, "pair needs a code and a device.")
    paired = redeem(params.code, params.device.name, params.device.kind)
    if paired is None:
        return _error(req_id, ErrorCode.unauthorized, "That code did not work.")
    return _result(req_id, PairResult(device_id=paired[0], token=paired[1]))


def _identify(
    message: dict, req_id: Any, peer: _Peer, auth: Authenticator
) -> tuple[Principal, HelloParams] | None:
    """Check a hello's version, token and shape; None means an error was sent. The token is
    checked before the shape, so an unauthenticated caller gets no validation text; it is never
    logged. A hello that says it is a memory client is checked as one, so a body's token is no
    client's and the reverse."""
    raw = message.get("params")
    # Check the version first: a future protocol may change the shape, and its body
    # should learn "mismatch", not "invalid params".
    version = raw.get("protocol") if isinstance(raw, dict) else None
    if isinstance(version, int) and not isinstance(version, bool) and version != PROTOCOL:
        data = {"protocol": PROTOCOL}
        peer.send(_error(req_id, ErrorCode.version_mismatch, "Unsupported protocol", data))
        return None
    token = raw.get("token") if isinstance(raw, dict) else None
    body = raw.get("body") if isinstance(raw, dict) else None
    is_client = isinstance(body, dict) and body.get("kind") == "mcp_client"
    kinds = CLIENT_KINDS if is_client else BODY_KINDS
    principal = auth.identify(token, kinds) if isinstance(token, str) else None
    if principal is None:
        peer.send(_error(req_id, ErrorCode.unauthorized, "Unknown or revoked token"))
        return None
    try:
        return principal, HelloParams.model_validate(raw)
    except ValidationError as exc:
        peer.send(_error(req_id, ErrorCode.invalid_params, str(exc)))
        return None


def _join_body(
    req_id: Any,
    peer: _Peer,
    bodies: Bodies,
    session_id: str,
    session: Session,
    build: tuple[str, str] | None,
    principal: Principal,
    params: HelloParams,
    addrs: list[str],
) -> str | None:
    """Join the body and queue the result, the backlog, then any open asks it cannot have;
    None means the body id belongs to another device."""
    joined = bodies.connect(params.body, params.tools, peer, params.last_seq, principal)
    if joined is None:
        peer.send(_error(req_id, ErrorCode.unauthorized, "That body id belongs to another device"))
        return None
    result = HelloResult(
        protocol=PROTOCOL,
        session=session_id,
        tools=session.home_tools(),
        seq=joined.seq,
        resync=joined.resync,
        **({"version": build[0], "build": build[1]} if build else {}),
        **({"addrs": addrs} if addrs else {}),
    )
    peer.send(_result(req_id, result))
    for frame in joined.backlog:
        peer.send(frame)
    if joined.resync or params.last_seq is None:
        # The backlog cannot show asks this body missed, so send the ones still open again.
        for ask in session.open_asks():
            bodies.notify_one(params.body.id, "ask", ask)
    return params.body.id


async def _client_session(
    ws: ServerConnection, peer: _Peer, session: Session, auth: Authenticator, token: str
) -> None:
    """The rest of a memory client's connection: it may only `call`. Its token is checked on
    every call, so a client revoked while connected is refused on its next one."""

    async def run(params: CallParams) -> str:
        principal = auth.identify(token, CLIENT_KINDS)
        if principal is None:
            raise RpcError(ErrorCode.unauthorized, "Unknown or revoked token")
        out = await call_memory_tool(
            session.toolbox,
            session.guards,
            principal,
            params.tool,
            params.input,
            f"memory client {principal.name}",
        )
        if out.is_error:
            raise RpcError(ErrorCode.tool_failed, out.content[0].text)
        return out.content[0].text

    calls: set[asyncio.Task] = set()
    try:
        async for raw in ws:
            message = _parse(raw)
            if isinstance(message, str):
                peer.send(message)
                continue
            if "id" not in message:
                continue
            req_id = _usable_id(message)
            method = message.get("method")
            if method != "call":
                peer.send(_error(req_id, ErrorCode.method_not_found, f"Unknown method: {method}"))
                continue
            task = asyncio.create_task(_run_call(message, req_id, peer, run, hide_errors=True))
            calls.add(task)
            task.add_done_callback(calls.discard)
    finally:
        for task in calls:
            task.cancel()


async def _run_call(
    message: dict,
    req_id: Any,
    peer: _Peer,
    run: Callable[[CallParams], Awaitable[str]],
    hide_errors: bool = False,
) -> None:
    """Run a tool call in its own task so a slow one never blocks the read loop, which must
    keep delivering `use` responses and answers."""
    try:
        try:
            params = CallParams.model_validate(message.get("params"))
        except ValidationError:
            # Fixed text: the pydantic error quotes the params, and set_api_key's hold a key.
            raise RpcError(
                ErrorCode.invalid_params, "call needs a tool and an input object."
            ) from None
        text = await run(params)
        reply = _result(req_id, CallResult(output=[{"type": "text", "text": text}]))
    except ValidationError as exc:
        reply = _error(req_id, ErrorCode.invalid_params, str(exc))
    except RpcError as exc:
        reply = _error(req_id, exc.code, str(exc))
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        if hide_errors:  # an outside tool gets no exception text
            log.exception("handler failed for a memory call")
            reply = _error(req_id, ErrorCode.internal_error, "Internal error")
        else:
            reply = _error(req_id, ErrorCode.tool_failed, str(exc) or type(exc).__name__)
    peer.send(reply)


async def _call(message: dict, req_id: Any, body_id: str, peer: _Peer, session: Session) -> None:
    async def run(params: CallParams) -> str:
        CALLER.set(body_id)
        return await session.call_home(params.tool, params.input)

    await _run_call(message, req_id, peer, run)


def _bad_start(exc: ValidationError) -> str:
    if any(e["loc"] == ("github",) for e in exc.errors()):
        return "That is not a GitHub username."
    if any(e["loc"][:1] == ("pdf",) for e in exc.errors()):
        return "That PDF could not be read."
    return "Give a GitHub username or a LinkedIn PDF."


async def _know_me_start(
    message: dict, req_id: Any, body_id: str, peer: _Peer, session: Session
) -> None:
    """Check the start, then begin the run or join the one going; the reply says which."""
    try:
        params = KnowMeStartParams.model_validate(message.get("params"))
        pdf = None
        if params.pdf is not None:
            try:
                pdf = base64.b64decode(params.pdf.data, validate=True)
            except ValueError:
                raise RpcError(ErrorCode.invalid_params, "pdf.data is not base64.") from None
            if len(pdf) > KNOW_ME_PDF_MAX:
                raise RpcError(ErrorCode.over_limit, "The PDF is over 10 MB.")
        joined = session.know_me.start(body_id, params.github, pdf)
        reply = _result(req_id, KnowMeStartResult(joined=joined))
    except ValidationError as exc:
        # A PDF past the schema's base64 bound is still "too big", not "malformed".
        too_big = any(
            e["loc"] == ("pdf", "data") and e["type"] == "string_too_long" for e in exc.errors()
        )
        code = ErrorCode.over_limit if too_big else ErrorCode.invalid_params
        # Plain words only: pydantic's own text carries a docs URL the person should not see.
        reply = _error(req_id, code, "The PDF is over 10 MB." if too_big else _bad_start(exc))
    except RpcError as exc:  # invalid_params, over_limit
        reply = _error(req_id, exc.code, str(exc))
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("handler failed for know_me_start")
        reply = _error(req_id, ErrorCode.internal_error, "Internal error")
    peer.send(reply)


async def _say(message: dict, req_id: Any, body_id: str, peer: _Peer, session: Session) -> None:
    """A say is answered once it is saved, so it runs in its own task and the read
    loop keeps going. Says from one body are posted in the order they arrived."""
    try:
        say = SayParams.model_validate(message.get("params"))
        await session.say(body_id, say)
        reply = _result(req_id, SayResult())
    except ValueError as exc:  # ValidationError is a ValueError
        reply = _error(req_id, ErrorCode.invalid_params, str(exc))
    except RpcError as exc:  # over_limit
        reply = _error(req_id, exc.code, str(exc))
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("handler failed for say")
        reply = _error(req_id, ErrorCode.internal_error, "Internal error")
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
    if method == "answer":
        try:
            reply = AnswerParams.model_validate(message.get("params"))
            session.answer(
                reply.ask, reply.option, body_id, reply.text, check_back_at=reply.check_back_at
            )
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
    host: str,
    port: int,
    bodies: Bodies,
    session_id: str,
    session: Session,
    build: tuple[str, str] | None = None,
    *,
    auth: Authenticator,
    ssl_context: ssl.SSLContext | None = None,
    redeem: Redeem | None = None,
    addrs: Callable[[], list[str]] = list,
) -> Server:
    """`build` is (version, build id), told to every body in hello; None leaves them out.
    `ssl_context` makes the listener wss. `redeem` turns on the pre-hello `pair` request
    and carries what this listener may pair: (code, name, kind) to (device id, token) or None.
    `addrs` gives the other addresses this brain can be dialed at, told to every body in hello."""

    async def handler(ws: ServerConnection) -> None:
        await _handler(ws, bodies, session_id, session, build, auth, redeem, addrs)

    return await serve(handler, host, port, max_size=MAX_FRAME, ssl=ssl_context)
