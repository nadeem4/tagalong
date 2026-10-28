"""OAuth sign-in for connected apps: where the SDK's tokens and client registration are kept.

One small file per app under `data_dir/app-oauth/`, so removing an app (or signing out) deletes
exactly its secrets. Nothing here logs token text; a bad file is treated as signed out.
"""

import json
import os
from pathlib import Path
from typing import Any

from mcp.shared.auth import OAuthClientInformationFull, OAuthToken


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
        try:
            return OAuthToken.model_validate(self._read()["tokens"])
        except (KeyError, ValueError):
            return None

    async def set_tokens(self, tokens: OAuthToken) -> None:
        self._write({**self._read(), "tokens": tokens.model_dump(mode="json", exclude_none=True)})

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
