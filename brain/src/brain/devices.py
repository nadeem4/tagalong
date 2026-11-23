"""Paired devices: a token is shown once and only its SHA-256 is kept, so a copied database
cannot be used to connect. Revoking tells the listener, which drops the live connection."""

import hashlib
import secrets
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass

from brain.auth import Principal
from brain.store import devices as store


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


@dataclass(frozen=True)
class McpClient:
    id: str
    name: str
    personal: bool  # may read the facts the owner keeps back


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

    def create(self, name: str, kind: str, personal: bool = False) -> tuple[str, str]:
        device_id = secrets.token_hex(8)
        token = secrets.token_urlsafe(32)
        store.insert_device(
            self._db,
            id=device_id,
            name=name,
            kind=kind,
            token_hash=hash_secret(token),
            now=self._now(),
            personal=personal,
        )
        return device_id, token

    def client(self, token: str) -> McpClient | None:
        row = store.client_by_token_hash(self._db, hash_secret(token))
        if row is None:
            return None
        store.touch_device(self._db, row[0], self._now())
        return McpClient(*row)

    def verify(self, token: str) -> Principal | None:
        row = store.device_by_token_hash(self._db, hash_secret(token))
        if row is None:
            return None
        device_id, name, kind = row
        store.touch_device(self._db, device_id, self._now())
        return Principal(
            key=f"device:{device_id}", name=name, kind=kind, local=False, device_id=device_id
        )

    def list(self) -> list[dict]:
        return store.list_devices(self._db)

    def rename(self, device_id: str, name: str) -> bool:
        name = name.strip()
        return bool(name) and store.rename_device(self._db, device_id, name)

    def revoke(self, device_id: str) -> bool:
        revoked = store.revoke_device(self._db, device_id, self._now())
        if revoked:
            self._on_revoke(device_id)
        return revoked
