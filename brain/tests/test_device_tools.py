"""Home's device tools: list, rename, revoke and make a pairing code. Home only, never the model."""

import json

import pytest

from brain.device_tools import device_tools
from brain.devices import Devices
from brain.identity import load_or_create_identity
from brain.pairing import Pairing
from brain.protocol import RpcError
from brain.store.db import open_db

NOW = "2026-11-21T00:00:00Z"


class Rig:
    def __init__(self, tmp_path, network=True):
        db = open_db(tmp_path / "t.db")
        self.devices = Devices(db, lambda: NOW)
        self.pairing = Pairing(
            db, self.devices, load_or_create_identity(tmp_path), lambda: NOW, lambda: "h:1"
        )
        pairs = device_tools(self.devices, self.pairing, network=network)
        self.specs = {s.name: s for s, _ in pairs}
        self.handlers = {s.name: h for s, h in pairs}

    async def run(self, name, args=None):
        return json.loads(await self.handlers[name](args or {}))


@pytest.fixture
def rig(tmp_path):
    return Rig(tmp_path)


async def test_list_shows_devices_without_any_token(rig):
    _, token = rig.devices.create("Laptop", "desktop")
    reply = await rig.run("devices_list")
    assert [d["name"] for d in reply["devices"]] == ["Laptop"]
    keys = {"id", "name", "kind", "paired_at", "last_seen", "revoked_at"}
    assert set(reply["devices"][0]) == keys
    assert token not in json.dumps(reply)


async def test_revoking_an_unknown_device_says_so(rig):
    with pytest.raises(RpcError):
        await rig.run("device_revoke", {"id": "nope"})


async def test_pair_make_refuses_a_remote_device_kind_when_the_network_is_off(tmp_path):
    rig = Rig(tmp_path, network=False)
    with pytest.raises(RpcError):
        await rig.run("pair_make", {"kind": "desktop"})
    assert (await rig.run("pair_make", {"kind": "browser"}))["qr"]


async def test_the_model_never_gets_these_tools(rig):
    assert all(s.audience == frozenset({"home"}) for s in rig.specs.values())
