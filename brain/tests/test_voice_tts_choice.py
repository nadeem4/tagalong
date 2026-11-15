"""Tests for the saved voice choice and the Home tools over it (tts_state, set_tts)."""

import json

import pytest

from brain.memory import Memory
from brain.protocol import ErrorCode, RpcError
from brain.voice import tts_choice
from brain.voice.tts import AUTO, auto_voice, load_voices
from brain.voice.tts_tools import tts_tools


@pytest.fixture
def rig(tmp_path):
    mem = Memory(":memory:")
    sent: list[tuple[str, dict]] = []
    picks: list[str] = []
    tools = tts_tools(
        mem.db,
        lambda m, p: sent.append((m, p)),
        picks.append,
        tmp_path,
        lambda: {"voice": "piper-alan", "status": "idle", "progress": 0.0},
    )
    by_name = {spec.name: (spec, handler) for spec, handler in tools}

    class Rig:
        db = mem.db
        folder = tmp_path
        specs = {n: s for n, (s, _h) in by_name.items()}

        async def run(self, name, args=None):
            return await by_name[name][1](args or {})

    r = Rig()
    r.sent, r.picks = sent, picks
    return r


def test_unset_choice_is_auto_and_resolves_to_alan():
    db = Memory(":memory:").db
    assert tts_choice.chosen(db) == AUTO
    assert tts_choice.resolved(db).id == "piper-alan" == auto_voice().id


def test_a_stale_stored_id_reads_as_auto():
    db = Memory(":memory:").db
    tts_choice.save(db, "gone")
    assert tts_choice.saved(db) is None
    assert tts_choice.chosen(db) == AUTO
    assert tts_choice.resolved(db).auto


def test_a_listed_choice_roundtrips():
    db = Memory(":memory:").db
    tts_choice.save(db, "kokoro-george")
    assert tts_choice.saved(db) == "kokoro-george"
    assert tts_choice.resolved(db).id == "kokoro-george"
    assert tts_choice.valid("auto") and tts_choice.valid("kokoro-george")
    assert not tts_choice.valid("nope")


async def test_set_tts_saves_notifies_and_calls_on_pick(rig):
    await rig.run("set_tts", {"voice": "kokoro-george"})
    assert tts_choice.chosen(rig.db) == "kokoro-george"
    assert rig.picks == ["kokoro-george"]
    assert rig.sent == [("changed", {"what": "tts"})]


async def test_set_tts_auto_picks_the_auto_voices_id(rig):
    await rig.run("set_tts", {"voice": "auto"})
    assert rig.picks == ["piper-alan"]


async def test_set_tts_refuses_an_unlisted_voice(rig):
    with pytest.raises(RpcError) as err:
        await rig.run("set_tts", {"voice": "nope"})
    assert err.value.code == ErrorCode.invalid_params
    assert rig.picks == [] and rig.sent == []


async def test_tts_state_lists_installed_flags(rig):
    alan = next(v for v in load_voices() if v.id == "piper-alan")
    for f in alan.files:  # files that do not match the pinned hash do not count
        (rig.folder / f.path).parent.mkdir(parents=True, exist_ok=True)
        (rig.folder / f.path).write_bytes(b"not the real model")
    state = json.loads(await rig.run("tts_state"))
    assert state["chosen"] == "auto" and state["resolved"] == "piper-alan"
    assert state["download"]["voice"] == "piper-alan"
    row = {v["id"]: v for v in state["voices"]}["piper-alan"]
    assert row["installed"] is False
    assert row["sample"] is False and row["licence"] and row["engine"] == "piper"
    assert set(row) == {
        "id",
        "label",
        "descriptor",
        "engine",
        "size_mb",
        "licence",
        "installed",
        "sample",
    }
    assert len(state["voices"]) == len(load_voices())
    assert rig.specs["tts_state"].effect == "read" and rig.specs["set_tts"].effect == "change"


async def test_tts_state_marks_a_verified_voice_installed(rig, monkeypatch):
    monkeypatch.setattr("brain.voice.tts_tools.present", lambda folder, files: True)
    state = json.loads(await rig.run("tts_state"))
    assert all(v["installed"] for v in state["voices"])
