"""Checks the Home tools for bodies and WhatsApp setup: bodies_status, whatsapp_status,
whatsapp_set.

Fakes only: a fake supervisor records apply(), a fake Bodies lists who is online. The fake
secrets must never appear in any reply or error.
"""

import json

import pytest

from brain.bodies_tools import bodies_tools
from brain.protocol import Body, ErrorCode, RpcError

TOKEN = "EAAG-fake-access-token-value"
SECRET = "fake-app-secret-value"
VERIFY = "fake-verify-token-value"
SECRETS = (TOKEN, SECRET, VERIFY)


class FakeBodies:
    def __init__(self, *kinds):
        self._kinds = kinds

    def online(self):
        return [Body(id=f"{k}-1", kind=k, name=f"{k} body") for k in self._kinds]


class FakeBridges:
    def __init__(self, env):
        self.env = env
        self.applied = []
        self.state = "off"

    async def apply(self):
        self.applied.append(dict(self.env))


class Rig:
    def __init__(self, data_dir, kinds=("desktop",), with_bridges=True):
        self.env = {}
        self.bridges = FakeBridges(self.env)
        self.notes = []
        self.data_dir = data_dir
        pairs = bodies_tools(
            FakeBodies(*kinds),
            (lambda: self.bridges) if with_bridges else (lambda: None),
            data_dir,
            self.env,
            lambda m, p: self.notes.append((m, p)),
        )
        self.handlers = {s.name: h for s, h in pairs}
        self.specs = {s.name: s for s, _ in pairs}

    def run(self, name, args=None):
        return self.handlers[name](args if args is not None else {})


@pytest.fixture
def rig(tmp_path):
    return Rig(tmp_path)


FULL = {
    "access_token": TOKEN,
    "app_secret": SECRET,
    "verify_token": VERIFY,
    "phone_number_id": "1234567890",
    "allowed_number": "+44 7700-900123",
}


async def test_bodies_status_lists_all_three_kinds(tmp_path):
    r = Rig(tmp_path, kinds=("desktop", "whatsapp"))
    out = json.loads(await r.run("bodies_status"))
    assert [(b["kind"], b["connected"]) for b in out["bodies"]] == [
        ("desktop", True),
        ("browser", False),
        ("whatsapp", True),
    ]
    assert all(isinstance(b["name"], str) and b["name"] for b in out["bodies"])


async def test_status_never_returns_a_secret(rig):
    set_text = await rig.run("whatsapp_set", {**FULL, "enabled": True})
    text = await rig.run("whatsapp_status")
    for reply in (text, set_text):
        for value in (*SECRETS, "1234567890", "7700"):
            assert value not in reply
    out = json.loads(text)
    assert out["set"] == dict.fromkeys(FULL, True)
    assert out["complete"] is True and out["enabled"] is True and out["port"] == 47322


async def test_set_saves_to_env_and_the_running_environment(rig):
    await rig.run("whatsapp_set", {**FULL, "enabled": True, "port": 50000})
    saved = (rig.data_dir / ".env").read_text()
    assert f"TAGALONG_WHATSAPP_ACCESS_TOKEN={TOKEN}" in saved
    assert "TAGALONG_WHATSAPP_ENABLED=1" in saved
    assert "TAGALONG_WHATSAPP_PORT=50000" in saved
    assert "TAGALONG_WHATSAPP_ALLOWED_NUMBER=447700900123" in saved  # digits only
    assert rig.env["TAGALONG_WHATSAPP_APP_SECRET"] == SECRET
    assert rig.env["TAGALONG_WHATSAPP_ENABLED"] == "1"


async def test_absent_keys_are_unchanged(rig):
    await rig.run("whatsapp_set", FULL)
    await rig.run("whatsapp_set", {"verify_token": "newer-verify"})
    assert rig.env["TAGALONG_WHATSAPP_ACCESS_TOKEN"] == TOKEN
    assert rig.env["TAGALONG_WHATSAPP_VERIFY_TOKEN"] == "newer-verify"


async def test_set_applies_the_bridge_and_notifies(rig):
    await rig.run("whatsapp_set", {"enabled": True})
    assert len(rig.bridges.applied) == 1
    assert rig.notes == [("changed", {"what": "bodies"})]
    assert rig.bridges.applied[0]["TAGALONG_WHATSAPP_ENABLED"] == "1"  # saved before apply


async def test_set_before_the_bridge_exists_still_saves(tmp_path):
    r = Rig(tmp_path, with_bridges=False)
    out = json.loads(await r.run("whatsapp_set", {"enabled": True}))
    assert out["enabled"] is True and r.notes


async def test_bad_number_or_port_is_refused_without_quoting_it(rig):
    for args in (
        {"allowed_number": "not-a-number-xyz"},
        {"allowed_number": "+++"},
        {"port": 80},
        {"port": 70000},
        {"port": "47322"},
        {"port": True},
        {"enabled": "yes"},
        {"access_token": 5},
    ):
        with pytest.raises(RpcError) as err:
            await rig.run("whatsapp_set", args)
        assert err.value.code == ErrorCode.invalid_params
        assert "xyz" not in err.value.message and "47322" not in err.value.message
    assert rig.bridges.applied == [] and not (rig.data_dir / ".env").exists()


async def test_a_failed_write_says_where_and_applies_nothing(tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")  # a file where the data folder should be: the write fails
    r = Rig(blocker)
    with pytest.raises(RpcError) as err:
        await r.run("whatsapp_set", {"access_token": TOKEN})
    assert err.value.code == ErrorCode.tool_failed
    assert str(blocker / ".env") in err.value.message and TOKEN not in err.value.message
    assert r.bridges.applied == [] and r.notes == []
    assert "TAGALONG_WHATSAPP_ACCESS_TOKEN" not in r.env


async def test_switching_off_stops_the_bridge(rig):
    await rig.run("whatsapp_set", {**FULL, "enabled": True})
    await rig.run("whatsapp_set", {"enabled": False})
    assert rig.bridges.applied[-1]["TAGALONG_WHATSAPP_ENABLED"] == "0"


async def test_tools_are_home_only(rig):
    assert set(rig.specs) == {"bodies_status", "whatsapp_status", "whatsapp_set"}
    assert all(s.audience == frozenset({"home"}) for s in rig.specs.values())
    assert rig.specs["whatsapp_set"].effect == "change"
    assert rig.specs["bodies_status"].effect == "read"
