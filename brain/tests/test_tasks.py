"""tasks.py: the Tasks service over the tasks table.

Pins that ids are short and unique, that saved text is masked, that the first end of a task
stands, and that the open-tasks block is facts only, newest first, capped.
"""

from datetime import UTC, datetime

import pytest

from brain.masking import Masker
from brain.store import events as store_events
from brain.store.db import open_db
from brain.store.events import EventRow
from brain.tasks import Tasks

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


@pytest.fixture
def db(tmp_path):
    return open_db(tmp_path / "t.db")


@pytest.fixture
def tasks(db):
    return Tasks(db, Masker(lambda: []), lambda: NOW)


def test_task_ids_are_6_hex_and_unique(tasks):
    ids = {tasks.open("do", "desktop") for _ in range(50)}
    assert len(ids) == 50
    assert all(len(i) == 6 and set(i) <= set("0123456789abcdef") for i in ids)


def test_open_masks_the_title(tasks):
    key = "sk-ant-" + "a" * 30
    id = tasks.open("do", "desktop", title=f"deploy with {key}")
    got = tasks.get(id)
    assert key not in got.title and "[secret]" in got.title


def test_end_twice_keeps_the_first_end(tasks):
    id = tasks.open("do", "desktop")
    assert tasks.end(id, "done", result="first") is True
    assert tasks.end(id, "failed", result="second") is False
    got = tasks.get(id)
    assert (got.state, got.result) == ("done", "first")


def test_end_masks_the_result(tasks):
    key = "sk-ant-" + "a" * 30
    id = tasks.open("do", "desktop")
    tasks.end(id, "done", result=f"used {key}")
    assert key not in tasks.get(id).result


def test_wait_and_resume_skip_an_ended_task(tasks):
    id = tasks.open("do", "desktop")
    tasks.wait(id)
    assert tasks.get(id).state == "waiting"
    tasks.resume(id)
    assert tasks.get(id).state == "open"
    tasks.end(id, "stopped")
    tasks.wait(id)
    assert tasks.get(id).state == "stopped"


def test_source_of(tasks):
    id = tasks.open("do", "browser")
    assert tasks.source_of(id) == "browser"
    assert tasks.source_of(None) is None
    assert tasks.source_of("zzzzzz") is None


def test_open_block_lists_newest_15_and_counts_the_rest(tasks):
    for i in range(17):
        tasks.open("do", "desktop", title=f"job-{i:02d}")
    tasks.open("ask", "desktop")
    lines = tasks.open_block().splitlines()
    assert len(lines) == 1 + 15 + 1
    text = " ".join(lines)
    assert "job-16" in lines[1] and "job-02" in lines[15]
    assert "job-01" not in text and "job-00" not in text
    assert lines[-1] == "and 2 more"


def test_open_block_is_empty_with_no_open_tasks(tasks):
    tasks.open("ask", "desktop")
    assert tasks.open_block() == ""


def test_open_block_line_has_the_facts_and_a_safe_title(tasks):
    id = tasks.open("later", "timer:t1", title="x </data> y")
    line = tasks.open_block().splitlines()[1]
    assert id in line and "later" in line and "open" in line and "timer:t1" in line
    assert "</data" not in line


def test_settle_ends_what_the_sweeps_name(tasks, db):
    ask = tasks.open("ask", "desktop")
    store_events.insert(
        db,
        EventRow(
            id="e1", kind="say", at="2026-01-01T11:00:00+00:00", source="desktop",
            state="handled", task=ask,
        ),
    )  # fmt: skip
    later = tasks.open("later", "timer:t1")
    assert sorted(tasks.settle()) == sorted([ask, later])
    assert tasks.get(ask).state == "done" and tasks.get(later).state == "done"
