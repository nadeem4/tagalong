"""Paired devices: a token is shown once and only its SHA-256 is kept, so a copied database
cannot be used to connect. Revoking tells the listener, which drops the live connection."""

import hashlib
import secrets
import sqlite3
from collections.abc import Callable

from brain.auth import Principal
from brain.store import devices as store


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Devices:
    def __init__(
        self,
        db: sqlite3.Connection,
        now: Callable[[], str],
        on_revoke: Callable[[str], None] = lambda _id: None,
    ) -> None:
        self._db = db
        self._now = now
        self._on_revoke = on_revoke

    def create(self, name: str, kind: str) -> tuple[str, str]:
        device_id = secrets.token_hex(8)
        token = secrets.token_urlsafe(32)
        store.insert_device(
            self._db, id=device_id, name=name, kind=kind, token_hash=_hash(token), now=self._now()
        )
        return device_id, token

    def verify(self, token: str) -> Principal | None:
        row = store.device_by_token_hash(self._db, _hash(token))
        if row is None:
            return None
        device_id, name, kind = row
        store.touch_device(self._db, device_id, self._now())
        return Principal(
            key=f"device:{device_id}", name=name, kind=kind, local=False, device_id=device_id
        )

    def list(self) -> list[dict]:
        keys = [c.strip() for c in store.DEVICE_COLUMNS.split(",")]
        return [dict(zip(keys, row, strict=True)) for row in store.list_devices(self._db)]

    def rename(self, device_id: str, name: str) -> bool:
        name = name.strip()
        return bool(name) and store.rename_device(self._db, device_id, name)

    def revoke(self, device_id: str) -> bool:
        revoked = store.revoke_device(self._db, device_id, self._now())
        if revoked:
            self._on_revoke(device_id)
        return revoked
