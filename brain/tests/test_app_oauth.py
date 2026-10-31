"""Tests for the OAuth pieces of connected apps: token storage, the loopback listener, the URL
guard, and the sign-in flow end to end against fake_oauth_server.py.

The SDK drives sign-in; these check that what it hands us is saved, reloaded and cleared
safely, that the browser is only opened on request, and that token text never reaches the logs.
"""

import asyncio
import json
import logging
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from brain.app_oauth import FileTokenStorage, LoopbackCallback, OAuthError, make_provider
from brain.apps import AppError, AppRow, Apps
from brain.memory import Memory

FAKE_OAUTH = str(Path(__file__).parent / "fake_oauth_server.py")

TOKEN = OAuthToken(access_token="secret-access-123", token_type="Bearer", refresh_token="secret-r")
CLIENT = OAuthClientInformationFull(
    redirect_uris=["http://127.0.0.1:5555/callback"], client_id="cid", client_secret="secret-cs"
)


async def test_tokens_and_client_info_roundtrip(tmp_path):
    store = FileTokenStorage(tmp_path, "notes")
    await store.set_tokens(TOKEN)
    await store.set_client_info(CLIENT)

    again = FileTokenStorage(tmp_path, "notes")  # a fresh instance reads from disk
    assert await again.get_tokens() == TOKEN
    assert await again.get_client_info() == CLIENT
    assert (tmp_path / "app-oauth" / "notes.json").exists()


async def test_apps_do_not_share_files(tmp_path):
    await FileTokenStorage(tmp_path, "a").set_tokens(TOKEN)
    assert await FileTokenStorage(tmp_path, "b").get_tokens() is None


async def test_missing_file_gives_none(tmp_path):
    store = FileTokenStorage(tmp_path, "notes")
    assert await store.get_tokens() is None
    assert await store.get_client_info() is None


async def test_corrupt_file_gives_none(tmp_path):
    path = tmp_path / "app-oauth" / "notes.json"
    path.parent.mkdir()
    path.write_text("{not json", encoding="utf-8")
    store = FileTokenStorage(tmp_path, "notes")
    assert await store.get_tokens() is None
    assert await store.get_client_info() is None


async def test_setting_one_keeps_the_other(tmp_path):
    store = FileTokenStorage(tmp_path, "notes")
    await store.set_client_info(CLIENT)
    await store.set_tokens(TOKEN)
    assert await store.get_client_info() == CLIENT


def test_clear_removes_the_file(tmp_path):
    import asyncio

    store = FileTokenStorage(tmp_path, "notes")
    asyncio.run(store.set_tokens(TOKEN))
    store.clear()
    assert not (tmp_path / "app-oauth" / "notes.json").exists()
    store.clear()  # clearing twice is fine


def test_clear_also_removes_a_leftover_tmp_file(tmp_path):
    store = FileTokenStorage(tmp_path, "notes")
    tmp = tmp_path / "app-oauth" / "notes.tmp"
    tmp.parent.mkdir()
    tmp.write_text("secret", encoding="utf-8")
    store.clear()
    assert not tmp.exists()


async def test_token_text_is_never_logged(tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    store = FileTokenStorage(tmp_path, "notes")
    await store.set_tokens(TOKEN)
    await store.set_client_info(CLIENT)
    (tmp_path / "app-oauth" / "notes.json").write_text("{bad", encoding="utf-8")
    await store.get_tokens()
    assert "secret" not in caplog.text


async def test_storage_reports_when_the_saved_token_expires(tmp_path):
    store = FileTokenStorage(tmp_path, "notes")
    assert store.expires_at() is None
    before = time.time()
    await store.set_tokens(
        OAuthToken(access_token="a", token_type="Bearer", refresh_token="r", expires_in=60)
    )
    at = store.expires_at()
    assert at is not None and before + 60 <= at <= time.time() + 60
    await store.set_tokens(OAuthToken(access_token="a", token_type="Bearer"))  # no lifetime given
    assert store.expires_at() is None


# ---- loopback listener ----


def _get(url: str) -> str:
    with urllib.request.urlopen(url, timeout=5) as r:
        return r.read().decode()


async def test_listener_serves_one_request_then_closes():
    cb = LoopbackCallback()
    uri = await cb.start()
    assert uri.startswith("http://127.0.0.1:") and uri.endswith("/callback")
    waiter = asyncio.create_task(cb.wait(5))
    await asyncio.to_thread(_get, f"{uri}?code=abc&state=xyz")
    assert await waiter == ("abc", "xyz")
    with pytest.raises(OSError):  # the port is closed after the one request
        socket.create_connection(("127.0.0.1", urlparse(uri).port), timeout=1).close()


async def test_listener_ignores_other_paths():
    cb = LoopbackCallback()
    uri = await cb.start()
    waiter = asyncio.create_task(cb.wait(5))
    base = uri.removesuffix("/callback")
    with pytest.raises(urllib.error.HTTPError):
        await asyncio.to_thread(_get, f"{base}/favicon.ico")
    await asyncio.to_thread(_get, f"{uri}?code=abc&state=s")
    assert await waiter == ("abc", "s")


async def test_listener_timeout_closes_the_port():
    cb = LoopbackCallback()
    uri = await cb.start()
    with pytest.raises(OAuthError, match="not finished"):
        await cb.wait(0.1)
    with pytest.raises(OSError):
        socket.create_connection(("127.0.0.1", urlparse(uri).port), timeout=1).close()


async def test_listener_reports_a_declined_sign_in():
    cb = LoopbackCallback()
    uri = await cb.start()
    waiter = asyncio.create_task(cb.wait(5))
    await asyncio.to_thread(_get, f"{uri}?error=access_denied&state=s")
    with pytest.raises(OAuthError, match="declined"):
        await waiter


async def test_listener_survives_a_malformed_request_line():
    cb = LoopbackCallback()
    uri = await cb.start()
    port = urlparse(uri).port
    waiter = asyncio.create_task(cb.wait(5))

    def bad() -> bytes:
        with socket.create_connection(("127.0.0.1", port), timeout=2) as s:
            s.sendall(b"GET http://[x/ HTTP/1.1\r\n\r\n")
            s.settimeout(2)
            return s.recv(100)

    # answered like any unknown path, not dropped with an unhandled error in the loop
    assert (await asyncio.to_thread(bad)).startswith(b"HTTP/1.1 404")
    await asyncio.to_thread(_get, f"{uri}?code=abc&state=s")  # still serving afterwards
    assert await waiter == ("abc", "s")


async def test_token_file_is_never_written_world_readable_first(tmp_path, monkeypatch):
    import os

    modes: list[int] = []
    real_open = os.open

    def spy(path, flags, mode=0o777, **kw):
        modes.append(mode)
        return real_open(path, flags, mode, **kw)

    monkeypatch.setattr(os, "open", spy)
    await FileTokenStorage(tmp_path, "notes").set_tokens(TOKEN)
    assert modes == [0o600]


# ---- the URL guard ----


def _provider(opened):
    row = AppRow("notes", "Notes", "http", {"url": "https://x.example/mcp"}, "oauth", True)

    async def open_url(url):
        opened.append(url)

    async def wait():
        return ("c", "s")

    storage = FileTokenStorage(Path("."), "notes")
    return make_provider(row, storage, "http://127.0.0.1:1/callback", open_url, wait)


async def test_http_url_to_another_host_is_refused():
    opened: list[str] = []
    provider = _provider(opened)
    with pytest.raises(OAuthError) as err:
        await provider.context.redirect_handler("http://evil.example/authorize")
    assert str(err.value) == "The sign-in address was not https, so it was not opened."
    assert opened == []


async def test_https_and_loopback_http_are_opened():
    opened: list[str] = []
    provider = _provider(opened)
    await provider.context.redirect_handler("https://auth.example/authorize")
    await provider.context.redirect_handler("http://127.0.0.1:9/authorize")
    assert len(opened) == 2


def test_provider_registers_as_tagalong_with_the_loopback_redirect():
    meta = _provider([]).context.client_metadata
    assert meta.client_name == "Tagalong"
    assert [str(u) for u in meta.redirect_uris] == ["http://127.0.0.1:1/callback"]


# ---- end to end against the fake server ----


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _wait_port(port: int) -> None:
    deadline = time.monotonic() + 20
    while True:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=1).close()
            return
        except OSError:
            if time.monotonic() > deadline:
                raise
            await asyncio.sleep(0.1)


@pytest.fixture
async def oauth_server():
    port = _free_port()
    proc = subprocess.Popen([sys.executable, FAKE_OAUTH, str(port)])
    try:
        await _wait_port(port)
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        proc.kill()
        proc.wait()


class Rig:
    def __init__(self, data_dir, url, signin_timeout=15):
        self.memory = Memory(":memory:")
        self.memory.add_app(AppRow("notes", "Notes", "http", {"url": url}, "oauth", True))
        self.data = data_dir
        self.url = url
        self.apps = Apps(
            self.memory,
            lambda m, p: None,
            {},
            connect_timeout=15,
            signin_timeout=signin_timeout,
            data_dir=data_dir,
        )

    async def state(self, want, timeout=15.0):
        deadline = time.monotonic() + timeout
        while self.apps.status("notes").state != want:
            assert time.monotonic() < deadline, self.apps.status("notes")
            await asyncio.sleep(0.05)


@pytest.fixture
async def rig(tmp_path, oauth_server):
    r = Rig(tmp_path, oauth_server)
    yield r
    await r.apps.shutdown()


async def _browser(url: str) -> None:
    """Stands in for the user's browser: follow authorize, which redirects to the listener."""
    await asyncio.to_thread(_get, url)


async def test_no_tokens_means_needs_sign_in_and_no_browser(rig):
    await rig.apps.start()
    await rig.state("needs-sign-in")


async def test_sign_in_saves_tokens_and_connects(rig):
    opened: list[str] = []

    async def open_url(url):
        opened.append(url)
        await _browser(url)

    await rig.apps.start()
    await rig.state("needs-sign-in")
    await rig.apps.sign_in("notes", open_url)
    assert rig.apps.status("notes").state == "connecting"  # returns at once
    await rig.state("connected")
    assert len(opened) == 1
    assert parse_qs(urlparse(opened[0]).query)["code_challenge_method"] == ["S256"]
    saved = await FileTokenStorage(rig.data, "notes").get_tokens()
    assert saved and saved.access_token == "good-token"
    assert len(rig.apps.tools("notes")) == 6


async def test_saved_tokens_connect_after_restart_without_a_browser(rig):
    await rig.apps.sign_in("notes", _browser)
    await rig.state("connected")
    await rig.apps.shutdown()

    again = Rig(rig.data, rig.url)
    await again.apps.start()
    try:
        await again.state("connected")
    finally:
        await again.apps.shutdown()


async def test_expired_token_is_refreshed_on_start(rig):
    store = FileTokenStorage(rig.data, "notes")
    await store.set_client_info(CLIENT)
    await store.set_tokens(
        OAuthToken(access_token="old", token_type="Bearer", refresh_token="r1", expires_in=60)
    )
    path = rig.data / "app-oauth" / "notes.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["saved_at"] = time.time() - 3600
    path.write_text(json.dumps(data), encoding="utf-8")
    await rig.apps.start()
    await rig.state("connected")
    saved = await store.get_tokens()
    assert saved and saved.access_token == "refreshed-token"


async def test_refused_token_needs_sign_in_not_a_crash(rig):
    store = FileTokenStorage(rig.data, "notes")
    await store.set_client_info(CLIENT)
    await store.set_tokens(
        OAuthToken(access_token="stale", token_type="Bearer", refresh_token="bad", expires_in=3600)
    )
    await rig.apps.start()
    await rig.state("needs-sign-in")


async def test_expired_token_with_refused_refresh_needs_sign_in(rig):
    store = FileTokenStorage(rig.data, "notes")
    await store.set_client_info(CLIENT)
    await store.set_tokens(
        OAuthToken(access_token="old", token_type="Bearer", refresh_token="bad", expires_in=60)
    )
    path = rig.data / "app-oauth" / "notes.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["saved_at"] = time.time() - 3600
    path.write_text(json.dumps(data), encoding="utf-8")
    await rig.apps.start()
    await rig.state("needs-sign-in")


async def test_state_mismatch_is_rejected(rig):
    async def open_url(url):
        redirect = parse_qs(urlparse(url).query)["redirect_uri"][0]
        await asyncio.to_thread(_get, f"{redirect}?code=fake-code&state=wrong")

    await rig.apps.sign_in("notes", open_url)
    await rig.state("needs-sign-in")
    assert await FileTokenStorage(rig.data, "notes").get_tokens() is None
    assert "wrong" not in rig.apps.status("notes").error


async def test_abandoned_sign_in_ends_needs_sign_in(tmp_path, oauth_server):
    r = Rig(tmp_path, oauth_server, signin_timeout=0.5)
    try:

        async def open_url(url):
            pass  # the user never finishes

        await r.apps.sign_in("notes", open_url)
        await r.state("needs-sign-in")
        # the listener's own wording, not the outer connect timeout's
        assert "not finished" in r.apps.status("notes").error
    finally:
        await r.apps.shutdown()


async def test_a_refused_address_ends_needs_sign_in_with_its_reason(rig):
    async def refusing(url):
        raise OAuthError("The sign-in address was not https, so it was not opened.")

    await rig.apps.sign_in("notes", refusing)
    await rig.state("needs-sign-in")
    assert "not https" in rig.apps.status("notes").error


async def test_removing_an_app_clears_its_oauth_file(rig):
    await FileTokenStorage(rig.data, "notes").set_tokens(TOKEN)
    path = rig.data / "app-oauth" / "notes.json"
    assert path.exists()
    rig.memory.remove_app("notes")
    with pytest.raises(Exception, match="no app"):
        await rig.apps.restart("notes")
    assert not path.exists()


async def test_sign_in_refuses_an_app_without_oauth(tmp_path):
    memory = Memory(":memory:")
    memory.add_app(
        AppRow("plain", "Plain", "http", {"url": "http://127.0.0.1:1/mcp"}, "none", True)
    )
    apps = Apps(memory, lambda m, p: None, {}, data_dir=tmp_path)

    async def never(url):
        raise AssertionError("no browser")

    with pytest.raises(Exception, match="does not use sign-in"):
        await apps.sign_in("plain", never)


async def _revoke(url: str) -> None:
    base = url.removesuffix("/mcp")
    await asyncio.to_thread(
        urllib.request.urlopen, urllib.request.Request(f"{base}/revoke", method="POST")
    )


async def test_a_401_mid_session_flips_to_needs_sign_in_without_a_browser(rig):
    opened: list[str] = []

    async def open_url(url):
        opened.append(url)
        await _browser(url)

    await rig.apps.sign_in("notes", open_url)
    await rig.state("connected")
    await _revoke(rig.url)
    with pytest.raises(AppError, match="Sign in to Notes again"):
        await rig.apps.call("notes", "echo", {"text": "hi"})
    await rig.state("needs-sign-in")
    assert len(opened) == 1  # the browser is never opened without the user asking


async def test_a_dropped_signed_in_connection_is_an_error_not_a_sign_in_failure(rig):
    await rig.apps.sign_in("notes", _browser)
    await rig.state("connected")
    slot = rig.apps._slots["notes"]
    assert slot.open_url is None  # the sign-in is over once connected
    rig.apps._drop(slot)  # as a closed connection would
    await rig.state("error")
    assert "closed" in rig.apps.status("notes").error


async def test_token_expiring_mid_session_is_refreshed(rig):
    store = FileTokenStorage(rig.data, "notes")
    await store.set_client_info(CLIENT)
    await store.set_tokens(
        OAuthToken(access_token="good-token", token_type="Bearer", refresh_token="r1", expires_in=3)
    )
    path = rig.data / "app-oauth" / "notes.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["saved_at"] = time.time() - 1  # two seconds of life left
    path.write_text(json.dumps(data), encoding="utf-8")
    expiry = data["saved_at"] + 3
    await rig.apps.start()
    await rig.state("connected")
    while time.time() < expiry + 0.2:
        await asyncio.sleep(0.1)
    result = await rig.apps.call("notes", "echo", {"text": "after"})
    assert result.content[0].text == "after"
    assert rig.apps.status("notes").state == "connected"
    saved = await store.get_tokens()
    assert saved and saved.access_token == "refreshed-token"
