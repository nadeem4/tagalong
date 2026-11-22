"""Pair codes redeem once and expire; a revoked device's token stops matching."""

from brain.store.db import open_db
from brain.store.devices import (
    device_by_token_hash,
    insert_device,
    insert_pair_code,
    redeem_pair_code,
    revoke_device,
)


def test_redeem_is_one_use(tmp_path):
    db = open_db(tmp_path / "t.db")
    insert_pair_code(db, id="c1", secret_hash="h", kind="desktop", expires_at="2999-01-01T00:00:00Z")
    assert redeem_pair_code(db, "h", "2026-11-21T00:00:00Z") is not None
    assert redeem_pair_code(db, "h", "2026-11-21T00:00:01Z") is None


def test_expired_code_is_refused(tmp_path):
    db = open_db(tmp_path / "t.db")
    insert_pair_code(db, id="c1", secret_hash="h", kind="desktop", expires_at="2026-11-21T00:00:00Z")
    assert redeem_pair_code(db, "h", "2026-11-21T00:10:01Z") is None


def test_revoked_device_is_not_found_by_token(tmp_path):
    db = open_db(tmp_path / "t.db")
    insert_device(db, id="d1", name="PC", kind="desktop", token_hash="th", now="2026-11-21T00:00:00Z")
    assert device_by_token_hash(db, "th") is not None
    revoke_device(db, "d1", "2026-11-21T01:00:00Z")
    assert device_by_token_hash(db, "th") is None
