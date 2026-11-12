"""When Scout may offer to get to know the owner: once ever run, never after a decline, and not
more than once a week. State is one settings row."""

from datetime import UTC, datetime, timedelta

import pytest

from brain.know import offer
from brain.know.offer import OfferState
from brain.memory import Memory

NOW = datetime(2026, 11, 12, 9, 0, tzinfo=UTC)


@pytest.fixture
def db(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m.db
    m.close()


def test_allowed_when_never_run_or_offered():
    assert offer.allowed(OfferState(), NOW) is True


def test_not_allowed_after_run():
    assert offer.allowed(OfferState(last_run_at=NOW.isoformat()), NOW) is False


def test_not_allowed_after_decline():
    assert offer.allowed(OfferState(declined=True), NOW) is False


def test_not_allowed_within_7_days_allowed_after():
    offered = NOW - timedelta(days=6, hours=23)
    assert offer.allowed(OfferState(offered_at=offered.isoformat()), NOW) is False
    offered = NOW - timedelta(days=7)
    assert offer.allowed(OfferState(offered_at=offered.isoformat()), NOW) is True


def test_state_roundtrips_through_settings(db):
    assert offer.load(db) == OfferState()
    offer.mark_offered(db, NOW)
    assert offer.load(db) == OfferState(offered_at=NOW.isoformat())
    offer.mark_declined(db)
    assert offer.load(db).declined is True
    offer.mark_ran(db, NOW)
    state = offer.load(db)
    assert state.last_run_at == NOW.isoformat() and state.declined is False


def test_broken_saved_value_reads_as_fresh(db):
    from brain.store.settings import set_setting

    set_setting(db, offer.KEY, "not json")
    assert offer.load(db) == OfferState()
