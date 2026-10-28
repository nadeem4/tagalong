"""Tests for the OAuth pieces of connected apps: token storage in the data dir.

The SDK drives sign-in; these check that what it hands us is saved, reloaded and cleared
safely, and that token text never reaches the logs.
"""

import logging

from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from brain.app_oauth import FileTokenStorage

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


async def test_token_text_is_never_logged(tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    store = FileTokenStorage(tmp_path, "notes")
    await store.set_tokens(TOKEN)
    await store.set_client_info(CLIENT)
    (tmp_path / "app-oauth" / "notes.json").write_text("{bad", encoding="utf-8")
    await store.get_tokens()
    assert "secret" not in caplog.text
