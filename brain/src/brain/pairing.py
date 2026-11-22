"""One-time pairing codes. A code lives ten minutes, works once, and only its hash is stored.

Rate limit: five failed redeems in a minute lock every redeem (right code included) for the
rest of that minute; it is global because a stranger's attempts have no identity to count.
The browser add-on cannot pin a certificate, so it pairs over loopback with a short code
that is accepted nowhere else; every other kind pairs only from off the machine.
"""

import hashlib
import secrets
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlencode

from brain.devices import Devices
from brain.identity import Identity
from brain.store import devices as store

CODE_LIFE = timedelta(minutes=10)
FAILURE_WINDOW = timedelta(minutes=1)
MAX_FAILURES = 5
_TIME = "%Y-%m-%dT%H:%M:%SZ"


@dataclass(frozen=True)
class PairOffer:
    link: str
    secret: str
    expires_at: str


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


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
        expires_at = (datetime.strptime(now, _TIME) + CODE_LIFE).strftime(_TIME)
        store.insert_pair_code(
            self._db,
            id=secrets.token_hex(8),
            secret_hash=_hash(secret),
            kind=kind,
            expires_at=expires_at,
        )
        query = urlencode({"addr": self._addr(), "fp": self._identity.fingerprint, "code": secret})
        return PairOffer(f"tagalong://pair?{query}", secret, expires_at)

    def redeem(self, code: str, name: str, kind: str, *, loopback: bool) -> tuple[str, str] | None:
        now = self._now()
        since = (datetime.strptime(now, _TIME) - FAILURE_WINDOW).strftime(_TIME)
        if store.count_recent_failures(self._db, since) >= MAX_FAILURES:
            return None
        if loopback == (kind == "browser") and store.redeem_pair_code(
            self._db, _hash(code), kind, now
        ):
            return self._devices.create(name, kind)
        store.record_failure(self._db, now)
        return None
