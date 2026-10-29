"""End-to-end checks of the websocket server: hello, tools, errors and replay.

Uses a real server on a free port and the websockets client, so framing, close
behaviour and write ordering are exercised for real.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from brain.bodies import Bodies
from brain.memory import Memory
from brain.mind.turn import Final
from brain.server import start_server
from brain.sessions import Session

DESKTOP = {"id": "desktop", "kind": "desktop", "name": "Desktop"}
TOOL = {
    "name": "see_screen",
    "description": "Capture the screen",
    "input_schema": {"type": "object", "properties": {}},
    "effect": "read",  # reads run without an ask, so the plain tool tests need no answers
}
CLICK = {
    "name": "click",
    "description": "Click the mouse",
    "input_schema": {"type": "object", "properties": {}},
}


def hello(last_seq=None, protocol=1, req_id=1):
    params = {"protocol": protocol, "body": DESKTOP, "tools": [TOOL]}
    if last_seq is not None:
        params["last_seq"] = last_seq
    return {"jsonrpc": "2.0", "id": req_id, "method": "hello", "params": params}


def request(method, params, req_id=2):
    return {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}


@pytest.fixture
async def env():
    bodies = Bodies()
    session = Session(ScriptedModel(asyncio.Event()), Open(), bodies, 10, Memory(":memory:"))
    server = await start_server("127.0.0.1", 0, bodies, "s1", session)
    url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    yield bodies, url
    server.close()
    await server.wait_closed()


async def call(ws, frame):
    await ws.send(json.dumps(frame) if not isinstance(frame, (str, bytes)) else frame)
    return json.loads(await ws.recv())


async def assert_closed(ws):
    with pytest.raises(ConnectionClosed):
        await ws.recv()


async def test_hello_ok(env):
    bodies, url = env
    async with connect(url) as ws:
        reply = await call(ws, hello())
        result = reply["result"]
        assert {k: v for k, v in result.items() if k != "tools"} == {
            "protocol": 1,
            "session": "s1",
            "seq": 0,
            "resync": False,
        }
        assert [b.id for b in bodies.online()] == ["desktop"]


async def test_message_before_hello_closes(env):
    _, url = env
    async with connect(url) as ws:
        reply = await call(ws, request("say", {"text": "hi"}))
        assert reply["error"]["code"] == -32600
        await assert_closed(ws)


async def test_version_mismatch_closes(env):
    _, url = env
    async with connect(url) as ws:
        reply = await call(ws, hello(protocol=2))
        assert reply["error"]["code"] == -32000
        assert reply["error"]["data"] == {"protocol": 1}
        await assert_closed(ws)


async def test_version_checked_before_shape(env):
    _, url = env
    frame = hello(protocol=2)
    frame["params"]["body"] = {"id": "desktop", "kind": "desktop"}  # no name
    async with connect(url) as ws:
        reply = await call(ws, frame)
        assert reply["error"]["code"] == -32000
        assert reply["error"]["data"] == {"protocol": 1}
        await assert_closed(ws)


async def test_garbage_before_hello_closes(env):
    _, url = env
    async with connect(url) as ws:
        reply = await call(ws, "{not json")
        assert reply["error"]["code"] == -32700
        assert reply["id"] is None
        await assert_closed(ws)


async def test_null_optional_is_invalid_params(env):
    _, url = env
    frame = hello()
    frame["params"]["last_seq"] = None
    async with connect(url) as ws:
        reply = await call(ws, frame)
        assert reply["error"]["code"] == -32602
        await assert_closed(ws)


async def test_second_hello_is_invalid_request(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, hello(req_id=5))
        assert reply["error"]["code"] == -32600
        assert reply["id"] == 5
        assert (await call(ws, request("tools", {"tools": []})))["result"] == {}


async def test_tools_replaces_list(env):
    bodies, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, request("tools", {"tools": [TOOL]}))
        assert reply == {"jsonrpc": "2.0", "id": 2, "result": {}}
        assert [t.name for t in bodies.tools("desktop")] == ["see_screen"]


async def test_unbuilt_request_is_method_not_found(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, request("ask", {"text": "hi"}))
        assert reply["error"]["code"] == -32601
        await ws.send(json.dumps({"jsonrpc": "2.0", "method": "event", "params": {"name": "x"}}))
        reply = await call(ws, request("nope", {}, req_id=3))
        assert reply["id"] == 3
        assert reply["error"]["code"] == -32601


async def event_env():
    bodies = Bodies()
    session = Session(ScriptedModel(asyncio.Event()), Open(), bodies, 10, Memory(":memory:"))
    seen = []
    session.body_event = lambda body_id, name, data: seen.append((body_id, name, data))
    server = await start_server("127.0.0.1", 0, bodies, "s1", session)
    return server, f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}", seen


async def test_event_frame_reaches_the_session():
    server, url, seen = await event_env()
    try:
        async with connect(url) as ws:
            await call(ws, hello())
            frame = {"jsonrpc": "2.0", "method": "event", "params": {"name": "back", "data": {}}}
            await ws.send(json.dumps(frame))
            await call(ws, request("tools", {"tools": []}))  # in order: the event was handled
        assert seen == [("desktop", "back", {})]
    finally:
        server.close()
        await server.wait_closed()


async def test_event_with_bad_params_is_ignored_and_the_connection_stays_up():
    server, url, seen = await event_env()
    try:
        async with connect(url) as ws:
            await call(ws, hello())
            for params in ({"name": 3}, {}, "x", None):
                await ws.send(
                    json.dumps({"jsonrpc": "2.0", "id": 5, "method": "event", "params": params})
                )
            assert (await call(ws, request("tools", {"tools": []})))["result"] == {}
        assert seen == []
    finally:
        server.close()
        await server.wait_closed()


async def test_garbage_after_hello_keeps_connection(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, "{not json")
        assert reply["error"]["code"] == -32700
        assert reply["id"] is None
        assert (await call(ws, "[1,2]"))["error"]["code"] == -32600
        assert (await call(ws, b"\x00\x01"))["error"]["code"] == -32700
        assert (await call(ws, request("tools", {"tools": []})))["result"] == {}


async def test_reconnect_replays_after_result(env):
    bodies, url = env
    async with connect(url) as ws:
        await call(ws, hello())
    for _ in range(100):  # the server notices the close a moment later
        if not bodies.online():
            break
        await asyncio.sleep(0.01)
    assert not bodies.online()
    bodies.notify("changed", {"what": "settings"})
    bodies.notify("changed", {"what": "settings"})
    async with connect(url) as ws:
        reply = await call(ws, hello(last_seq=0))
        assert reply["result"]["seq"] == 2
        assert reply["result"]["resync"] is False
        first = json.loads(await ws.recv())
        second = json.loads(await ws.recv())
        assert [first["params"]["seq"], second["params"]["seq"]] == [1, 2]


async def test_resync_when_ahead(env):
    _, url = env
    async with connect(url) as ws:
        reply = await call(ws, hello(last_seq=9))
        assert reply["result"]["resync"] is True
        assert reply["result"]["seq"] == 0


async def test_second_connection_same_id_closes_first(env):
    bodies, url = env
    async with connect(url) as first, connect(url) as second:
        await call(first, hello())
        await call(second, hello())
        await assert_closed(first)
        # first is closed, so it can't send tools; the stale guard is tested in test_bodies.
        bodies.notify("changed", {"what": "settings"})
        assert json.loads(await second.recv())["params"]["what"] == "settings"


async def test_response_before_hello_closes(env):
    _, url = env
    async with connect(url) as ws:
        reply = await call(ws, {"jsonrpc": "2.0", "id": 1, "result": {}})
        assert reply["error"]["code"] == -32600
        await assert_closed(ws)


# --- say and cancel ---------------------------------------------------------


class ScriptedModel:
    model_id = "claude-sonnet-5-5"

    def __init__(self, gate):
        self.gate = gate

    async def stream(self, system, messages, tools):
        await self.gate.wait()
        yield "hel"
        yield "lo"
        yield Final([{"type": "text", "text": "hello"}], "end_turn", SimpleNamespace())


class Open:
    spent = 0.0
    limit = 5.0

    def allows(self):
        return True

    def spend(self, usage, model):
        pass


@pytest.fixture
async def chat():
    gate = asyncio.Event()
    bodies = Bodies()
    session = Session(ScriptedModel(gate), Open(), bodies, 10, Memory(":memory:"))
    server = await start_server("127.0.0.1", 0, bodies, "s1", session)
    url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    yield url, gate
    server.close()
    await server.wait_closed()


async def test_say_reaches_every_body(chat):
    url, gate = chat
    ext = hello(req_id=1)
    ext["params"]["body"] = {"id": "ext", "kind": "extension", "name": "Chrome"}
    async with connect(url) as a, connect(url) as b:
        await call(a, hello())
        await call(b, ext)
        reply = await call(a, request("say", {"text": "hi"}))
        assert reply["result"]["joined"] is False
        turn = reply["result"]["turn"]
        gate.set()
        for ws in (a, b):
            got = [json.loads(await ws.recv())["params"] for _ in range(5)]
            assert got[0]["state"] == "started"
            assert [g.get("delta") for g in got[1:3]] == ["hel", "lo"]
            assert got[3]["done"] is True
            assert got[4] == {
                "seq": 5,
                "turn": turn,
                "body": "desktop",
                "state": "ended",
                "reason": "done",
            }


async def test_say_during_turn_joins(chat):
    url, gate = chat
    async with connect(url) as ws:
        await call(ws, hello())
        first = await call(ws, request("say", {"text": "a"}, req_id=2))
        started = json.loads(await ws.recv())
        assert started["params"]["state"] == "started"
        second = await call(ws, request("say", {"text": "b"}, req_id=3))
        assert second["result"] == {"turn": first["result"]["turn"], "joined": True}
        gate.set()


async def test_cancel_notification_ends_turn(chat):
    url, _ = chat
    async with connect(url) as ws:
        await call(ws, hello())
        first = await call(ws, request("say", {"text": "a"}, req_id=2))
        await ws.recv()  # started
        cancel = {"jsonrpc": "2.0", "method": "cancel", "params": {"turn": first["result"]["turn"]}}
        await ws.send(json.dumps(cancel))
        ended = json.loads(await ws.recv())
        assert ended["params"]["state"] == "ended"
        assert ended["params"]["reason"] == "cancelled"


async def test_cancel_request_answers_empty(chat):
    url, _ = chat
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, request("cancel", {"turn": "nope"}))
        assert reply["result"] == {}


async def test_bad_say_params(chat):
    url, _ = chat
    async with connect(url) as ws:
        await call(ws, hello())
        for req_id, params in enumerate([{}, {"text": 5}, {"parts": []}], start=3):
            reply = await call(ws, request("say", params, req_id=req_id))
            assert reply["error"]["code"] == -32602


# --- body tools end to end ---------------------------------------------------


class ToolModel:
    """Step 1 calls desktop__see_screen; step 2 records what the model was told."""

    model_id = "claude-sonnet-5-5"

    def __init__(self, tool="desktop__see_screen"):
        self.tool = tool
        self.step = 0
        self.seen = []

    async def stream(self, system, messages, tools):
        self.step += 1
        self.seen.append(list(messages))
        if self.step == 1:
            block = {"type": "tool_use", "id": "c1", "name": self.tool, "input": {}}
            yield Final([block], "tool_use", SimpleNamespace())
        else:
            yield Final([{"type": "text", "text": "ok"}], "end_turn", SimpleNamespace())


@pytest.fixture
async def tool_env():
    model = ToolModel()
    bodies = Bodies()
    session = Session(model, Open(), bodies, 10, Memory(":memory:"))
    server = await start_server("127.0.0.1", 0, bodies, "s1", session)
    url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    yield url, model
    server.close()
    await server.wait_closed()


async def next_method(ws, method):
    while True:
        frame = json.loads(await ws.recv())
        if frame.get("method") == method:
            return frame


async def start_tool_turn(ws):
    await call(ws, hello())
    reply = await call(ws, request("say", {"text": "look"}))
    return reply["result"]["turn"]


def tool_result(model):
    return model.seen[1][-1]["content"][0]


async def test_model_tool_call_reaches_body_and_result_returns(tool_env):
    url, model = tool_env
    async with connect(url) as ws:
        await start_tool_turn(ws)
        use = await next_method(ws, "use")
        assert use["params"]["tool"] == "see_screen"
        result = {
            "jsonrpc": "2.0",
            "id": use["id"],
            "result": {"output": [{"type": "text", "text": "a desk"}]},
        }
        await ws.send(json.dumps(result))
        async with asyncio.timeout(5):
            while model.step < 2:
                await asyncio.sleep(0.01)
        assert tool_result(model)["tool_use_id"] == "c1"
        assert "is_error" not in tool_result(model)
        assert "a desk" in json.dumps(tool_result(model)["content"])


async def test_body_disconnect_mid_use_gives_is_error_offline(tool_env):
    url, model = tool_env
    async with connect(url) as ws:
        await start_tool_turn(ws)
        await next_method(ws, "use")
    async with asyncio.timeout(5):
        while model.step < 2:
            await asyncio.sleep(0.01)
    assert tool_result(model)["is_error"] is True
    assert "offline" in json.dumps(tool_result(model)["content"])


async def test_turn_cancel_sends_cancel_to_body(tool_env):
    url, _ = tool_env
    async with connect(url) as ws:
        turn = await start_tool_turn(ws)
        await next_method(ws, "use")
        await ws.send(json.dumps({"jsonrpc": "2.0", "method": "cancel", "params": {"turn": turn}}))
        cancel = await next_method(ws, "cancel")
        assert cancel["params"] == {"call": "c1"}
        assert "seq" not in cancel and "id" not in cancel


async def test_response_frame_is_not_an_error(tool_env):
    url, _ = tool_env
    async with connect(url) as ws:
        await call(ws, hello())
        await ws.send(json.dumps({"jsonrpc": "2.0", "id": "nope", "result": {"output": "x"}}))
        reply = await call(ws, request("tools", {"tools": []}))
        assert reply["result"] == {}


async def test_malformed_response_keeps_connection(tool_env):
    url, _ = tool_env
    async with connect(url) as ws:
        await call(ws, hello())
        await ws.send(json.dumps({"jsonrpc": "2.0", "id": [1], "result": 1}))
        reply = await call(ws, request("tools", {"tools": []}))
        assert reply["result"] == {}


# --- asks: answer and replay -------------------------------------------------

EXT = {"id": "ext", "kind": "extension", "name": "Chrome"}


def hello_with_click(last_seq=None, body=DESKTOP, req_id=1):
    frame = hello(last_seq=last_seq, req_id=req_id)
    frame["params"]["body"] = body
    frame["params"]["tools"] = [TOOL, CLICK]
    return frame


@pytest.fixture
async def ask_env():
    model = ToolModel(tool="desktop__click")
    bodies = Bodies()
    session = Session(model, Open(), bodies, 10, Memory(":memory:"))
    server = await start_server("127.0.0.1", 0, bodies, "s1", session)
    url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    yield url, model
    server.close()
    await server.wait_closed()


async def open_ask(ws):
    """Join as desktop, start a turn that clicks, and return the open ask frame."""
    await call(ws, hello_with_click())
    await call(ws, request("say", {"text": "click"}))
    async with asyncio.timeout(5):
        return await next_method(ws, "ask")


async def answer(ws, ask_id, option, req_id=7):
    """Send an answer; return every frame up to its reply (the closed ask may come first)."""
    await ws.send(json.dumps(request("answer", {"ask": ask_id, "option": option}, req_id)))
    out = []
    async with asyncio.timeout(5):
        while True:
            frame = json.loads(await ws.recv())
            out.append(frame)
            if frame.get("id") == req_id:
                return out


async def test_answer_always_replies_empty_closes_ask_and_runs_the_tool(ask_env):
    url, _ = ask_env
    async with connect(url) as ws:
        ask = (await open_ask(ws))["params"]
        assert ask["state"] == "open" and ask["options"] == ["allow", "always", "deny"]
        frames = await answer(ws, ask["id"], "always")
        assert frames[-1]["result"] == {}
        closed = [f["params"] for f in frames if f.get("method") == "ask"][0]
        assert closed["state"] == "closed" and closed["reason"] == "answered"
        assert closed["option"] == "always" and closed["by"] == "desktop"
        use = await next_method(ws, "use")
        assert use["params"]["tool"] == "click"


async def test_answer_always_tells_bodies_permissions_changed(ask_env):
    url, _ = ask_env
    async with connect(url) as ws:
        ask = (await open_ask(ws))["params"]
        seen = await answer(ws, ask["id"], "always")
        async with asyncio.timeout(5):
            while not any(f.get("method") == "use" for f in seen):
                seen.append(json.loads(await ws.recv()))
        changed = [f["params"]["what"] for f in seen if f.get("method") == "changed"]
        assert changed == ["approvals", "permissions"]  # the ask is logged, then auto is saved


async def test_answer_deny_keeps_the_tool_from_running(ask_env):
    url, model = ask_env
    async with connect(url) as ws:
        ask = (await open_ask(ws))["params"]
        await answer(ws, ask["id"], "deny")
        async with asyncio.timeout(5):
            while model.step < 2:
                await asyncio.sleep(0.01)
    result = tool_result(model)
    assert result["is_error"] is True
    assert "said no to desktop__click" in json.dumps(result["content"])


async def test_answer_unknown_ask_is_not_found(ask_env):
    url, _ = ask_env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, request("answer", {"ask": "nope", "option": "allow"}))
        assert reply["error"]["code"] == -32002


async def test_answer_with_unoffered_option_is_invalid_params_and_ask_stays_open(ask_env):
    url, _ = ask_env
    async with connect(url) as ws:
        ask = (await open_ask(ws))["params"]
        bad = await answer(ws, ask["id"], "maybe")
        assert bad[-1]["error"]["code"] == -32602
        ok = await answer(ws, ask["id"], "allow", req_id=8)
        assert ok[-1]["result"] == {}


async def test_answer_after_it_closed_is_not_found(ask_env):
    url, _ = ask_env
    async with connect(url) as ws:
        ask = (await open_ask(ws))["params"]
        await answer(ws, ask["id"], "allow")
        late = await answer(ws, ask["id"], "deny", req_id=8)
        assert late[-1]["error"]["code"] == -32002


async def test_answer_with_bad_params_is_invalid_params(ask_env):
    url, _ = ask_env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, request("answer", {"option": "allow"}))
        assert reply["error"]["code"] == -32602


async def test_resync_reconnect_gets_the_open_ask_again(ask_env):
    url, _ = ask_env
    async with connect(url) as ws:
        ask = (await open_ask(ws))["params"]
    async with connect(url) as ws:
        reply = await call(ws, hello_with_click(last_seq=9999))
        assert reply["result"]["resync"] is True
        again = json.loads(await ws.recv())
        assert again["method"] == "ask" and again["params"]["id"] == ask["id"]
        assert again["params"]["state"] == "open"
        assert again["params"]["seq"] > ask["seq"]


async def test_new_body_sees_the_open_ask(ask_env):
    url, _ = ask_env
    async with connect(url) as ws:
        ask = (await open_ask(ws))["params"]
        async with connect(url) as other:
            reply = await call(other, hello_with_click(body=EXT))
            assert reply["result"]["resync"] is False
            seen = json.loads(await other.recv())
            assert seen["params"]["id"] == ask["id"] and seen["params"]["state"] == "open"


async def test_reconnect_without_resync_gets_the_ask_once_from_the_backlog(ask_env):
    url, _ = ask_env
    async with connect(url) as ws:
        ask = (await open_ask(ws))["params"]
    async with connect(url) as ws:
        reply = await call(ws, hello_with_click(last_seq=ask["seq"] - 1))
        assert reply["result"]["resync"] is False
        got = json.loads(await ws.recv())
        assert got["params"]["id"] == ask["id"] and got["params"]["seq"] == ask["seq"]
        # Nothing else follows: the next frame is the reply to this request.
        reply = await call(ws, request("cancel", {"turn": "none"}, req_id=5))
        assert reply["id"] == 5


async def test_answered_ask_is_not_replayed(ask_env):
    url, _ = ask_env
    async with connect(url) as ws:
        ask = (await open_ask(ws))["params"]
        await answer(ws, ask["id"], "allow")
    async with connect(url) as ws:
        reply = await call(ws, hello_with_click(last_seq=9999))
        assert reply["result"]["resync"] is True
        reply = await call(ws, request("cancel", {"turn": "none"}, req_id=5))
        assert reply["id"] == 5


# --- Home: hello lists its tools, call runs them ---------------------------------


async def test_hello_lists_home_tools_as_contract_records(env):
    _, url = env
    async with connect(url) as ws:
        tools = (await call(ws, hello()))["result"]["tools"]
    names = sorted(t["name"] for t in tools)
    assert names == [
        "edit_preference",
        "forget",
        "list_approvals",
        "list_jobs",
        "list_memories",
        "list_permissions",
        "list_preferences",
        "remove_preference",
        "set_permission",
        "spend_today",
        "stop_job",
    ]
    for t in tools:
        assert set(t) == {"name", "description", "input_schema", "effect"}


async def call_tool(ws, tool, input=None, req_id=9, seen=None):
    """Send `call`; return the reply, collecting notifications that arrive first in `seen`."""
    await ws.send(json.dumps(request("call", {"tool": tool, "input": input or {}}, req_id)))
    async with asyncio.timeout(5):
        while True:
            frame = json.loads(await ws.recv())
            if frame.get("id") == req_id:
                return frame
            if seen is not None:
                seen.append(frame)


def call_json(reply):
    (part,) = reply["result"]["output"]
    assert part["type"] == "text"
    return json.loads(part["text"])


async def test_call_spend_today_returns_one_json_text_part(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        body = call_json(await call_tool(ws, "spend_today"))
    assert set(body) == {"spent_usd", "limit_usd"}


async def test_call_scout_only_tool_is_unknown_tool(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call_tool(ws, "recall", {"query": "x"})
    assert reply["error"]["code"] == -32001


async def test_call_missing_tool_params_is_invalid_params(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        await ws.send(json.dumps(request("call", {"input": {}}, 9)))
        reply = json.loads(await ws.recv())
    assert reply["error"]["code"] == -32602


async def test_call_forget_missing_id_is_tool_failed(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call_tool(ws, "forget", {"id": 999})
    assert reply["error"]["code"] == -32007
    assert "999" in reply["error"]["message"]


async def test_call_set_permission_without_args_is_invalid_params(env):
    _, url = env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call_tool(ws, "set_permission", {})
    assert reply["error"]["code"] == -32602


async def test_call_set_permission_changes_list_and_tells_every_body(env):
    _, url = env
    other = {**hello(req_id=1), "params": {**hello()["params"], "body": EXT}}
    async with connect(url) as ws, connect(url) as ws2:
        await call(ws, hello())
        await call(ws2, other)
        seen = []
        reply = await call_tool(
            ws, "set_permission", {"tool": "desktop__see_screen", "mode": "ask"}, seen=seen
        )
        assert call_json(reply) == {"tool": "desktop__see_screen", "mode": "ask"}
        rows = call_json(await call_tool(ws, "list_permissions"))["tools"]
        row = next(r for r in rows if r["name"] == "desktop__see_screen")
        assert row["mode"] == "ask"
        async with asyncio.timeout(5):
            frame = await next_method(ws2, "changed")
        assert frame["params"]["what"] == "permissions"
        assert any(f.get("method") == "changed" for f in seen)


async def test_slow_call_does_not_block_a_use_response(tool_env, monkeypatch):
    url, model = tool_env
    release = asyncio.Event()

    async def slow(self, tool, input):
        await release.wait()
        return "{}"

    monkeypatch.setattr(Session, "call_home", slow)
    async with connect(url) as ws:
        await start_tool_turn(ws)
        await ws.send(json.dumps(request("call", {"tool": "spend_today", "input": {}}, 9)))
        use = await next_method(ws, "use")
        await ws.send(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": use["id"],
                    "result": {"output": [{"type": "text", "text": "a desk"}]},
                }
            )
        )
        async with asyncio.timeout(5):
            while model.step < 2:
                await asyncio.sleep(0.01)
        release.set()
        async with asyncio.timeout(5):
            while True:
                frame = json.loads(await ws.recv())
                if frame.get("id") == 9:
                    break
        assert call_json(frame) == {}


async def test_answer_text_reaches_the_ask():
    bodies = Bodies()
    session = Session(ScriptedModel(asyncio.Event()), Open(), bodies, 10, Memory(":memory:"))
    server = await start_server("127.0.0.1", 0, bodies, "s1", session)
    url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    try:
        async with connect(url) as ws:
            await call(ws, hello())
            task = asyncio.create_task(
                session._asks.open(text="Which?", options=["a"], free_text=True)
            )
            async with asyncio.timeout(5):
                ask = (await next_method(ws, "ask"))["params"]
            params = {"ask": ask["id"], "option": "mine", "text": "typed"}
            await ws.send(json.dumps(request("answer", params, 9)))
            async with asyncio.timeout(5):
                answer = await task
            assert (answer.option, answer.text) == ("mine", "typed")
    finally:
        server.close()
        await server.wait_closed()
