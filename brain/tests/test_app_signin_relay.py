"""An app that stays on a remote brain signs in through the desktop: the desktop opens the
authorize page and catches the loopback redirect on its own PC, and only the one-time code comes
back. Run against the fake OAuth server, whose redirect the test plays by hand.
"""

import asyncio
import http.client
import json
from urllib.parse import parse_qs, urlparse

import pytest

from brain.app_oauth import FileTokenStorage
from brain.apps import AppRow, Apps
from brain.bodies import Bodies
from brain.memory import Memory
from brain.node_needs import NodeNeeds, RemoteSignin
from brain.protocol import NodeAnsweredParams, RpcError
from tests.test_app_oauth import _serve
from tests.test_node_needs import Desk, settle


@pytest.fixture
async def rig(tmp_path):
    async for url in _serve():
        bodies = Bodies()
        desk = Desk(bodies, "desk", "d1")
        needs = NodeNeeds(bodies)
        memory = Memory(":memory:")
        memory.add_app(AppRow("notes", "Notes", "http", {"url": url}, "oauth", True))
        apps = Apps(
            memory,
            lambda m, p: None,
            {},
            connect_timeout=15,
            signin_timeout=15,
            data_dir=tmp_path,
            needs=needs,
        )
        yield apps, needs, desk, tmp_path
        await apps.shutdown()


async def start_sign_in(apps, needs):
    await apps.sign_in("notes", RemoteSignin(needs, "desk", "Notes"))


async def asked(desk) -> dict:
    for _ in range(100):
        if desk.needs():
            return desk.needs()[0]
        await asyncio.sleep(0.05)
    raise AssertionError("the desktop was never asked")


def authorize(url: str) -> tuple[str, str]:
    """What the browser on the desktop's PC gets back from the page: the code and state."""
    parts = urlparse(url)
    conn = http.client.HTTPConnection(parts.hostname, parts.port, timeout=5)
    conn.request("GET", f"{parts.path}?{parts.query}")
    query = parse_qs(urlparse(conn.getresponse().getheader("Location")).query)
    return query["code"][0], query["state"][0]


async def state(apps, want: str) -> None:
    async with asyncio.timeout(15):
        while apps.status("notes").state != want:
            await asyncio.sleep(0.05)


def done(frame, code, state_):
    return NodeAnsweredParams(id=frame["id"], outcome="done", code=code, state=state_)


def exchanges(frame_url: str) -> int:
    parts = urlparse(frame_url)
    conn = http.client.HTTPConnection(parts.hostname, parts.port, timeout=5)
    conn.request("GET", "/exchanged")
    return json.loads(conn.getresponse().read())["count"]


async def test_the_desktop_is_answered_once_the_tokens_are_saved_and_a_replay_is_refused(rig):
    apps, needs, desk, data = rig
    await start_sign_in(apps, needs)
    frame = await asked(desk)
    assert frame["need"] == "app_signin" and frame["app"] == "Notes"
    redirect = parse_qs(urlparse(frame["url"]).query)["redirect_uri"][0]
    assert redirect == f"http://127.0.0.1:{frame['port']}/callback"

    code, state_ = await asyncio.to_thread(authorize, frame["url"])
    await needs.answered("desk", done(frame, code, state_))
    saved = await FileTokenStorage(data, "notes").get_tokens()
    assert saved is not None and saved.access_token == "good-token"
    await state(apps, "connected")
    await settle()
    assert "good-token" not in json.dumps(desk.frames)
    assert desk.needs()[-1]["state"] == "closed"

    with pytest.raises(RpcError):
        await needs.answered("desk", done(frame, code, state_))
    assert await asyncio.to_thread(exchanges, frame["url"]) == 1


async def test_a_code_for_the_wrong_state_is_refused_to_the_desktop_and_nothing_is_saved(rig):
    apps, needs, desk, data = rig
    await start_sign_in(apps, needs)
    frame = await asked(desk)
    code, _ = await asyncio.to_thread(authorize, frame["url"])
    with pytest.raises(RpcError):
        await needs.answered("desk", done(frame, code, "someone-elses"))
    assert apps.status("notes").state == "needs-sign-in"
    assert await FileTokenStorage(data, "notes").get_tokens() is None


async def test_an_answer_for_a_request_the_brain_no_longer_holds_is_refused(rig):
    _, needs, _, _ = rig
    with pytest.raises(RpcError):
        await needs.answered("desk", NodeAnsweredParams(id="gone", outcome="done"))


async def test_not_now_ends_the_sign_in(rig):
    apps, needs, desk, _ = rig
    await start_sign_in(apps, needs)
    frame = await asked(desk)
    await needs.answered("desk", NodeAnsweredParams(id=frame["id"], outcome="not_now"))
    await state(apps, "needs-sign-in")
