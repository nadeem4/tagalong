"""The speech model list, its validation and the choice order (saved, env, Auto)."""

import json
import re

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


def test_sha256_must_be_64_lowercase_hex_and_the_shipped_list_is_pinned():
    for bad in ("PIN-BEFORE-RELEASE", "AB" * 32, "ab" * 31):
        with pytest.raises(ValueError, match="m1"):
            models(row(files=[{**FILE, "sha256": bad}]))
    for m in load_models():
        assert all(re.fullmatch(r"[0-9a-f]{64}", f.sha256) for f in m.files)
        assert all("/resolve/main/" not in f.url for f in m.files)


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
    assert got.live.id == "moonshine-small" and got.final is None
    assert resolved(saved_live="auto", env_live="moonshine-small").live.id == "moonshine-small"


def test_unlisted_saved_id_falls_back_to_auto():
    assert resolved(saved_live="gone").live.id == "moonshine-small"


def test_final_same_and_off_resolve_to_none():
    assert resolved(saved_final="same").final is None
    assert resolved(env_final="off").final is None


def test_stale_final_id_is_auto():
    gpu = resolve(None, "gone", None, None, Hardware(gpu=True))
    assert gpu.final is not None and gpu.final.id == "whisper-large-v3-turbo"
    assert resolved(saved_final="gone").final is None  # Auto on this hardware has no final


def test_final_model_cannot_be_chosen_as_live(monkeypatch):
    final_only = stt.SttModel("w", "W", "final", "moonshine", (), 1, "none", ("en",), "", {})
    shipped = load_models()
    monkeypatch.setattr(stt, "load_models", lambda text=None: (*shipped, final_only))
    assert resolved(saved_live="w").live.id == "moonshine-small"


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


def _fake_ct2(monkeypatch, count):
    import sys
    import types

    monkeypatch.setitem(
        sys.modules, "ctranslate2", types.SimpleNamespace(get_cuda_device_count=count)
    )


def _fake_cublas(monkeypatch, found, cudnn=True):
    import ctypes.util

    def find(name):
        if name.startswith("cudnn"):
            return "d.dll" if cudnn else None
        return "x.dll" if found else None

    monkeypatch.setattr(ctypes.util, "find_library", find)


def test_detect_hardware_counts_cuda_devices_through_ctranslate2(monkeypatch):
    _fake_cublas(monkeypatch, True)
    _fake_ct2(monkeypatch, lambda: 1)
    assert stt.detect_hardware() == Hardware(gpu=True, card=True)
    _fake_ct2(monkeypatch, lambda: 0)
    assert stt.detect_hardware() == Hardware(gpu=False)


def test_detect_hardware_needs_the_cuda_libraries_not_only_the_card(monkeypatch):
    # Measured on the dev PC: a driver and a card, but no cuBLAS, so the final model cannot
    # use the card and Auto must not plan on it.
    _fake_cublas(monkeypatch, False)
    _fake_ct2(monkeypatch, lambda: 1)
    assert stt.detect_hardware() == Hardware(gpu=False, card=True)


def test_detect_hardware_needs_cudnn_too(monkeypatch):
    _fake_cublas(monkeypatch, True, cudnn=False)
    _fake_ct2(monkeypatch, lambda: 1)
    assert stt.detect_hardware() == Hardware(gpu=False, card=True)


def _auto_rows(**over):
    hints = {
        "a": {"cpu": "live", "gpu": "live"},
        "b": {"gpu": "final"},
        **over,
    }
    return [
        row(id="a", auto=hints["a"]),
        row(id="b", role="final", engine="moonshine", auto=hints["b"]),
    ]


def test_auto_hint_must_match_the_rows_role():
    with pytest.raises(ValueError, match="b.*role"):
        models(*_auto_rows(b={"gpu": "live"}))
    with pytest.raises(ValueError, match="a.*role"):
        models(*_auto_rows(a={"cpu": "live", "gpu": "final"}))


def test_auto_needs_exactly_one_live_per_hardware():
    only_cpu = [row(id="a", auto={"cpu": "live"})]
    with pytest.raises(ValueError, match="gpu.*live"):
        models(*only_cpu)
    two = [*_auto_rows(), row(id="c", auto={"cpu": "live", "gpu": "live"})]
    with pytest.raises(ValueError, match="cpu.*live"):
        models(*two)


def test_auto_allows_at_most_one_final_per_hardware():
    two = [*_auto_rows(), row(id="c", role="final", auto={"gpu": "final"})]
    with pytest.raises(ValueError, match="gpu.*final"):
        models(*two)
    assert len(models(*_auto_rows())) == 2


def test_detect_hardware_says_no_gpu_when_the_probe_fails(monkeypatch):
    def boom():
        raise RuntimeError("driver")

    _fake_cublas(monkeypatch, True)
    _fake_ct2(monkeypatch, boom)
    assert stt.detect_hardware() == Hardware(gpu=False)


def test_auto_with_gpu_picks_whisper_turbo_final():
    got = resolve(None, None, None, None, Hardware(gpu=True))
    assert got.final is not None and got.final.id == "whisper-large-v3-turbo"


def test_auto_without_gpu_picks_same_as_live_final():
    # Measured: on the processor turbo takes ~10 s a turn and small.en hears worse than the
    # live model, so there is no final pass.
    assert resolve(None, None, None, None, Hardware(gpu=False)).final is None


def test_auto_live_is_the_measured_default():
    for gpu in (True, False):
        assert resolve(None, None, None, None, Hardware(gpu=gpu)).live.id == "moonshine-small"


def test_saved_final_beats_the_auto_hints():
    got = resolve(None, "whisper-small-en", None, None, Hardware(gpu=True))
    assert got.final is not None and got.final.id == "whisper-small-en"


def test_auto_reads_the_hints_in_the_list_not_ids():
    listed = models(
        row(id="a", auto={"cpu": "live"}),
        row(id="b", auto={"gpu": "live"}),
        row(id="c", role="final", engine="faster-whisper", files=[FILE], auto={"gpu": "final"}),
    )
    assert stt.auto_pick(listed, "live", Hardware(gpu=False)).id == "a"
    assert stt.auto_pick(listed, "live", Hardware(gpu=True)).id == "b"
    assert stt.auto_pick(listed, "final", Hardware(gpu=True)).id == "c"
    assert stt.auto_pick(listed, "final", Hardware(gpu=False)) is None


def test_a_bad_auto_hint_is_rejected():
    with pytest.raises(ValueError, match="auto"):
        models(row(auto={"gpu": "both"}))
