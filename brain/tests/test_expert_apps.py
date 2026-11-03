"""The expert-apps bridge, driven by a real MCP client over loopback http on fake Apps.

Covers what an expert may see (chosen apps only), the token, the gate (asks and the job id in
approvals), masking, and that a token dies with its grant. Fakes only; no real app or model.
"""

import asyncio
import contextlib
import json
import logging
from datetime import UTC, datetime
from types import SimpleNamespace

import httpx2
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client
from mcp.types import CallToolResult, TextContent, Tool, ToolAnnotations

from brain.app_tools import AppSource
from brain.approvals import Approvals
from brain.expert_apps import ExpertApps
from brain.guards import Guards
from brain.masking import Masker, mask_secrets
from brain.memory import Memory
from brain.outputs import OutputStore
from brain.toolbox import Toolbox

SECRET = "sk-live-0123456789abcdef"


def tool(name, read_only=None):
    hints = ToolAnnotations(read_only_hint=read_only) if read_only is not None else None
    return Tool(name=name, input_schema={"type": "object"}, annotations=hints, description="d")


class FakeApps:
    def __init__(self):
        self._tools = {
            "lin": [tool("list_issues", read_only=True), tool("create_issue")],
            "mail": [tool("read_inbox", read_only=True)],
        }
        self.calls = []
        self.reply = f"issues for key {SECRET}"

    def ids(self):
        return list(self._tools)

    def name(self, app_id):
        return app_id.title()

    def status(self, app_id):
        return SimpleNamespace(state="connected")

    def tools(self, app_id):
        return self._tools[app_id]

    async def call(self, app_id, name, args):
        self.calls.append((app_id, name, args))
        return CallToolResult(content=[TextContent(type="text", text=self.reply)])


class FakeAsks:
    def __init__(self, answer="allow"):
        self.answer = answer
        self.asked = []
        self.texts = []

    def anyone_online(self):
        return True

    async def permission(self, call, spec_name, locked):
        self.asked.append((spec_name, call.turn))
        self.texts.append(call.text)
        return self.answer


class Rig:
    def __init__(self, tmp_path, answer="allow", cap=None):
        self.apps = FakeApps()
        self.memory = Memory(tmp_path / "t.db")
        self.guards = Guards()
        self.guards.add(mask_secrets(Masker(lambda: [SECRET])))
        self.asks = FakeAsks(answer)
        self.approvals = Approvals(
            self.memory, lambda m, p: None, lambda: datetime(2026, 1, 1, tzinfo=UTC)
        )
        self.toolbox = Toolbox(
            [AppSource(self.apps)],
            self.memory.permission_modes,
            self.memory.set_permission_mode,
            self.asks,
            self.approvals,
            outputs=OutputStore(self.memory, self.guards, cap) if cap else None,
        )
        self.bridge = ExpertApps(self.apps, lambda: self.toolbox, self.guards)


@pytest.fixture
async def rig(tmp_path):
    r = Rig(tmp_path)
    yield r
    await r.bridge.shutdown()
    r.memory.close()


def headers_of(grant):
    return {h.name: h.value for h in grant.descriptor.headers}


@contextlib.asynccontextmanager
async def Client(descriptor, headers):  # noqa: N802
    """A real MCP client on the descriptor an expert would get."""
    async with create_mcp_http_client(headers=headers) as http:
        async with streamable_http_client(descriptor.url, http_client=http) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session


async def test_only_the_chosen_apps_are_listed(rig):
    grant = await rig.bridge.grant("job1", ["lin"])
    grant.sent = True  # the person has sent the card
    async with Client(grant.descriptor, headers_of(grant)) as s:
        names = sorted(t.name for t in (await s.list_tools()).tools)
    assert names == ["lin__create_issue", "lin__list_issues"]


async def test_a_tool_of_another_app_is_not_found(rig):
    grant = await rig.bridge.grant("job1", ["lin"])
    grant.sent = True  # the person has sent the card
    async with Client(grant.descriptor, headers_of(grant)) as s:
        out = await s.call_tool("mail__read_inbox", {})
    assert out.is_error
    assert "No tool named" in out.content[0].text
    assert rig.apps.calls == []


async def test_a_wrong_or_missing_token_is_refused(rig):
    grant = await rig.bridge.grant("job1", ["lin"])
    grant.sent = True  # the person has sent the card
    async with httpx2.AsyncClient() as http:
        for auth in ({"Authorization": "Bearer nope"}, {}):
            r = await http.post(grant.descriptor.url, headers=auth, json={})
            assert r.status_code == 401


async def test_an_auto_tool_runs_without_asking_and_is_masked(rig):
    rig.memory.set_permission_mode("lin__list_issues", "auto")
    grant = await rig.bridge.grant("job1", ["lin"])
    grant.sent = True  # the person has sent the card
    async with Client(grant.descriptor, headers_of(grant)) as s:
        out = await s.call_tool("lin__list_issues", {"q": "x"})
    text = out.content[0].text
    assert not out.is_error
    assert SECRET not in text and "[secret]" in text
    assert rig.apps.calls == [("lin", "list_issues", {"q": "x"})]
    assert rig.asks.asked == []


async def test_a_change_tool_asks_and_the_approval_row_names_the_job(rig):
    grant = await rig.bridge.grant("job7", ["lin"])
    grant.sent = True  # the person has sent the card
    async with Client(grant.descriptor, headers_of(grant)) as s:
        out = await s.call_tool("lin__create_issue", {"title": "t"})
    assert not out.is_error
    assert [name for name, _ in rig.asks.asked] == ["lin__create_issue"]
    rows = rig.memory.list_approvals("all", 10, None)
    assert [(r.tool, r.job_id, r.outcome) for r in rows] == [
        ("lin__create_issue", "job7", "approved")
    ]


async def test_an_ask_says_what_the_expert_wants_and_for_which_job(rig):
    grant = await rig.bridge.grant("job7", ["lin"])
    grant.sent = True  # the person has sent the card
    async with Client(grant.descriptor, headers_of(grant)) as s:
        await s.call_tool("lin__create_issue", {"title": "t"})
    [text] = rig.asks.texts
    assert "lin__create_issue" in text and '"title"' in text and "job7" in text


async def test_a_non_ascii_authorization_header_is_a_401(rig):
    grant = await rig.bridge.grant("job1", ["lin"])
    grant.sent = True  # the person has sent the card
    async with httpx2.AsyncClient() as http:
        r = await http.post(
            grant.descriptor.url, headers={"Authorization": "Bearer café".encode()}, json={}
        )
    assert r.status_code == 401


async def test_a_long_result_is_capped_without_an_output_id(tmp_path):
    rig = Rig(tmp_path, cap=50)
    try:
        rig.memory.set_permission_mode("lin__list_issues", "auto")
        rig.apps.reply = "x" * 500
        grant = await rig.bridge.grant("job1", ["lin"])
        grant.sent = True  # the person has sent the card
        async with Client(grant.descriptor, headers_of(grant)) as s:
            out = await s.call_tool("lin__list_issues", {})
        text = out.content[0].text
        assert "output_id" not in text and "read_output" not in text
        assert '"truncated": true' in text and len(text) < 300
    finally:
        await rig.bridge.shutdown()
        rig.memory.close()


async def test_a_refused_ask_never_runs_the_tool(tmp_path):
    rig = Rig(tmp_path, answer="deny")
    try:
        grant = await rig.bridge.grant("job1", ["lin"])
        grant.sent = True  # the person has sent the card
        async with Client(grant.descriptor, headers_of(grant)) as s:
            out = await s.call_tool("lin__create_issue", {})
        assert out.is_error
        assert rig.apps.calls == []
    finally:
        await rig.bridge.shutdown()
        rig.memory.close()


async def test_an_off_tool_is_not_listed(rig):
    rig.memory.set_permission_mode("lin__create_issue", "off")
    grant = await rig.bridge.grant("job1", ["lin"])
    grant.sent = True  # the person has sent the card
    async with Client(grant.descriptor, headers_of(grant)) as s:
        names = [t.name for t in (await s.list_tools()).tools]
    assert names == ["lin__list_issues"]


async def test_the_token_dies_with_the_grant(rig):
    grant = await rig.bridge.grant("job1", ["lin"])
    grant.sent = True  # the person has sent the card
    other = await rig.bridge.grant("job2", ["mail"])
    await rig.bridge.revoke(grant)
    async with httpx2.AsyncClient() as http:
        r = await http.post(grant.descriptor.url, headers=headers_of(grant), json={})
        assert r.status_code == 401
    async with Client(other.descriptor, headers_of(other)) as s:  # the other job is unharmed
        assert [t.name for t in (await s.list_tools()).tools] == ["mail__read_inbox"]


async def test_the_bridge_listens_on_loopback_only(rig):
    grant = await rig.bridge.grant("job1", ["lin"])
    grant.sent = True  # the person has sent the card
    assert grant.descriptor.url.startswith("http://127.0.0.1:")


async def test_no_app_secret_reaches_a_log_or_the_descriptor(rig, caplog):
    caplog.set_level(logging.DEBUG)
    grant = await rig.bridge.grant("job1", ["lin"])
    grant.sent = True  # the person has sent the card
    async with Client(grant.descriptor, headers_of(grant)) as s:
        await s.call_tool("lin__list_issues", {})
    assert SECRET not in caplog.text
    assert SECRET not in json.dumps(grant.descriptor.model_dump(mode="json"))
    # The bearer token is the one secret the expert holds; it must not be logged either.
    assert grant.token not in caplog.text


async def test_shutdown_stops_serving(rig):
    grant = await rig.bridge.grant("job1", ["lin"])
    grant.sent = True  # the person has sent the card
    await rig.bridge.shutdown()
    with pytest.raises(httpx2.HTTPError):
        async with httpx2.AsyncClient() as http:
            await http.post(grant.descriptor.url, headers=headers_of(grant), json={})


async def test_a_second_grant_reuses_the_one_server(rig):
    a = await rig.bridge.grant("job1", ["lin"])
    b = await rig.bridge.grant("job2", ["lin"])
    assert a.descriptor.url == b.descriptor.url and a.token != b.token
    await asyncio.sleep(0)


async def test_a_call_before_send_is_refused_but_listing_is_allowed(rig):
    grant = await rig.bridge.grant("job1", ["lin"])
    async with Client(grant.descriptor, headers_of(grant)) as s:
        assert (await s.list_tools()).tools
        out = await s.call_tool("lin__list_issues", {})
    assert out.is_error and "not sent" in out.content[0].text
    assert rig.apps.calls == []
