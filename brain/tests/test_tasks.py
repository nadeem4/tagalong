"""tasks.py: the Tasks service over the tasks table.

Pins that ids are short and unique, that saved text is masked, that the first end of a task
stands, and that the open-tasks block is facts only, newest first, capped.
"""

import dataclasses
from datetime import UTC, datetime

import pytest

from brain.events import Event
from brain.masking import Masker
from brain.open_items import OpenItems
from brain.store import events as store_events
from brain.store.db import open_db
from brain.store.events import EventRow
from brain.tasks import Tasks, TaskStopHooks

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


@pytest.fixture
def db(tmp_path):
    return open_db(tmp_path / "t.db")


@pytest.fixture
def tasks(db):
    return Tasks(db, Masker(lambda: []).mask, lambda: NOW)


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


def test_settle_stops_a_bare_own_task_as_no_answer(tasks):
    own = tasks.open("own", "scout")
    assert tasks.settle() == [own]
    row = tasks.get(own)
    assert (row.state, row.end_reason) == ("stopped", "no answer")


# ---- stop the task (spec 6.13) ----


class Hooks:
    """Records what Tasks.stop asks the rest of the brain to do, and in which order."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    async def stop_jobs(self, task_id: str) -> None:
        self.calls.append(("jobs", task_id))

    def cancel_rows(self, task_id: str) -> None:
        self.calls.append(("rows", task_id))

    def close_cards(self, ids: list[str]) -> None:
        self.calls.append(("cards", ids))

    def cancel_turn_if_only(self, ids: set[str]) -> None:
        self.calls.append(("turn", sorted(ids)))

    def finish_events(self, task_id: str) -> None:
        self.calls.append(("news", task_id))

    def wire(self) -> TaskStopHooks:
        return TaskStopHooks(
            self.stop_jobs,
            self.cancel_rows,
            self.close_cards,
            self.finish_events,
            self.cancel_turn_if_only,
            lambda task_id: self.calls.append(("watch", task_id)),
        )


def stoppable(db, hooks=None):
    posted: list[Event] = []
    items = OpenItems(db, lambda: NOW)
    tasks = Tasks(db, Masker(lambda: []).mask, lambda: NOW, items=items, post=posted.append)
    tasks.hooks = (hooks or Hooks()).wire()
    return tasks, items, posted


def event_of(db, id: str, task: str, state: str = "new") -> None:
    store_events.insert(
        db,
        EventRow(id=id, kind="job_ended", at="2026-01-01T11:00:00+00:00", source="job:1",
                 state=state, task=task),
    )  # fmt: skip


async def test_stop_kills_the_running_job_and_cascades_to_caused_tasks(db):
    hooks = Hooks()
    tasks, _, posted = stoppable(db, hooks)
    parent = tasks.open("do", "desktop")
    event_of(db, "e1", parent, "handled")  # a turn of the parent's started the child
    child = tasks.open("do", "desktop", caused_by="e1")
    unrelated = tasks.open("do", "desktop")
    assert await tasks.stop(parent, "desktop") == [parent, child]
    assert [c for c in hooks.calls if c[0] == "jobs"] == [("jobs", parent), ("jobs", child)]
    assert [c for c in hooks.calls if c[0] == "rows"] == [("rows", parent), ("rows", child)]
    assert hooks.calls[-1] == ("turn", sorted([parent, child]))
    assert tasks.get(child).state == "stopped" and tasks.get(unrelated).state == "open"
    [stop] = posted
    assert (stop.kind, stop.task) == ("task_stop", parent)


async def test_stop_closes_its_open_cards(db):
    hooks = Hooks()
    tasks, items, _ = stoppable(db, hooks)
    task = tasks.open("do", "desktop")
    card = items.open("expert_ask", task_id=task, id="c1")
    assert await tasks.stop(task, "desktop") == [task]
    assert items.get(card.id).state == "done"
    assert ("cards", ["c1"]) in hooks.calls


async def test_stop_cancels_a_turn_holding_only_that_tasks_events(db):
    hooks = Hooks()
    tasks, _, _ = stoppable(db, hooks)
    task = tasks.open("do", "desktop")
    await tasks.stop(task, "desktop")
    assert ("turn", [task]) in hooks.calls  # the runner decides if the turn held only these


async def test_stop_twice_is_a_no_op(db):
    hooks = Hooks()
    tasks, _, posted = stoppable(db, hooks)
    task = tasks.open("do", "desktop")
    await tasks.stop(task, "desktop")
    calls = len(hooks.calls)
    assert await tasks.stop(task, "desktop") == []
    assert len(hooks.calls) == calls and len(posted) == 1


async def test_a_failing_step_does_not_skip_the_rest_or_later_tasks(db, caplog):
    hooks = Hooks()

    async def broken_jobs(task_id: str) -> None:
        raise RuntimeError("boom")

    tasks, _, posted = stoppable(db, hooks)
    tasks.hooks = dataclasses.replace(hooks.wire(), stop_jobs=broken_jobs)
    parent = tasks.open("do", "desktop")
    event_of(db, "e1", parent, "handled")
    child = tasks.open("do", "desktop", caused_by="e1")
    assert await tasks.stop(parent, "desktop") == [parent, child]
    assert [c[0] for c in hooks.calls].count("rows") == 2  # both tasks went on past the failure
    assert [c for c in hooks.calls if c[0] == "news"] == [("news", parent), ("news", child)]
    assert hooks.calls[-1] == ("turn", sorted([parent, child]))
    assert [e.kind for e in posted] == ["task_stop"]
