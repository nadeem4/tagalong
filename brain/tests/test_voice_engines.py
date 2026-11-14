"""The engine lookup: Moonshine is registered, and a new engine needs no change to load.py."""

import json

from fake_voice import parts

from brain.voice import engines, load, stt
from brain.voice.engines import ENGINES, Engine


def test_moonshine_engine_streams_and_has_no_final():
    engine = ENGINES["moonshine"]
    assert engine.streams and engine.load_live is not None and engine.load_final is None


async def test_adding_an_engine_touches_only_its_module_and_the_list(monkeypatch, tmp_path):
    made = parts()
    seen = {}

    def load_live(model, folder, on_progress):
        seen["model"] = model.id
        return made.stt

    row = {
        "id": "fake-1", "label": "Fake", "role": "live", "engine": "fake", "files": [],
        "size_mb": 1, "gpu": "none", "languages": ["en"], "note": "", "options": {},
    }  # fmt: skip
    monkeypatch.setitem(engines.ENGINES, "fake", Engine(True, load_live, None))
    real = stt.load_models
    monkeypatch.setattr(stt, "load_models", lambda text=None: real(json.dumps([row])))

    async def no_download(folder, files, fetch, on_progress):
        return None

    monkeypatch.setattr(load, "ensure_files", no_download)
    monkeypatch.setattr(stt, "detect_hardware", lambda: stt.Hardware(gpu=False))
    monkeypatch.setattr(load.silero, "load", lambda path: made.vad)
    monkeypatch.setattr(load.smart_turn, "load", lambda path: made.turn)
    got = await load.ears_loader(tmp_path, env_live="fake-1")(lambda f: None)
    assert seen["model"] == "fake-1" and got.stt is made.stt
