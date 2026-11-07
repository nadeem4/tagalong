"""OutputStore and preview: the transport cap on long tool output, masked storage, paging.

Fakes only: a throwaway Memory and a Masker over a made-up secret.
"""

import json
from datetime import UTC, datetime

import pytest

from brain.config import DEFAULT_TOOL_PREVIEW_CHARS, load_config
from brain.guards import Guards
from brain.masking import Masker, mask_secrets
from brain.memory import Memory
from brain.outputs import OutputStore, preview

SECRET = "fake-secret-value-12345"
CAP = 10


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


@pytest.fixture
def store(mem):
    guards = Guards()
    guards.add(mask_secrets(Masker(lambda: [SECRET])))
    return OutputStore(mem, guards, CAP)


def header(text: str) -> dict:
    return json.loads(text.split("\n", 1)[0])


def test_under_or_at_the_cap_passes_through_untouched(store):
    assert preview(store, "t", "x" * CAP) == "x" * CAP
    assert preview(store, "t", "") == ""


def test_one_over_is_previewed_with_facts(store):
    out = preview(store, "t", "a" * CAP + "b")
    head, _, body = out.partition("\n")
    facts = json.loads(head)
    assert body == "a" * CAP
    assert (facts["chars"], facts["shown"], facts["next_offset"]) == (CAP + 1, CAP, CAP)
    assert store.page(facts["output_id"], CAP)["text"] == "b"


def test_stored_copy_is_masked_even_past_the_cap(store):
    out = preview(store, "t", "x" * 30 + SECRET + "tail")
    assert SECRET not in out
    page = store.page(header(out)["output_id"], 30)
    assert SECRET not in json.dumps(page) and "[secret]" in page["text"]


def test_a_secret_straddling_the_cap_never_leaks_in_the_preview(store):
    out = preview(store, "t", "x" * (CAP - 5) + SECRET)
    assert "fake-" not in out


def test_page_walks_to_the_end_and_next_offset_becomes_none(store):
    out = preview(store, "t", "0123456789ABCDEFGHIJ12")
    oid = header(out)["output_id"]
    p1 = store.page(oid, CAP)
    assert p1["text"] == "ABCDEFGHIJ" and p1["next_offset"] == 20
    p2 = store.page(oid, p1["next_offset"])
    assert p2["text"] == "12" and p2["next_offset"] is None and p2["chars"] == 22


def test_page_past_the_end_is_empty_and_final(store):
    oid = header(preview(store, "t", "x" * 15))["output_id"]
    page = store.page(oid, 99)
    assert page["text"] == "" and page["next_offset"] is None


def test_page_bad_id_and_bad_offset_are_plain(store):
    oid = header(preview(store, "t", "x" * 15))["output_id"]
    with pytest.raises(ValueError, match="No stored output"):
        store.page("nope", 0)
    with pytest.raises(ValueError, match="offset"):
        store.page(oid, -1)


def test_cut_never_splits_a_character(store):
    text = "\U0001f600" * 25  # outside the BMP: two UTF-16 units each
    out = preview(store, "t", text)
    assert out.split("\n", 1)[1] == "\U0001f600" * CAP
    page = store.page(header(out)["output_id"], CAP)
    assert page["text"] == "\U0001f600" * CAP


def test_prune_keeps_the_newest(store):
    ids = [header(preview(store, "t", "x" * 20 + str(i)))["output_id"] for i in range(5)]
    store.prune(keep=2)
    with pytest.raises(ValueError):
        store.page(ids[0], 0)
    assert store.page(ids[4], 0)["chars"] == 21
    assert store.page(ids[3], 0)["chars"] == 21


def test_prune_spares_work_detail(mem):
    from brain.job_records import JobRecords
    from brain.store.work import WorkStore

    def now():
        return datetime(2026, 1, 1, tzinfo=UTC)

    records = JobRecords(WorkStore(mem.db, now), mem.db, now)
    records.add_job("j1", "claude-acp", "t", "C:/a", "ask")
    records.update_part("j1", "p1", state="done", reason="done", report="w" * 5000)
    kept = records.work.get("j1.p1").detail_id
    mem.put_output("other", "t", "x" * 20)
    mem.put_output("newer", "t", "y" * 20)
    mem.prune_outputs(keep=1)
    assert mem.get_output(kept) == "w" * 5000  # a job report is still needed by its row
    assert mem.get_output("other") is None and mem.get_output("newer") is not None


def test_two_calls_make_two_ids(store):
    a = header(preview(store, "t", "x" * 20))["output_id"]
    b = header(preview(store, "t", "x" * 20))["output_id"]
    assert a != b


def test_config_reads_tool_preview_chars_and_rejects_zero(tmp_path):
    base = {"TAGALONG_HOME": str(tmp_path)}
    assert load_config(base).tool_preview_chars == DEFAULT_TOOL_PREVIEW_CHARS == 4000
    assert load_config({**base, "TAGALONG_TOOL_PREVIEW_CHARS": "50"}).tool_preview_chars == 50
    with pytest.raises(ValueError):
        load_config({**base, "TAGALONG_TOOL_PREVIEW_CHARS": "0"})


def test_page_length_is_clamped_between_one_and_the_cap(store):
    oid = store.put("t", "a" * 30).id
    assert len(store.page(oid, 0, 0)["text"]) == 1
    assert len(store.page(oid, 0, -5)["text"]) == 1
    assert len(store.page(oid, 0, CAP + 20)["text"]) == CAP
    assert len(store.page(oid, 0, 4)["text"]) == 4
