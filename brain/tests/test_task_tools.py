"""task_tools.py: Scout starts and ends Do, Later and Own tasks.

Pins that a task is caused by the turn's event and takes its source, that Ask and Watch are
code's alone, and that ending a task cancels its timers but never leaves a running job behind.
"""

import json
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from brain.masking import Masker
from brain.store import events as store_events
from brain.store.db import open_db
from brain.store.events import EventRow
from brain.store.memory import MemoryRefused
from brain.store.work import WorkStore
from brain.task_tools import task_tools
from brain.tasks import Tasks

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


class FakeTimers:
    def __init__(self):
        self.cancelled = []

    def cancel(self, tid, reason):
        self.cancelled.append((tid, reason))
        return True


@pytest.fixture
def rig(tmp_path):
    db = open_db(tmp_path / "t.db")
    tasks = Tasks(db, Masker(lambda: []).mask, lambda: NOW)
    work = WorkStore(db, lambda: NOW)
    timers = FakeTimers()
    running: dict[str, list[str]] = {}
    cause = {"id": "e1"}
    store_events.insert(
        db,
        EventRow(id="e1", kind="say", at="2026-01-01T11:00:00+00:00", source="desktop-1"),
    )
    pairs = task_tools(tasks, timers, lambda t: running.get(t, []), lambda: cause["id"])
    handlers = {spec.name: (spec, h) for spec, h in pairs}

    async def call(name, args):
        return await handlers[name][1](args)

    return SimpleNamespace(
        tasks=tasks,
        work=work,
        timers=timers,
        running=running,
        cause=cause,
        specs={n: s for n, (s, _) in handlers.items()},
        call=call,
    )


async def test_task_start_opens_a_task_caused_by_the_turns_event(rig):
    out = json.loads(await rig.call("task_start", {"kind": "do", "title": "fix the build"}))
    row = rig.tasks.get(out["task"])
    assert (row.kind, row.title, row.source, row.caused_by) == (
        "do", "fix the build", "desktop-1", "e1",
    )  # fmt: skip


async def test_task_start_with_no_turn_event_is_scouts_own(rig):
    rig.cause["id"] = None
    out = json.loads(await rig.call("task_start", {"kind": "own", "title": "offer"}))
    assert rig.tasks.get(out["task"]).source == "scout"


@pytest.mark.parametrize("kind", ["ask", "watch", "other", None])
async def test_task_start_refuses_ask_and_watch(rig, kind):
    with pytest.raises(MemoryRefused):
        await rig.call("task_start", {"kind": kind, "title": "x"})


async def test_task_end_records_the_result_and_cancels_its_timers(rig):
    tid = rig.tasks.open("later", "desktop-1", title="remind")
    t = rig.work.create("timer", "ping", due_at=NOW, task_id=tid)
    other = rig.work.create("timer", "other", due_at=NOW, task_id="zzzzzz")
    out = json.loads(await rig.call("task_end", {"task_id": tid, "result": "all done"}))
    assert out == {"task": tid, "state": "done"}
    got = rig.tasks.get(tid)
    assert (got.state, got.result) == ("done", "all done")
    assert [i for i, _ in rig.timers.cancelled] == [t.id]
    assert other.id not in [i for i, _ in rig.timers.cancelled]


async def test_task_end_refuses_while_a_job_runs(rig):
    tid = rig.tasks.open("do", "desktop-1")
    rig.running[tid] = ["j1"]
    with pytest.raises(MemoryRefused, match="stop the job first"):
        await rig.call("task_end", {"task_id": tid, "result": "x"})
    assert rig.tasks.get(tid).state == "open"


async def test_task_end_refuses_an_unknown_or_ended_task(rig):
    with pytest.raises(MemoryRefused):
        await rig.call("task_end", {"task_id": "nope", "result": "x"})
    tid = rig.tasks.open("do", "desktop-1")
    rig.tasks.end(tid, "done")
    with pytest.raises(MemoryRefused):
        await rig.call("task_end", {"task_id": tid, "result": "x"})


def test_both_tools_are_scouts_own_and_run_on_their_own(rig):
    for spec in rig.specs.values():
        assert (spec.audience, spec.effect, spec.default_mode) == (
            frozenset({"scout"}),
            "change",
            "auto",
        )
