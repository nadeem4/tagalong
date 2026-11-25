"""Signing in to an app on the node that runs it: the browser opens on that machine, the token is
kept under the node's folder, the relay uses it, and no token is in any frame to the brain.
Fake node over real pipes; the OAuth-protected MCP server is the fake one, on localhost.
"""

import asyncio
import subprocess
import sys
import urllib.request

import pytest
from mcp.shared.auth import OAuthToken

from brain.app_tools import app_home_tools
from brain.apps import AppRow, Apps, TokenFile
from brain.bodies import Bodies
from brain.memory import Memory
from brain.node.allowlist import oauth_storage
from brain.node.signin import sign_in
from brain.node_needs import NodeNeeds
from brain.placements import Placement, Placements
from brain.protocol import PipeSpec, RpcError
from tests.fake_node import FakeNode
from tests.test_app_oauth import FAKE_OAUTH
from tests.test_apps import free_port, wait_for_port

TOKENS = ("good-token", "r1")


@pytest.fixture
async def oauth_url():
    port = free_port()
    proc = subprocess.Popen([sys.executable, FAKE_OAUTH, str(port)])
    try:
        await wait_for_port(port)
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        proc.kill()
        proc.wait()


@pytest.fixture
async def rig(tmp_path):
    memory = Memory(tmp_path / "t.db")
    bodies = Bodies()
    (tmp_path / "node").mkdir()
    node = FakeNode(bodies, tmp_path / "node")
    node.connect()
    placements = Placements(memory.db)
    placements.set("app", "notes", Placement("body", "pc"))
    apps = Apps(
        memory, lambda *_: None, {}, placements=placements, bodies=bodies, needs=NodeNeeds(bodies)
    )
    yield apps, node, memory, tmp_path / "node"
    await apps.shutdown()
    await node.aclose()
    memory.close()


async def browser(url: str) -> None:
    await asyncio.to_thread(lambda: urllib.request.urlopen(url, timeout=10).read())


def leaked(node: FakeNode, memory: Memory) -> bool:
    frames = "".join(node.frames) + "".join(memory.db.iterdump())
    return any(token in frames for token in TOKENS)


async def run_app(apps, memory, row):
    memory.add_app(row)
    await apps.start()
    await apps.wait_settled("notes", 30)


async def test_an_oauth_app_signed_in_on_the_node_runs_there_and_no_token_crosses_a_frame(
    rig, oauth_url
):
    apps, node, memory, node_dir = rig
    node.allowlist.allow(PipeSpec(url=oauth_url))
    await sign_in(oauth_url, node_dir, browser, timeout=15)
    assert list((node_dir / "app-oauth").glob("*.json"))
    row = AppRow("notes", "Notes", "http", {"url": oauth_url}, "oauth", True)
    await run_app(apps, memory, row)
    result = await apps.call("notes", "echo", {"text": "hi"})
    assert result.content[0].text == "hi"
    assert not leaked(node, memory)


async def test_a_bearer_token_typed_on_the_node_is_used_there_and_crosses_no_frame(rig, oauth_url):
    apps, node, memory, _ = rig
    node.allowlist.allow(PipeSpec(url=oauth_url), bearer="good-token")
    row = AppRow("notes", "Notes", "http", {"url": oauth_url}, "token", True)
    await run_app(apps, memory, row)
    result = await apps.call("notes", "echo", {"text": "hi"})
    assert result.content[0].text == "hi"
    assert not leaked(node, memory)


async def never_opened(url: str) -> None:
    """A browser that does not finish the sign-in."""


async def test_an_unfinished_sign_in_leaves_nothing_on_disk(rig, oauth_url):
    _, _, _, node_dir = rig
    with pytest.raises(Exception):  # noqa: B017
        await sign_in(oauth_url, node_dir, never_opened, timeout=1)
    assert not (node_dir / "app-oauth").exists() or not list((node_dir / "app-oauth").iterdir())
    assert [p.name for p in node_dir.iterdir()] == ["allowlist.json"]


async def test_an_unfinished_re_sign_in_keeps_the_token_already_saved(rig, oauth_url):
    _, _, _, node_dir = rig
    saved = oauth_storage(node_dir, oauth_url)
    await saved.set_tokens(OAuthToken(access_token="old-token", token_type="Bearer"))
    with pytest.raises(Exception):  # noqa: B017
        await sign_in(oauth_url, node_dir, never_opened, timeout=1)
    assert saved.token_strings() == ["old-token"]


def signin_line(url: str) -> str:
    return f"Sign in to Notes on Laptop: `tagalong node signin {url}`"


async def test_an_oauth_app_on_a_node_with_no_sign_in_says_how_to_sign_in(rig, oauth_url):
    apps, node, memory, _ = rig
    node.allowlist.allow(PipeSpec(url=oauth_url))
    row = AppRow("notes", "Notes", "http", {"url": oauth_url}, "oauth", True)
    await run_app(apps, memory, row)
    assert apps.status("notes").error == signin_line(oauth_url)


async def test_an_oauth_app_the_node_has_not_approved_says_how_to_sign_in(rig, oauth_url):
    apps, _, memory, _ = rig
    row = AppRow("notes", "Notes", "http", {"url": oauth_url}, "oauth", True)
    await run_app(apps, memory, row)
    assert apps.status("notes").error == signin_line(oauth_url)


async def test_a_token_app_on_a_node_with_no_token_says_how_to_add_it(rig, oauth_url):
    apps, node, memory, _ = rig
    node.allowlist.allow(PipeSpec(url=oauth_url))
    row = AppRow("notes", "Notes", "http", {"url": oauth_url}, "token", True)
    await run_app(apps, memory, row)
    assert apps.status("notes").error == (
        f"Add the token for Notes on Laptop: `tagalong node allow --url {oauth_url} --bearer`"
    )


async def test_sign_in_app_refuses_an_app_on_a_node_with_the_node_command(rig, oauth_url, tmp_path):
    apps, _, memory, _ = rig
    row = AppRow("notes", "Notes", "http", {"url": oauth_url}, "oauth", True)
    await run_app(apps, memory, row)
    handlers = {
        s.name: h
        for s, h in app_home_tools(apps, memory, TokenFile(tmp_path), lambda *_: None, Bodies())
    }
    with pytest.raises(RpcError) as err:
        await handlers["sign_in_app"]({"id": "notes"})
    assert err.value.message == signin_line(oauth_url)


async def test_a_token_the_sdk_refreshes_after_the_pipe_opened_is_masked_in_what_comes_back(
    rig, oauth_url
):
    apps, node, memory, node_dir = rig
    node.allowlist.allow(PipeSpec(url=oauth_url))
    await sign_in(oauth_url, node_dir, browser, timeout=15)
    row = AppRow("notes", "Notes", "http", {"url": oauth_url}, "oauth", True)
    await run_app(apps, memory, row)
    refreshed = OAuthToken(access_token="refreshed-token", token_type="Bearer")
    await oauth_storage(node_dir, oauth_url).set_tokens(refreshed)
    result = await apps.call("notes", "echo", {"text": "refreshed-token"})
    assert result.content[0].text == "[secret]"
