"""The voice roster (`tts_models.json`): every row complete, one Auto, bad lists refused."""

import json
import re

import pytest

from brain.voice import tts
from brain.voice.ear_text import for_the_ear
from brain.voice.tts import AUTO, auto_voice, load_voices, voice_by_id

# The weights licences recorded in docs/voice.md ("Voice licences").
LICENCES = {"Mycroft AI dataset (see docs)", "CC-BY-SA-4.0", "Apache-2.0", "OpenRAIL-M"}
SHA256 = re.compile(r"[0-9a-f]{64}")


def _rows() -> list[dict]:
    return json.loads(tts.LIST_FILE.read_text(encoding="utf-8"))


def _text(rows: list[dict]) -> str:
    return json.dumps(rows)


def test_roster_loads_and_has_one_auto_alan() -> None:
    assert auto_voice().id == "piper-alan"
    assert sum(v.auto for v in load_voices()) == 1
    assert AUTO == "auto"
    assert voice_by_id("piper-alan") == auto_voice()
    assert voice_by_id("nope") is None


def test_roster_lists_the_planned_voices() -> None:
    ids = {v.id for v in load_voices()}
    assert ids == {
        "piper-alan",
        "piper-northern-english-male",
        "kokoro-george",
        "kokoro-fable",
        "kokoro-emma",
        "kokoro-heart",
        "supertonic-m1",
        "supertonic-f1",
    }


def test_every_row_is_complete() -> None:
    for v in load_voices():
        assert v.label and v.descriptor and v.voice and v.size_mb > 0
        assert v.licence in LICENCES
        assert v.runtime == "brain"
        assert v.sample is None  # clips are pending the hand run
        assert v.files
        for f in v.files:
            assert SHA256.fullmatch(f.sha256) and f.bytes > 0
            assert f.path.startswith(f"tts/{v.engine}/")
            assert "/resolve/main/" not in f.url  # pinned to a commit, never a branch


def test_kokoro_rows_share_one_set_of_files() -> None:
    sets = {v.files for v in load_voices() if v.engine == "kokoro"}
    assert len(sets) == 1


def test_unknown_engine_is_refused() -> None:
    rows = _rows()
    rows[0]["engine"] = "nope"
    with pytest.raises(ValueError, match="text-to-speech voice 'piper-alan': unknown engine"):
        load_voices(_text(rows))


def test_two_auto_rows_are_refused() -> None:
    rows = _rows()
    rows[1]["auto"] = True
    with pytest.raises(ValueError, match="exactly one auto"):
        load_voices(_text(rows))


def test_no_auto_row_is_refused() -> None:
    rows = _rows()
    rows[0]["auto"] = False
    with pytest.raises(ValueError, match="exactly one auto"):
        load_voices(_text(rows))


def test_duplicate_id_is_refused() -> None:
    rows = _rows()
    rows[1]["id"] = rows[0]["id"]
    with pytest.raises(ValueError, match="listed twice"):
        load_voices(_text(rows))


def test_a_helper_row_is_refused_until_it_has_an_engine() -> None:
    rows = _rows()
    rows[1]["runtime"] = "helper"
    with pytest.raises(ValueError, match="runtime"):
        load_voices(_text(rows))


def test_unknown_runtime_is_refused() -> None:
    rows = _rows()
    rows[1]["runtime"] = "cloud"
    with pytest.raises(ValueError, match="unknown runtime"):
        load_voices(_text(rows))


def test_a_file_without_a_hash_is_refused() -> None:
    rows = _rows()
    rows[0]["files"][0]["sha256"] = "abc"
    with pytest.raises(ValueError, match="sha256"):
        load_voices(_text(rows))


def test_an_empty_licence_is_refused() -> None:
    rows = _rows()
    rows[0]["licence"] = ""
    with pytest.raises(ValueError, match="licence"):
        load_voices(_text(rows))


def test_a_missing_field_names_the_row() -> None:
    rows = _rows()
    del rows[0]["label"]
    with pytest.raises(ValueError, match="text-to-speech voice 'piper-alan': missing 'label'"):
        load_voices(_text(rows))


def test_sample_text_is_short_and_plain() -> None:
    assert len(tts.SAMPLE_TEXT) < 60
    assert for_the_ear(tts.SAMPLE_TEXT) == tts.SAMPLE_TEXT
