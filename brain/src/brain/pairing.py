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
OFFERED_KINDS = ("desktop", "node", "browser")  # what `tagalong pair` and Home's Pair offer
# Said when a pairing code is asked for while the brain listens only on this PC; the RPC and the
# CLI add how to turn it on.
NETWORK_OFF = "Network access is off, so no other device can reach this brain."
LOOPBACK_KINDS = frozenset({"browser"})  # the kinds a code may carry on the loopback listener
NETWORK_KINDS = frozenset({"desktop", "node", "mcp_client"})  # and on the network listener


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

    def make_code(self, kind: str = "desktop", personal: bool = False, name: str = "") -> PairOffer:
        now = self._now()
        store.delete_expired_codes(self._db, now)
        if name:
            store.delete_unused_codes(self._db, kind, name)
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
            personal=personal,
            name=name,
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
        """`kinds` is what the listener the device came in on may pair. A name given when the code
        was made wins over the one the device offers."""
        now = self._now()
        since = utc_text(datetime.fromisoformat(now) - FAILURE_WINDOW)
        store.delete_old_failures(self._db, since)
        if store.count_recent_failures(self._db, since) >= MAX_FAILURES:
            return None
        spent = (
            store.redeem_pair_code(self._db, hash_secret(code), kind, now)
            if kind in kinds
            else None
        )
        if spent is not None:
            personal, given = spent
            return self._devices.create(given or name, kind, personal=personal)
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
