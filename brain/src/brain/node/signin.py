"""Sign in to an OAuth app on this machine: the browser opens here, the loopback listener catches
the redirect here, and the token is saved under the node's folder, never sent to the brain.
`stored_auth` is what the relay uses afterwards; it never opens a browser.
"""

import asyncio
import webbrowser
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

from brain.app_oauth import LoopbackCallback, NeedsSignIn, make_provider
from brain.apps import AppRow
from brain.node.allowlist import oauth_storage


def _row(url: str) -> AppRow:
    return AppRow("node", url, "http", {"url": url}, "oauth", True)


async def sign_in(
    url: str,
    node_dir: Path,
    open_url: Callable[[str], Awaitable[None]],
    timeout: float = 300,
) -> None:
    storage = oauth_storage(node_dir, url)
    storage.clear()  # a fresh sign-in registers a client for this run's port
    listener = LoopbackCallback()
    redirect_uri = await listener.start()
    try:
        auth = make_provider(
            _row(url), storage, redirect_uri, open_url, lambda: listener.wait(timeout)
        )
        async with (
            create_mcp_http_client(auth=auth) as client,
            streamable_http_client(url, http_client=client) as (read, write),
            ClientSession(read, write) as session,
        ):
            await session.initialize()
    finally:
        listener.close()


async def _no_browser(_: str) -> None:
    raise NeedsSignIn("Sign in again with `tagalong node signin`.")


async def _no_code() -> tuple[str, str, str | None]:
    raise NeedsSignIn("Sign in again with `tagalong node signin`.")


def stored_auth(url: str, node_dir: Path) -> httpx2.Auth | None:
    storage = oauth_storage(node_dir, url)
    if not storage.token_strings():
        return None
    return make_provider(_row(url), storage, "http://127.0.0.1/callback", _no_browser, _no_code)


async def browser_sign_in(url: str, node_dir: Path) -> None:
    await sign_in(url, node_dir, lambda target: asyncio.to_thread(webbrowser.open, target))
