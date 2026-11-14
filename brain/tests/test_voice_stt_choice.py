"""Tests for the saved speech-model choice, the Home tools over it and the graphics card name."""

import json

import pytest

from brain.memory import Memory
from brain.protocol import ErrorCode, RpcError
from brain.voice import stt_choice
from brain.voice.stt_tools import stt_tools


@pytest.fixture
def rig():
    mem = Memory(":memory:")
    sent: list[tuple[str, dict]] = []
    reloads: list[int] = []
    tools = stt_tools(
        mem.db, (None, None), lambda m, p: sent.append((m, p)), lambda: reloads.append(1)
    )
    by_name = {spec.name: (spec, handler) for spec, handler in tools}

    class Rig:
        db = mem.db
        specs = {n: s for n, (s, _h) in by_name.items()}

        async def run(self, name, args=None):
            return await by_name[name][1](args or {})

    r = Rig()
    r.sent, r.reloads = sent, reloads
    return r


def test_saved_choice_roundtrip():
    db = Memory(":memory:").db
    assert stt_choice.chosen_live(db) == "auto" and stt_choice.chosen_final(db) == "auto"
    stt_choice.save_live(db, "moonshine-tiny")
    stt_choice.save_final(db, "off")
    assert stt_choice.chosen_live(db) == "moonshine-tiny"
    assert stt_choice.chosen_final(db) == "off"
    assert stt_choice.saved_live(db) == "moonshine-tiny"


def test_a_stale_saved_id_reads_as_auto_and_env_comes_before_auto():
    db = Memory(":memory:").db
    stt_choice.save_live(db, "gone-model")
    stt_choice.save_final(db, "same")  # dropped: it is no longer a choice
    assert stt_choice.saved_live(db) is None and stt_choice.saved_final(db) is None
    assert stt_choice.chosen_live(db, "moonshine-medium") == "moonshine-medium"
    assert stt_choice.chosen_live(db, "nonsense") == "auto"
    stt_choice.save_live(db, "auto")  # an explicit Auto beats the env default
    assert stt_choice.chosen_live(db, "moonshine-medium") == "auto"


async def test_stt_state_lists_the_rows_and_the_card(rig, monkeypatch):
    monkeypatch.setattr(stt_choice, "gpu_name", lambda: "NVIDIA GeForce RTX 4060")
    state = json.loads(await rig.run("stt_state"))
    assert state["live"] == "auto" and state["final"] == "auto"
    assert state["gpu_name"] == "NVIDIA GeForce RTX 4060"
    ids = {m["id"]: m for m in state["models"]}
    assert ids["moonshine-tiny"]["role"] == "live" and ids["moonshine-tiny"]["size_mb"] == 45
    assert ids["whisper-small-en"]["role"] == "final"
    assert set(ids["moonshine-tiny"]) == {
        "id", "label", "role", "size_mb", "gpu", "languages", "note",
    }  # fmt: skip


async def test_set_stt_saves_reloads_and_says_changed(rig):
    out = json.loads(await rig.run("set_stt", {"live": "moonshine-tiny", "final": "off"}))
    assert out == {"live": "moonshine-tiny", "final": "off"}
    assert ("changed", {"what": "stt"}) in rig.sent
    assert rig.reloads == [1]
    assert stt_choice.chosen_final(rig.db) == "off"


async def test_set_stt_rejects_final_only_model_as_live(rig):
    with pytest.raises(RpcError) as err:
        await rig.run("set_stt", {"live": "whisper-small-en"})
    assert err.value.code == ErrorCode.invalid_params
    assert rig.sent == [] and rig.reloads == []


@pytest.mark.parametrize(
    "bad",
    [{"live": "nope"}, {"final": "same"}, {"final": "moonshine-tiny"}, {}, {"live": 3}],
)
async def test_set_stt_rejects_unlisted_or_wrong_role_ids(rig, bad):
    with pytest.raises(RpcError) as err:
        await rig.run("set_stt", bad)
    assert err.value.code == ErrorCode.invalid_params
    assert stt_choice.saved_live(rig.db) is None and rig.sent == []


def test_set_stt_is_a_change_tool_home_only(rig):
    spec = rig.specs["set_stt"]
    assert spec.effect == "change" and set(spec.audience) == {"home"}
    assert rig.specs["stt_state"].effect == "read" and set(rig.specs["stt_state"].audience) == {
        "home"
    }


@pytest.fixture(autouse=True)
def _fresh_gpu_cache():
    stt_choice.gpu_name.cache_clear()
    yield
    stt_choice.gpu_name.cache_clear()


def test_gpu_name_is_the_first_line_on_windows(monkeypatch):
    class Done:
        stdout = "NVIDIA GeForce RTX 4060\nNVIDIA Other\n"

    monkeypatch.setattr(stt_choice.sys, "platform", "win32")
    monkeypatch.setattr(stt_choice.subprocess, "run", lambda *a, **k: Done())
    assert stt_choice.gpu_name() == "NVIDIA GeForce RTX 4060"


def test_gpu_name_is_none_on_failure_or_elsewhere(monkeypatch):
    def broken(*a, **k):
        raise FileNotFoundError("nvidia-smi")

    monkeypatch.setattr(stt_choice.sys, "platform", "win32")
    monkeypatch.setattr(stt_choice.subprocess, "run", broken)
    assert stt_choice.gpu_name() is None
    stt_choice.gpu_name.cache_clear()
    monkeypatch.setattr(stt_choice.sys, "platform", "linux")
    assert stt_choice.gpu_name() is None


def test_gpu_name_asks_nvidia_smi_once_and_without_a_console_window(monkeypatch):
    calls: list[dict] = []

    class Done:
        stdout = "NVIDIA GeForce RTX 4060\n"

    def run(*a, **k):
        calls.append(k)
        return Done()

    monkeypatch.setattr(stt_choice.sys, "platform", "win32")
    monkeypatch.setattr(stt_choice.subprocess, "run", run)
    stt_choice.gpu_name()
    stt_choice.gpu_name()
    assert len(calls) == 1
    assert calls[0]["creationflags"] == getattr(stt_choice.subprocess, "CREATE_NO_WINDOW", 0)
