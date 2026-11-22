"""Device tokens: shown once, kept only as hashes, and dead the moment the device is revoked."""

import pytest

from brain.auth import Principal
from brain.devices import Devices
from brain.store.db import open_db

NOW = "2026-11-21T00:00:00Z"


@pytest.fixture
def db(tmp_path):
    return open_db(tmp_path / "t.db")


def test_create_returns_a_token_that_is_not_stored(db):
    device_id, token = Devices(db, lambda: NOW).create("Laptop", "desktop")
    assert len(token) == 43
    stored = db.execute("SELECT token_hash FROM devices WHERE id=?", (device_id,)).fetchone()[0]
    assert stored != token and token not in stored


def test_verify_gives_a_device_principal_and_notes_last_seen(db):
    devices = Devices(db, lambda: NOW)
    device_id, token = devices.create("Laptop", "node")
    assert devices.verify(token) == Principal(
        key=f"device:{device_id}", name="Laptop", kind="node", local=False, device_id=device_id
    )
    assert devices.list()[0]["last_seen"] == NOW
    assert devices.verify("nope") is None


def test_revoke_kills_the_token_and_tells_the_listener(db):
    revoked = []
    devices = Devices(db, lambda: NOW, on_revoke=revoked.append)
    device_id, token = devices.create("Laptop", "desktop")
    assert devices.revoke(device_id) is True
    assert devices.verify(token) is None
    assert revoked == [device_id]
    assert devices.revoke(device_id) is False and revoked == [device_id]


def test_list_never_shows_the_hash(db):
    devices = Devices(db, lambda: NOW)
    devices.create("Laptop", "desktop")
    row = devices.list()[0]
    assert set(row) == {"id", "name", "kind", "paired_at", "last_seen", "revoked_at"}


def test_rename_trims_and_refuses_an_empty_name(db):
    devices = Devices(db, lambda: NOW)
    device_id, _ = devices.create("Laptop", "desktop")
    assert devices.rename(device_id, "  Desk PC ") is True
    assert devices.list()[0]["name"] == "Desk PC"
    assert devices.rename(device_id, "   ") is False
    assert devices.list()[0]["name"] == "Desk PC"
