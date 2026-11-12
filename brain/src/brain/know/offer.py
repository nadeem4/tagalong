"""Whether Scout may offer to read the owner's public profiles: rarely, and only if never run.

One settings row (`know_me_offer`, JSON). Code decides when an offer is allowed; Scout decides
the wording and whether the moment fits.
"""

import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from brain.store.settings import get_setting, set_setting

KEY = "know_me_offer"
WAIT = timedelta(days=7)


@dataclass
class OfferState:
    offered_at: str | None = None
    declined: bool = False
    last_run_at: str | None = None


def load(db: sqlite3.Connection) -> OfferState:
    raw = get_setting(db, KEY)
    try:
        data = json.loads(raw) if raw else {}
        return OfferState(
            offered_at=data.get("offered_at"),
            declined=bool(data.get("declined")),
            last_run_at=data.get("last_run_at"),
        )
    except (ValueError, AttributeError):
        return OfferState()  # a damaged row means "never offered", not a crash


def save(db: sqlite3.Connection, state: OfferState) -> None:
    set_setting(db, KEY, json.dumps(asdict(state)))


def allowed(state: OfferState, now: datetime) -> bool:
    if state.last_run_at is not None or state.declined:
        return False
    if not state.offered_at:
        return True
    try:
        return now - datetime.fromisoformat(state.offered_at) >= WAIT
    except ValueError:
        return True


def mark_offered(db: sqlite3.Connection, now: datetime) -> None:
    state = load(db)
    state.offered_at = now.isoformat()
    save(db, state)


def mark_declined(db: sqlite3.Connection) -> None:
    state = load(db)
    state.declined = True
    save(db, state)


def mark_ran(db: sqlite3.Connection, now: datetime) -> None:
    """A run counts however it started; the person asked, so a decline no longer applies."""
    state = load(db)
    state.last_run_at = now.isoformat()
    state.declined = False
    save(db, state)
