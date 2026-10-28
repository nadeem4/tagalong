"""Tests for connected apps: slugs, env expansion, validation, the apps table store, and the
Apps manager (against a real fake MCP server over stdio and http, including process cleanup)."""

import asyncio
import os
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from brain import memory
from brain.apps import AppError, AppRow, Apps, TokenFile, expand_env, slug_for, validate_app
from brain.memory import Memory

FAKE = str(Path(__file__).parent / "fake_mcp_server.py")


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "a.db")
    yield m
    m.close()


def test_migration_adds_apps(tmp_path):
    path = tmp_path / "m.db"
    Memory(path).close()
    db = sqlite3.connect(path)
    cols = [r[1] for r in db.execute("PRAGMA table_info(apps)")]
    assert cols == ["id", "name", "transport", "config", "auth", "enabled"]
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO apps VALUES('x','X','ftp','{}','none',1)")
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO apps VALUES('x','X','http','{}','basic',1)")
    db.close()
    assert len(memory.MIGRATIONS) >= 5


def test_slug_basic():
    assert slug_for("My Linear App!", set()) == "my-linear-app"


def test_slug_clash():
    assert slug_for("Linear", {"linear"}) == "linear-2"
    assert slug_for("Linear", {"linear", "linear-2"}) == "linear-3"


def test_slug_avoids_body_ids():
    assert slug_for("Desktop", set()) == "desktop-2"
    assert slug_for("extension", set()) == "extension-2"


def test_slug_max_24():
    slug = slug_for("a" * 40, set())
    assert slug == "a" * 24
    assert len(slug_for("a" * 40, {slug})) <= 24
    assert slug_for("a" * 40, {slug}).endswith("-2")


def test_slug_empty_name():
    assert slug_for("!!!", set()) == "app"


def test_expand_env():
    env = {"A": "1", "E": ""}
    assert expand_env("x-${A}-y", env) == "x-1-y"
    assert expand_env("${B:-d}", env) == "d"
    assert expand_env("${A:-d}", env) == "1"
    assert expand_env("plain", env) == "plain"


def test_expand_env_unset_names_variable_not_values():
    with pytest.raises(AppError) as err:
        expand_env("${A}", {"SECRET": "hunter2"})
    assert str(err.value) == "needs A set in brain's environment"
    assert "hunter2" not in str(err.value)


def good_http(**over):
    return {
        "name": "Linear",
        "transport": "http",
        "config": {"url": "https://mcp.linear.app/mcp"},
        **over,
    }


def test_validate_http_scheme():
    row = validate_app(good_http())
    assert row == AppRow(
        "linear", "Linear", "http", {"url": "https://mcp.linear.app/mcp"}, "none", True
    )
    with pytest.raises(AppError, match="https"):
        validate_app(good_http(config={"url": "http://example.com"}))
    assert validate_app(good_http(config={"url": "http://localhost:3000"})).config["url"]
    assert validate_app(good_http(config={"url": "http://127.0.0.1:3000/x"}))


def test_validate_http_rejects_malformed_and_hostless_urls():
    with pytest.raises(AppError, match="url"):
        validate_app(good_http(config={"url": "http://[bad"}))
    with pytest.raises(AppError, match="host"):
        validate_app(good_http(config={"url": "https://"}))
    with pytest.raises(AppError, match="host"):
        validate_app(good_http(config={"url": "https:///path"}))


def test_validate_http_needs_url():
    with pytest.raises(AppError, match="url"):
        validate_app(good_http(config={}))


def test_validate_stdio():
    row = validate_app(
        {
            "name": "Files",
            "transport": "stdio",
            "config": {"command": "npx", "args": ["-y", "srv"], "env": {"K": "${K}"}},
            "auth": "none",
        }
    )
    assert row.config["env"] == {"K": "${K}"}  # refs stay verbatim
    with pytest.raises(AppError, match="command"):
        validate_app({"name": "F", "transport": "stdio", "config": {}})
    with pytest.raises(AppError, match="args"):
        validate_app({"name": "F", "transport": "stdio", "config": {"command": "x", "args": "no"}})


def test_validate_rejects_token_param():
    with pytest.raises(AppError, match="token"):
        validate_app(good_http(token="secret"))


def test_validate_rejects_bad_fields():
    with pytest.raises(AppError, match="name"):
        validate_app(good_http(name=" "))
    with pytest.raises(AppError, match="transport"):
        validate_app(good_http(transport="ftp"))
    with pytest.raises(AppError, match="auth"):
        validate_app(good_http(auth="basic"))


def test_validate_id_avoids_taken():
    assert validate_app(good_http(), taken={"linear"}).id == "linear-2"


def test_store_roundtrip(mem):
    row = validate_app(good_http())
    mem.add_app(row)
    assert mem.list_apps() == [row]
    mem.set_app_enabled("linear", False)
    assert mem.list_apps()[0].enabled is False
    mem.remove_app("linear")
    assert mem.list_apps() == []


def test_store_survives_reopen(tmp_path):
    m = Memory(tmp_path / "r.db")
    m.add_app(validate_app(good_http()))
    m.close()
    m = Memory(tmp_path / "r.db")
    assert m.list_apps()[0].config == {"url": "https://mcp.linear.app/mcp"}
    m.close()


# ---- Apps manager ----


def stdio_row(app_id="fake", mode=None, env=None, command=None, enabled=True) -> AppRow:
    args = [FAKE] + ([mode] if mode else [])
    config = {"command": command or sys.executable, "args": args, "env": env or {}}
    return AppRow(app_id, app_id, "stdio", config, "none", enabled)


def pid_alive(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes

        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED
        if not handle:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


async def until(predicate, timeout=15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("condition not reached in time")


class Rig:
    def __init__(self, rows, env=None, connect_timeout=15, ping_interval=30, tokens=None):
        self.memory = Memory(":memory:")
        for row in rows:
            self.memory.add_app(row)
        self.events: list[tuple[str, dict]] = []
        self.apps = Apps(
            self.memory,
            lambda m, p: self.events.append((m, p)),
            env or {},
            connect_timeout=connect_timeout,
            ping_interval=ping_interval,
            tokens=tokens,
        )

    async def up(self, app_id, state="connected"):
        await until(lambda: self.apps.status(app_id).state == state)


@pytest.fixture
async def make():
    rigs: list[Rig] = []

    def build(rows, **kw):
        rig = Rig(rows, **kw)
        rigs.append(rig)
        return rig

    yield build
    for rig in rigs:
        await rig.apps.shutdown()


async def test_connects_and_lists_tools(make):
    rig = make([stdio_row()])
    await rig.apps.start()
    await rig.up("fake")
    names = {t.name for t in rig.apps.tools("fake")}
    assert {"echo", "read_note", "delete_note", "slow", "big", "add_tool"} == names
    assert rig.apps.status("fake").tool_count == 6
    result = await rig.apps.call("fake", "echo", {"text": "hi"})
    assert result.content[0].text == "hi"


async def test_start_returns_before_connecting(make):
    rig = make([stdio_row()])
    await rig.apps.start()
    assert rig.apps.status("fake").state == "connecting"


async def test_disabled_app_stays_off(make):
    rig = make([stdio_row(enabled=False)])
    await rig.apps.start()
    await asyncio.sleep(0.2)
    assert rig.apps.status("fake").state == "off"
    assert rig.apps.tools("fake") == []


async def test_server_that_hangs_times_out(make):
    rig = make([stdio_row(mode="hang")], connect_timeout=0.5)
    await rig.apps.start()
    await rig.up("fake", "error")
    assert "did not answer in time" in rig.apps.status("fake").error


async def test_server_that_exits_is_an_error(make):
    rig = make([stdio_row(mode="exit")])
    await rig.apps.start()
    await rig.up("fake", "error")
    assert rig.apps.status("fake").error


async def test_missing_command_names_it(make):
    rig = make([stdio_row(command="no-such-command-xyz")])
    await rig.apps.start()
    await rig.up("fake", "error")
    assert rig.apps.status("fake").error == "cannot find the command no-such-command-xyz"


async def test_unset_env_ref_is_a_plain_error(make):
    rig = make([stdio_row(env={"TOKEN": "${NOPE_TOKEN}"})])
    await rig.apps.start()
    await rig.up("fake", "error")
    assert rig.apps.status("fake").error == "needs NOPE_TOKEN set in brain's environment"


async def test_a_failing_app_leaves_another_connected(make):
    rig = make([stdio_row("good"), stdio_row("bad", mode="exit")])
    await rig.apps.start()
    await rig.up("good")
    await rig.up("bad", "error")
    assert rig.apps.status("good").state == "connected"


async def test_restart_reconnects(make):
    rig = make([stdio_row()])
    await rig.apps.start()
    await rig.up("fake")
    await rig.apps.restart("fake")
    await rig.up("fake")
    result = await rig.apps.call("fake", "echo", {"text": "again"})
    assert result.content[0].text == "again"


async def test_process_is_gone_after_stop_and_shutdown(make, tmp_path):
    pidfile = tmp_path / "pid"
    rig = make([stdio_row(env={"FAKE_PIDFILE": str(pidfile)})])
    await rig.apps.start()
    await rig.up("fake")
    pid = int(pidfile.read_text())
    assert pid_alive(pid)
    await rig.apps.stop("fake")
    assert rig.apps.status("fake").state == "off"
    await until(lambda: not pid_alive(pid), timeout=10)

    await rig.apps.restart("fake")
    await rig.up("fake")
    pid2 = int(pidfile.read_text())
    assert pid_alive(pid2)
    await rig.apps.shutdown()
    await until(lambda: not pid_alive(pid2), timeout=10)


async def test_last_tools_survive_stop(make):
    rig = make([stdio_row()])
    await rig.apps.start()
    await rig.up("fake")
    await rig.apps.stop("fake")
    assert len(rig.apps.tools("fake")) == 6


async def test_tool_list_changed_relists(make):
    rig = make([stdio_row()])
    await rig.apps.start()
    await rig.up("fake")
    await rig.apps.call("fake", "add_tool", {})
    await until(lambda: rig.apps.status("fake").tool_count == 7)
    assert "extra" in {t.name for t in rig.apps.tools("fake")}


async def test_state_changes_notify(make):
    rig = make([stdio_row()])
    await rig.apps.start()
    await rig.up("fake")
    assert ("changed", {"what": "apps"}) in rig.events
    before = len(rig.events)
    await rig.apps.stop("fake")
    assert len(rig.events) > before


async def test_call_when_not_connected_is_a_plain_error(make):
    rig = make([stdio_row(enabled=False)])
    await rig.apps.start()
    with pytest.raises(AppError, match="not connected"):
        await rig.apps.call("fake", "echo", {"text": "x"})
    with pytest.raises(AppError, match="no app"):
        await rig.apps.call("ghost", "echo", {})


async def test_call_times_out(make):
    rig = make([stdio_row()])
    await rig.apps.start()
    await rig.up("fake")
    with pytest.raises(AppError, match="did not answer"):
        await rig.apps.call("fake", "slow", {}, timeout=0.5)


async def wait_for_port(port: int, timeout: float = 20.0) -> None:
    """The server needs a moment to listen; a refused connect would fail the test at once."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=1).close()
            return
        except OSError:
            if time.monotonic() > deadline:
                raise
            await asyncio.sleep(0.1)


def kill_pid(pid: int) -> None:
    subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"]
        if sys.platform == "win32"
        else ["kill", "-9", str(pid)],
        capture_output=True,
    )


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def test_http_app_connects_and_stops(make):
    port = free_port()
    server = subprocess.Popen([sys.executable, FAKE, "--http", str(port)])
    try:
        await wait_for_port(port)
        url = f"http://127.0.0.1:{port}/mcp"
        rig = make([AppRow("web", "web", "http", {"url": url}, "none", True)])
        await rig.apps.start()
        await rig.up("web")
        assert rig.apps.status("web").tool_count == 6
        result = await rig.apps.call("web", "echo", {"text": "net"})
        assert result.content[0].text == "net"
        await rig.apps.stop("web")
        assert rig.apps.status("web").state == "off"
    finally:
        server.kill()
        server.wait()


async def test_http_unreachable_is_an_error(make):
    url = f"http://127.0.0.1:{free_port()}/mcp"
    rig = make([AppRow("web", "web", "http", {"url": url}, "none", True)])
    await rig.apps.start()
    await rig.up("web", "error")
    assert rig.apps.status("web").error


async def test_dropped_connection_found_by_a_call(make, tmp_path):
    pidfile = tmp_path / "pid"
    rig = make([stdio_row(env={"FAKE_PIDFILE": str(pidfile)})])
    await rig.apps.start()
    await rig.up("fake")
    pid = int(pidfile.read_text())
    kill_pid(pid)
    await until(lambda: not pid_alive(pid), timeout=10)
    with pytest.raises(AppError, match="closed"):
        await rig.apps.call("fake", "echo", {"text": "x"})
    status = rig.apps.status("fake")
    assert status.state == "error"
    assert status.error == "The connection fake closed."


async def test_dropped_connection_found_by_ping(make, tmp_path):
    pidfile = tmp_path / "pid"
    rig = make([stdio_row(env={"FAKE_PIDFILE": str(pidfile)})], ping_interval=0.3)
    await rig.apps.start()
    await rig.up("fake")
    kill_pid(int(pidfile.read_text()))
    await rig.up("fake", "error")
    assert rig.apps.status("fake").error == "The connection fake closed."


async def test_concurrent_restarts_leave_one_process(make, tmp_path):
    pidfile = tmp_path / "pid"
    rig = make([stdio_row(env={"FAKE_PIDFILE": str(pidfile)})])
    await rig.apps.start()
    await rig.up("fake")
    first = int(pidfile.read_text())
    await asyncio.gather(rig.apps.restart("fake"), rig.apps.restart("fake"))
    await rig.up("fake")
    await until(lambda: not pid_alive(first), timeout=10)
    last = int(pidfile.read_text())
    assert pid_alive(last)
    await rig.apps.shutdown()
    await until(lambda: not pid_alive(last), timeout=10)
    # The restart that lost the race wrote its own pid first; it must be gone too.


# ---- Task 4: token file and bearer header ----


def test_token_file_roundtrip(tmp_path):
    tokens = TokenFile(tmp_path)
    assert tokens.get("linear") is None
    tokens.set("linear", "s3cret")
    assert TokenFile(tmp_path).get("linear") == "s3cret"  # survives reopen
    tokens.set("other", "x")
    tokens.delete("linear")
    assert tokens.get("linear") is None
    assert tokens.get("other") == "x"
    tokens.delete("nope")  # deleting an absent token is fine


def test_token_never_reaches_the_apps_table(tmp_path, mem):
    TokenFile(tmp_path).set("linear", "s3cret-token")
    mem.add_app(validate_app({**good_http(), "auth": "token"}))
    assert (tmp_path / "app-tokens.json").exists()
    db = sqlite3.connect(tmp_path / "a.db")
    dump = "\n".join(db.iterdump())
    db.close()
    assert "s3cret-token" not in dump


class _Recorder(BaseHTTPRequestHandler):
    seen: list[str | None] = []

    def do_POST(self):  # noqa: N802
        _Recorder.seen.append(self.headers.get("Authorization"))
        self.send_response(500)
        self.end_headers()

    def log_message(self, *args):
        pass


@pytest.fixture
def recorder():
    _Recorder.seen = []
    server = HTTPServer(("127.0.0.1", 0), _Recorder)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/mcp"
    server.shutdown()


async def test_http_token_app_sends_bearer(make, recorder, tmp_path):
    TokenFile(tmp_path).set("web", "tok123")
    row = AppRow("web", "web", "http", {"url": recorder}, "token", True)
    rig = make([row], tokens=TokenFile(tmp_path))
    await rig.apps.start()
    await rig.up("web", "error")
    assert _Recorder.seen and set(_Recorder.seen) == {"Bearer tok123"}
    assert "tok123" not in rig.apps.status("web").error


async def test_http_none_auth_sends_no_header(make, recorder):
    rig = make([AppRow("web", "web", "http", {"url": recorder}, "none", True)])
    await rig.apps.start()
    await rig.up("web", "error")
    assert _Recorder.seen and set(_Recorder.seen) == {None}


async def test_missing_token_is_a_plain_error(make, recorder, tmp_path):
    row = AppRow("web", "Web", "http", {"url": recorder}, "token", True)
    rig = make([row], tokens=TokenFile(tmp_path))
    await rig.apps.start()
    await rig.up("web", "error")
    assert rig.apps.status("web").error == "Web needs its token added again."
    assert _Recorder.seen == []


async def test_apps_lists_ids_and_names(make):
    rig = make([stdio_row(enabled=False)])
    await rig.apps.start()
    assert rig.apps.ids() == ["fake"]
    assert rig.apps.name("fake") == "fake"
