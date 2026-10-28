"""OAuth sign-in for connected apps: token storage, the loopback listener and the SDK provider.

One small file per app under `data_dir/app-oauth/`, so removing an app (or signing out) deletes
exactly its secrets. Nothing here logs token text; a bad file is treated as signed out. The
listener catches the browser's one redirect on 127.0.0.1 and then closes, so no port stays open.
"""

import asyncio
import json
import os
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlparse

from mcp.client.auth import OAuthClientProvider
from mcp.shared.auth import (
    AuthorizationCodeResult,
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthToken,
)

if TYPE_CHECKING:
    from brain.apps import AppRow

_LOOPBACK = {"127.0.0.1", "localhost", "::1"}
_PAGE = (
    b"<!doctype html><meta charset=utf-8><title>Tagalong</title>"
    b"<p>You can close this tab and go back to Tagalong.</p>"
)


class OAuthError(Exception):
    """A sign-in problem as one plain line; never contains token text."""


class NeedsSignIn(OAuthError):
    """The app has no usable sign-in and nobody asked for one, so no browser is opened."""


class FileTokenStorage:
    """The SDK's `TokenStorage` over `data_dir/app-oauth/<app_id>.json`, owner-only if honoured."""

    def __init__(self, data_dir: Path | str, app_id: str) -> None:
        self._path = Path(data_dir) / "app-oauth" / f"{app_id}.json"

    def _read(self) -> dict[str, Any]:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write(self, data: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, self._path)

    async def get_tokens(self) -> OAuthToken | None:
        data = self._read()
        try:
            tokens = OAuthToken.model_validate(data["tokens"])
        except (KeyError, ValueError):
            return None
        saved_at = data.get("saved_at")
        if tokens.expires_in and isinstance(saved_at, int | float):
            if time.time() > saved_at + tokens.expires_in:
                # The SDK only knows relative expiry. An empty access token makes it refresh
                # first instead of sending a token that is certain to be refused.
                return tokens.model_copy(update={"access_token": ""})
        return tokens

    async def set_tokens(self, tokens: OAuthToken) -> None:
        self._write(
            {
                **self._read(),
                "tokens": tokens.model_dump(mode="json", exclude_none=True),
                "saved_at": time.time(),
            }
        )

    async def get_client_info(self) -> OAuthClientInformationFull | None:
        try:
            return OAuthClientInformationFull.model_validate(self._read()["client_info"])
        except (KeyError, ValueError):
            return None

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        self._write(
            {**self._read(), "client_info": client_info.model_dump(mode="json", exclude_none=True)}
        )

    def clear(self) -> None:
        self._path.unlink(missing_ok=True)


class LoopbackCallback:
    """Catches the browser's redirect on 127.0.0.1 (random port) and closes after one callback."""

    def __init__(self) -> None:
        self._server: asyncio.Server | None = None
        self._done: asyncio.Future[tuple[str, str]] | None = None

    async def start(self) -> str:
        self._done = asyncio.get_running_loop().create_future()
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        port = self._server.sockets[0].getsockname()[1]
        return f"http://127.0.0.1:{port}/callback"

    async def wait(self, timeout: float = 300) -> tuple[str, str]:
        assert self._done is not None, "start() first"
        try:
            async with asyncio.timeout(timeout):
                return await self._done
        except TimeoutError:
            raise OAuthError("The sign-in was not finished in time.") from None
        finally:
            self.close()

    def close(self) -> None:
        if self._server is not None:
            self._server.close()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            line = await asyncio.wait_for(reader.readline(), 5)
            parts = line.decode("latin-1").split(" ")
            url = urlparse(parts[1]) if len(parts) >= 2 else urlparse("")
            known = url.path == "/callback"
            status, body = (b"200 OK", _PAGE) if known else (b"404 Not Found", b"")
            writer.write(
                b"HTTP/1.1 " + status + b"\r\nContent-Type: text/html\r\nConnection: close\r\n"
                b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
            )
            await writer.drain()
            if known:
                self.close()  # one callback only; a second visitor finds the port shut
                self._finish(parse_qs(url.query))
        except (OSError, TimeoutError):
            pass
        finally:
            writer.close()

    def _finish(self, query: dict[str, list[str]]) -> None:
        assert self._done is not None
        if self._done.done():
            return
        code, state = query.get("code", [""])[0], query.get("state", [""])[0]
        if "error" in query:
            self._done.set_exception(OAuthError("The sign-in was declined."))
        elif not code:
            self._done.set_exception(OAuthError("The sign-in sent back no code."))
        else:
            self._done.set_result((code, state))


def _may_open(url: str) -> bool:
    try:
        parts = urlparse(url)
        return parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in _LOOPBACK)
    except ValueError:
        return False


def make_provider(
    app: "AppRow",
    storage: FileTokenStorage,
    redirect_uri: str,
    open_url: Callable[[str], Awaitable[None]],
    wait: Callable[[], Awaitable[tuple[str, str]]],
) -> OAuthClientProvider:
    """The SDK's OAuth provider (PKCE, dynamic registration) with our guarded browser opener."""

    async def redirect_handler(url: str) -> None:
        if not _may_open(url):  # a hostile server could point the browser at anything
            raise OAuthError("The sign-in address was not https, so it was not opened.")
        await open_url(url)

    async def callback_handler() -> AuthorizationCodeResult:
        code, state = await wait()
        return AuthorizationCodeResult(code=code, state=state)

    meta = OAuthClientMetadata(
        client_name="Tagalong",
        redirect_uris=[redirect_uri],
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        token_endpoint_auth_method="none",
    )
    return OAuthClientProvider(app.config["url"], meta, storage, redirect_handler, callback_handler)
