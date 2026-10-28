"""Tests for Home's app calls (list, add, enable, remove, restart) against a real fake stdio
MCP server, plus the wiring: Session offers AppSource and main shuts apps down before memory."""

import asyncio
import json
import sys
from pathlib import Path

import pytest

from brain import main
from brain.app_tools import AppSource, app_home_tools
from brain.apps import Apps, TokenFile
from brain.bodies import Bodies
from brain.memory import Memory
from brain.mind.turn import Call
from brain.protocol import RpcError
from brain.sessions import Session

FAKE = str(Path(__file__).parent / "fake_mcp_server.py")


class Open:
    def allows(self):
        return True

    def spend(self, usage, model):
        pass


@pytest.fixture
async def rig(tmp_path):
    mem = Memory(tmp_path / "h.db")
    sent = []
    tokens = TokenFile(tmp_path)
    apps = Apps(mem, lambda m, p: sent.append((m, p)), {}, connect_timeout=15, tokens=tokens)
    handlers = {
        s.name: h for s, h in app_home_tools(apps, mem, tokens, lambda m, p: sent.append((m, p)))
    }

    async def call(name, args=None):
        return json.loads(await handlers[name](args or {}))

    yield SimpleRig(mem, apps, tokens, call, sent, handlers)
    await apps.shutdown()
    mem.close()


class SimpleRig:
    def __init__(self, mem, apps, tokens, call, sent, handlers):
        self.mem, self.apps, self.tokens = mem, apps, tokens
        self.call, self.sent, self.handlers = call, sent, handlers


def stdio(name="Fake", **over):
    return {"name": name, "transport": "stdio", "command": sys.executable, "args": [FAKE], **over}


async def until(check, timeout=20.0):
    async with asyncio.timeout(timeout):
        while not check():
            await asyncio.sleep(0.05)


async def test_home_tools_are_home_only(rig):
    specs = [s for s, _ in app_home_tools(rig.apps, rig.mem, rig.tokens, lambda m, p: None)]
    assert [s.name for s in specs] == [
        "list_apps",
        "add_app",
        "set_app_enabled",
        "remove_app",
        "restart_app",
    ]
    assert all(s.audience == frozenset({"home"}) for s in specs)
    assert specs[0].effect == "read"
    assert all(s.effect == "change" for s in specs[1:])


async def test_list_apps_empty(rig):
    assert await rig.call("list_apps") == {"apps": []}


async def test_add_app_connects_and_lists_tools(rig):
    out = await rig.call("add_app", stdio(auth="none"))
    assert out["id"] == "fake"
    await until(lambda: rig.apps.status("fake").state == "connected")
    listed = (await rig.call("list_apps"))["apps"]
    assert len(listed) == 1
    app = listed[0]
    assert (app["id"], app["name"], app["transport"], app["auth"]) == (
        "fake",
        "Fake",
        "stdio",
        "none",
    )
    assert app["enabled"] is True and app["status"] == "connected" and app["error"] == ""
    by_name = {t["name"]: t for t in app["tools"]}
    assert by_name["fake__read_note"] == {
        "name": "fake__read_note",
        "effect": "read",
        "locked": False,
    }
    assert by_name["fake__delete_note"]["locked"] is True
    assert ("changed", {"what": "apps"}) in rig.sent


async def test_add_app_duplicate_name_gets_suffix(rig):
    await rig.call("add_app", stdio())
    out = await rig.call("add_app", stdio())
    assert out["id"] == "fake-2"


@pytest.mark.parametrize(
    ("args", "words"),
    [
        ({"name": "X", "transport": "stdio"}, "command"),
        ({"name": "X", "transport": "http", "url": "http://example.com/mcp"}, "https"),
        (
            {"name": "X", "transport": "http", "url": "https://example.com/mcp", "auth": "token"},
            "token",
        ),
        (
            {"name": "X", "transport": "http", "url": "https://example.com/mcp", "token": "t"},
            "token",
        ),
    ],
)
async def test_add_app_bad_input_is_a_plain_line(rig, args, words):
    with pytest.raises(RpcError) as err:
        await rig.handlers["add_app"](args)
    assert words in err.value.message
    assert rig.mem.list_apps() == []
    assert rig.tokens.get("x") is None


async def test_add_app_stores_token_apart_from_row(rig):
    await rig.call(
        "add_app",
        {
            "name": "Remote",
            "transport": "http",
            "url": "https://127.0.0.1:1/mcp",
            "auth": "token",
            "token": "s3cret",
        },
    )
    assert rig.tokens.get("remote") == "s3cret"
    assert "s3cret" not in json.dumps([r.__dict__ for r in rig.mem.list_apps()])
    assert "s3cret" not in json.dumps(await rig.call("list_apps"))


async def test_set_app_enabled_hides_tools(rig):
    await rig.call("add_app", stdio())
    await until(lambda: rig.apps.status("fake").state == "connected")
    src = AppSource(rig.apps)
    assert src.specs()
    await rig.call("set_app_enabled", {"id": "fake", "enabled": False})
    assert src.specs() == []
    app = (await rig.call("list_apps"))["apps"][0]
    assert app["enabled"] is False and app["status"] == "off"
    await rig.call("set_app_enabled", {"id": "fake", "enabled": True})
    await until(lambda: rig.apps.status("fake").state == "connected")
    assert src.specs()


async def test_remove_app_deletes_row_and_token(rig):
    await rig.call(
        "add_app",
        {
            "name": "Remote",
            "transport": "http",
            "url": "https://127.0.0.1:1/mcp",
            "auth": "token",
            "token": "s3cret",
        },
    )
    await rig.call("remove_app", {"id": "remote"})
    assert rig.mem.list_apps() == []
    assert rig.tokens.get("remote") is None
    assert rig.apps.ids() == []
    assert (await rig.call("list_apps")) == {"apps": []}


async def test_restart_app_reconnects(rig):
    await rig.call("add_app", stdio())
    await until(lambda: rig.apps.status("fake").state == "connected")
    await rig.call("restart_app", {"id": "fake"})
    await until(lambda: rig.apps.status("fake").state == "connected")


@pytest.mark.parametrize("name", ["set_app_enabled", "remove_app", "restart_app"])
async def test_unknown_id_is_refused_plainly(rig, name):
    with pytest.raises(RpcError) as err:
        await rig.handlers[name]({"id": "nope", "enabled": True})
    assert err.value.message == "There is no app called nope."


async def test_failed_store_leaves_no_token(rig, monkeypatch):
    def boom(row):
        raise RuntimeError("disk full")

    monkeypatch.setattr(rig.mem, "add_app", boom)
    with pytest.raises(RuntimeError):
        await rig.handlers["add_app"](
            {
                "name": "R",
                "transport": "http",
                "url": "https://127.0.0.1:1/mcp",
                "auth": "token",
                "token": "s3cret",
            }
        )
    assert rig.tokens.get("r") is None


# ---- wiring ----


async def test_session_offers_app_tools_and_home_calls(rig):
    bodies = Bodies()
    bodies.notify = lambda m, p: None
    session = Session(object(), Open(), bodies, 10, rig.mem, apps=rig.apps, tokens=rig.tokens)
    home = {t.name for t in session.home_tools()}
    assert {"list_apps", "add_app", "set_app_enabled", "remove_app", "restart_app"} <= home
    await session.call_home("add_app", stdio())
    await until(lambda: rig.apps.status("fake").state == "connected")
    model_tools = {t["name"] for t in session.toolbox.model_tools()}
    assert "fake__read_note" in model_tools
    assert not model_tools & {"list_apps", "add_app", "remove_app"}


async def test_dropped_app_tool_gets_the_apps_name_not_the_slug(rig):
    bodies = Bodies()
    bodies.notify = lambda m, p: None
    session = Session(object(), Open(), bodies, 10, rig.mem, apps=rig.apps, tokens=rig.tokens)
    await session.call_home("add_app", stdio("Fake App", args=["exit"]))
    await until(lambda: rig.apps.status("fake-app").state == "error")
    with pytest.raises(RpcError) as e:
        await session.toolbox.run(
            Call(id="c1", name="fake-app__read_note", input={}, turn="t", text="")
        )
    assert e.value.message == "Fake App is not connected right now."


async def test_session_without_apps_has_no_app_calls():
    bodies = Bodies()
    bodies.notify = lambda m, p: None
    session = Session(object(), Open(), bodies, 10, Memory(":memory:"))
    assert "list_apps" not in {t.name for t in session.home_tools()}


def test_main_shuts_apps_down_before_memory_closes(monkeypatch, tmp_path):
    order = []
    real_close = main.Memory.close
    real_shutdown = Apps.shutdown

    class Spy(main.Memory):
        def close(self):
            order.append("memory")
            real_close(self)

    async def shutdown(self):
        order.append("apps")
        await real_shutdown(self)

    async def stop(*args):
        raise RuntimeError("stop")

    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr(main, "Memory", Spy)
    monkeypatch.setattr(main, "start_server", stop)
    monkeypatch.setattr(Apps, "shutdown", shutdown)
    with pytest.raises(RuntimeError):
        asyncio.run(main._run())
    assert order == ["apps", "memory"]


def test_main_boots_despite_a_hanging_app(monkeypatch, tmp_path):
    from brain.apps import validate_app

    m = Memory(tmp_path / "tagalong.db")
    m.add_app(
        validate_app(
            {
                "name": "Stuck",
                "transport": "stdio",
                "config": {"command": sys.executable, "args": [FAKE, "hang"]},
            }
        )
    )
    m.close()
    booted = []

    class Server:
        sockets = [type("S", (), {"getsockname": lambda self: ("127.0.0.1", 1)})()]

        async def serve_forever(self):
            booted.append(True)
            raise RuntimeError("stop")

    async def start(*args):
        return Server()

    monkeypatch.setenv("TAGALONG_HOME", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr(main, "start_server", start)
    with pytest.raises(RuntimeError):
        asyncio.run(asyncio.wait_for(main._run(), 60))
    assert booted == [True]
