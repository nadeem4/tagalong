"""Checks F9: list_apps offers no tools for an app that is Off or failed, and an app's error
line is one plain sentence naming the app, never raw OS text.

Fakes only: a fake stdio MCP server, and hand-built exceptions for the error wording.
"""

import socket

import httpx2
from test_app_home_tools import rig, stdio, until  # noqa: F401  (rig is a fixture)

from brain.apps import _connect_error


async def test_an_off_app_lists_no_tools(rig):  # noqa: F811
    await rig.call("add_app", stdio())
    await until(lambda: rig.apps.status("fake").state == "connected")
    assert (await rig.call("list_apps"))["apps"][0]["tools"]
    await rig.call("set_app_enabled", {"id": "fake", "enabled": False})
    app = (await rig.call("list_apps"))["apps"][0]
    assert app["status"] == "off" and app["tools"] == []


def test_an_unresolvable_address_is_plain_and_names_the_app():
    err = RuntimeError("[Errno 11001] getaddrinfo failed")
    err.__cause__ = socket.gaierror(11001, "getaddrinfo failed")
    line = _connect_error("Tokapp", err)
    assert line == "Tokapp could not be reached (address not found)."


def test_a_refused_connection_is_plain_and_names_the_app():
    assert _connect_error("Wiki", ConnectionRefusedError(10061, "refused")) == (
        "Wiki could not be reached."
    )


def test_a_timeout_names_the_app():
    assert _connect_error("Hang", TimeoutError()) == "Hang did not answer in time."


def test_other_errors_keep_their_own_line():
    assert _connect_error("Fake", RuntimeError("bad thing\nmore")) == "bad thing"


def test_a_connection_error_wrapped_by_another_is_still_plain():
    err = RuntimeError("all connection attempts failed")
    err.__cause__ = ConnectionRefusedError(10061, "refused")
    assert _connect_error("Wiki", err) == "Wiki could not be reached."


async def test_a_failed_connection_lists_a_plain_error_and_no_tools(rig):  # noqa: F811
    # Nothing listens on port 1, so the real connect fails: this covers the call site.
    await rig.call(
        "add_app",
        {"name": "Wiki", "transport": "http", "url": "https://127.0.0.1:1/mcp", "auth": "none"},
    )
    await until(lambda: rig.apps.status("wiki").state == "error")
    app = (await rig.call("list_apps"))["apps"][0]
    assert app["tools"] == []
    assert app["error"].startswith("Wiki could not be reached")
    assert "Errno" not in app["error"]


def test_an_unreachable_http_address_names_the_app():
    # A blackholed route raises httpx's own connect errors, not an OS ConnectionError.
    for err in (httpx2.ConnectError("All connection attempts failed"), httpx2.ConnectTimeout("")):
        wrapped = RuntimeError("wrapped")
        wrapped.__cause__ = err
        assert _connect_error("Hang", wrapped) == "Hang could not be reached."
