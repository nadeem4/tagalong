"""One-time pairing codes. A code lives ten minutes, works once, and only its hash is stored.

Rate limit: five failed redeems in a minute lock every redeem (right code included) for the
rest of that minute; it is global because a stranger's attempts have no identity to count.
The browser add-on cannot pin a certificate, so it pairs over loopback with a short code
that is accepted nowhere else; every other kind pairs only from off the machine.
"""

import io
import secrets
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import quote, urlencode

import segno

from brain.devices import Devices, hash_secret
from brain.discovery import lan_address
from brain.identity import Identity
from brain.store import devices as store
from brain.store.db import utc_now_text, utc_text

CODE_LIFE = timedelta(minutes=10)
FAILURE_WINDOW = timedelta(minutes=1)
MAX_FAILURES = 5
PAIR_KINDS = ("desktop", "node", "browser")
LOOPBACK_KINDS = frozenset({"browser"})
NETWORK_KINDS = frozenset(PAIR_KINDS) - LOOPBACK_KINDS


@dataclass(frozen=True)
class PairOffer:
    link: str
    secret: str
    expires_at: str


def render_qr(link: str) -> str:
    buffer = io.StringIO()
    segno.make(link, error="m").terminal(out=buffer, compact=True)
    return buffer.getvalue()


class Pairing:
    def __init__(
        self,
        db: sqlite3.Connection,
        devices: Devices,
        identity: Identity,
        now: Callable[[], str],
        addr: Callable[[], str],
    ) -> None:
        self._db = db
        self._devices = devices
        self._identity = identity
        self._now = now
        self._addr = addr

    def make_code(self, kind: str = "desktop") -> PairOffer:
        now = self._now()
        store.delete_expired_codes(self._db, now)
        secret = (
            f"{secrets.randbelow(10**6):06d}" if kind == "browser" else secrets.token_urlsafe(24)
        )
        expires_at = utc_text(datetime.fromisoformat(now) + CODE_LIFE)
        store.insert_pair_code(
            self._db,
            id=secrets.token_hex(8),
            secret_hash=hash_secret(secret),
            kind=kind,
            expires_at=expires_at,
        )
        query = urlencode(
            {"addr": self._addr(), "fp": self._identity.fingerprint, "code": secret},
            safe=":",
            quote_via=quote,
        )
        return PairOffer(f"tagalong://pair?{query}", secret, expires_at)

    def redeem(
        self, code: str, name: str, kind: str, *, kinds: frozenset[str]
    ) -> tuple[str, str] | None:
        """`kinds` is what the listener the device came in on may pair."""
        now = self._now()
        since = utc_text(datetime.fromisoformat(now) - FAILURE_WINDOW)
        store.delete_old_failures(self._db, since)
        if store.count_recent_failures(self._db, since) >= MAX_FAILURES:
            return None
        if kind in kinds and store.redeem_pair_code(self._db, hash_secret(code), kind, now):
            return self._devices.create(name, kind)
        store.record_failure(self._db, now)
        return None


def build_pairing(
    db: sqlite3.Connection,
    identity: Identity,
    public_host: str | None,
    port: int,
    host_addr: Callable[[], str] = lan_address,
    on_revoke: Callable[[str], None] = lambda _id: None,
) -> tuple[Devices, Pairing]:
    devices = Devices(db, utc_now_text, on_revoke)

    def address() -> str:
        return f"{public_host or host_addr()}:{port}"

    return devices, Pairing(db, devices, identity, utc_now_text, address)
