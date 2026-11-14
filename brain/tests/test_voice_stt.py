"""The speech model list, its validation and the choice order (saved, env, Auto)."""

import json

import pytest

from brain.voice import stt
from brain.voice.stt import Hardware, load_models, model_by_id, resolve

FILE = {"url": "https://x.test/a", "path": "stt/a.bin", "bytes": 10, "sha256": "ab" * 32}


def row(**over):
    base = {
        "id": "m1",
        "label": "M1",
        "role": "live",
        "engine": "moonshine",
        "files": [],
        "size_mb": 1,
        "gpu": "none",
        "languages": ["en"],
        "note": "",
        "options": {},
    }
    return {**base, **over}


def models(*rows):
    return load_models(json.dumps(list(rows)))


def test_list_loads_and_has_default_live_model():
    listed = load_models()
    tiny = model_by_id("moonshine-tiny")
    assert tiny is not None and tiny.role == "live" and tiny.engine == "moonshine"
    assert {m.id for m in listed} >= {"moonshine-tiny", "moonshine-small", "moonshine-medium"}
    assert model_by_id("nope") is None


def test_rejects_unknown_role():
    with pytest.raises(ValueError, match="m1"):
        models(row(role="sideways"))


def test_live_role_requires_streaming_engine(monkeypatch):
    from brain.voice import engines

    monkeypatch.setitem(engines.ENGINES, "batch", engines.Engine(False, None, None))
    with pytest.raises(ValueError, match="m1.*stream"):
        models(row(engine="batch", role="live"))
    assert models(row(engine="batch", role="final"))[0].role == "final"


def test_duplicate_ids_rejected():
    with pytest.raises(ValueError, match="m1"):
        models(row(), row())


def test_every_file_has_sha256_and_size():
    with pytest.raises(ValueError, match="m1"):
        models(row(files=[{**FILE, "sha256": ""}]))
    with pytest.raises(ValueError, match="m1"):
        models(row(files=[{**FILE, "bytes": 0}]))
    assert models(row(files=[FILE]))[0].files[0].sha256 == FILE["sha256"]
    for m in load_models():  # the shipped list obeys it too
        assert all(f.sha256 and f.bytes > 0 for f in m.files)


def test_unknown_engine_rejected():
    with pytest.raises(ValueError, match="m1.*engine"):
        models(row(engine="nope"))


def resolved(saved_live=None, saved_final=None, env_live=None, env_final=None):
    return resolve(saved_live, saved_final, env_live, env_final, Hardware(gpu=False))


def test_saved_choice_wins_over_env():
    got = resolved(saved_live="moonshine-small", env_live="moonshine-medium")
    assert got.live.id == "moonshine-small"


def test_env_used_when_nothing_saved():
    assert resolved(env_live="moonshine-medium").live.id == "moonshine-medium"


def test_auto_when_nothing_set():
    got = resolved()
    assert got.live.id == "moonshine-tiny" and got.final is None
    assert resolved(saved_live="auto", env_live="moonshine-small").live.id == "moonshine-tiny"


def test_unlisted_saved_id_falls_back_to_auto():
    assert resolved(saved_live="gone").live.id == "moonshine-tiny"


def test_final_same_and_off_resolve_to_none():
    assert resolved(saved_final="same").final is None
    assert resolved(env_final="off").final is None


def test_final_model_cannot_be_chosen_as_live(monkeypatch):
    final_only = stt.SttModel("w", "W", "final", "moonshine", (), 1, "none", ("en",), "", {})
    shipped = load_models()
    monkeypatch.setattr(stt, "load_models", lambda text=None: (*shipped, final_only))
    assert resolved(saved_live="w").live.id == "moonshine-tiny"


def test_a_live_row_needs_an_engine_that_can_load_live(monkeypatch):
    from brain.voice import engines

    monkeypatch.setitem(engines.ENGINES, "nolive", engines.Engine(True, None, None))
    with pytest.raises(ValueError, match="load live"):
        models(row(engine="nolive"))


def test_a_missing_key_names_the_row_and_the_key():
    bad = row(id="m9")
    del bad["note"]
    with pytest.raises(ValueError, match=r"m9.*'note'"):
        models(bad)
    nameless = row()
    del nameless["id"]
    with pytest.raises(ValueError, match=r"#0.*'id'"):
        models(nameless)
