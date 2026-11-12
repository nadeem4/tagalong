"""The get-to-know-me start: the runner shell (one run at a time, status to its watchers) and the
websocket path (`know_me_start` validated, answered, its status sent live to the starter only).
"""

import asyncio
import base64
import json

import pytest
from test_server import Open, ScriptedModel, call, hello, request
from websockets.asyncio.client import connect

from brain.bodies import Bodies
from brain.know.runner import KnowMeRunner
from brain.memory import Memory
from brain.protocol import ErrorCode, RpcError
from brain.server import start_server
from brain.sessions import Session


class _Source:
    name = "GitHub"


class _Sent:
    def __init__(self):
        self.frames: list[tuple[str, dict]] = []

    def __call__(self, body_id, params):
        self.frames.append((body_id, params))


def make_runner(sources=None):
    sent = _Sent()
    return KnowMeRunner(sources if sources is not None else [], sent), sent


async def test_start_without_input_is_invalid_params():
    runner, _ = make_runner()
    with pytest.raises(RpcError) as err:
        runner.start("desktop", None, None)
    assert err.value.code == ErrorCode.invalid_params


async def test_second_start_joins_running_run():
    runner, sent = make_runner([_Source()])
    assert runner.start("desktop", "octocat", None) is False
    task = runner._task
    assert runner.start("phone", "octocat", None) is True
    assert runner._task is task  # one task ever
    assert sent.frames[-1][0] == "phone"  # the joiner gets the current status at once
    assert sent.frames[-1][1]["sources"] == [{"name": "GitHub", "state": "waiting"}]
    await task


async def test_status_goes_to_every_watcher_and_ends_done():
    runner, sent = make_runner([_Source()])
    runner.start("desktop", "octocat", None)
    runner.start("phone", "octocat", None)
    await runner._task
    last = {body: params for body, params in sent.frames}
    assert last["desktop"]["done"] is True and last["phone"]["done"] is True
    assert last["desktop"]["sources"] == [{"name": "GitHub", "state": "done"}]
    assert "portrait" not in last["desktop"]  # None values are left out


async def test_run_finishes_and_allows_new_start():
    runner, _ = make_runner()
    assert runner.start("desktop", "octocat", None) is False
    await runner._task
    assert runner.start("desktop", None, b"%PDF") is False


async def test_dropped_watcher_gets_no_more_frames():
    runner, sent = make_runner()
    runner.start("desktop", "octocat", None)
    runner.drop_watcher("desktop")
    before = len(sent.frames)
    await runner._task
    assert len(sent.frames) == before


@pytest.fixture
async def know_env():
    bodies = Bodies()
    session = Session(ScriptedModel(asyncio.Event()), Open(), bodies, 10, Memory(":memory:"))
    server = await start_server("127.0.0.1", 0, bodies, "s1", session)
    url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    yield session, url
    server.close()
    await server.wait_closed()


def pdf(size: int) -> dict:
    return {"name": "Profile.pdf", "data": base64.b64encode(b"x" * size).decode()}


async def test_pdf_over_limit_is_over_limit(know_env):
    _, url = know_env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, request("know_me_start", {"pdf": pdf(10 * 1024 * 1024 + 1)}))
    assert reply["error"]["code"] == ErrorCode.over_limit


async def test_bad_base64_is_invalid_params(know_env):
    _, url = know_env
    async with connect(url) as ws:
        await call(ws, hello())
        bad = {"pdf": {"name": "p.pdf", "data": "not base64!"}}
        reply = await call(ws, request("know_me_start", bad))
    assert reply["error"]["code"] == ErrorCode.invalid_params


async def test_empty_start_is_invalid_params_over_the_wire(know_env):
    _, url = know_env
    async with connect(url) as ws:
        await call(ws, hello())
        reply = await call(ws, request("know_me_start", {}))
    assert reply["error"]["code"] == ErrorCode.invalid_params


async def test_status_sent_live_to_starter_only(know_env):
    _, url = know_env
    other = {"id": "ext", "kind": "extension", "name": "Chrome"}
    async with connect(url) as ws, connect(url) as ws2:
        await call(ws, hello())
        second = hello()
        second["params"]["body"] = other
        await call(ws2, second)
        await ws.send(json.dumps(request("know_me_start", {"github": "octocat"})))
        frames = [json.loads(await ws.recv()), json.loads(await ws.recv())]
        result = next(f for f in frames if f.get("id") == 2)
        status = next(f for f in frames if f.get("method") == "know_me_status")
        assert result["result"] == {"joined": False}
        assert status["params"]["done"] in (True, False)
        assert "seq" not in status
        reply = await call(ws2, request("tools", {"tools": []}))
        assert reply.get("id") == 2  # no status frame came first
