"""Tests for the reading cache: what each body last said about how it reads the screen."""

from brain.protocol import ReadingData
from brain.reading import ReadingStore


def data(state="working", language=None):
    row = {"capability": "text-from-pictures", "engine": "windows-ocr", "where": "this-pc"}
    row["state"] = state
    if language:
        row["language"] = language
    return ReadingData.model_validate({"rows": [row]})


def test_set_says_whether_the_copy_changed():
    store = ReadingStore()
    assert store.set("desktop", data()) is True
    assert store.set("desktop", data()) is False
    assert store.set("desktop", data("not-working")) is True


def test_forget_clears_and_reports_a_change():
    store = ReadingStore()
    store.set("desktop", data())
    assert store.forget("desktop") is True
    assert store.rows() == []
    assert store.forget("desktop") is False


def test_rows_is_empty_with_no_body():
    assert ReadingStore().rows() == []


def test_rows_are_the_most_recent_bodys():
    store = ReadingStore()
    store.set("a", data())
    store.set("b", data("not-working"))
    assert store.rows()[0]["state"] == "not-working"
    store.forget("b")
    assert store.rows()[0]["state"] == "working"


def test_ocr_problem_is_none_when_working_and_the_row_when_a_pack_is_missing():
    store = ReadingStore()
    assert store.ocr_problem() is None
    store.set("desktop", data())
    assert store.ocr_problem() is None
    store.set("desktop", data("needs-language-pack", "en-US"))
    problem = store.ocr_problem()
    assert problem.state == "needs-language-pack" and problem.language == "en-US"
