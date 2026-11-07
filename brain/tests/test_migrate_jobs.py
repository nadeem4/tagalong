"""Migration 0019: old jobs and job parts become goal and expert_call rows.

Runs on a file seeded at an old schema version, with the awkward rows a real database has:
no parts, nulls in every optional column, a 100 kB report, an unreadable watch list.
"""

import json
import sqlite3

import pytest

from brain.store.db import migrate
from brain.store.outputs import get_output
from brain.store.work import WorkStore

LONG = "r" * 100_000
JOB = (
    "INSERT INTO jobs(id, task, folder, mode, state, started_at, ended_at, parent_job, watch,"
    " title, scout_result, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
)
PART = (
    "INSERT INTO job_parts(job_id, id, agent, task, state, reason, progress, session_id, report,"
    " reported, started_at, ended_at, folder) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
)
T = "2026-01-01T10:00:00+00:00"


def _seed(db):
    watch = json.dumps([{"text": "tests pass", "done": False}])
    db.execute(
        JOB,
        (
            "run1",
            "fix it",
            "C:/a",
            "ask",
            "running",
            T,
            None,
            None,
            watch,
            "Fix export",
            None,
            None,
        ),
    )
    db.execute(
        PART,
        (
            "run1",
            "p1",
            "claude-acp",
            "find cause",
            "done",
            "done",
            None,
            "s-1",
            "found it",
            1,
            T,
            "2026-01-01T10:05:00+00:00",
            "C:/a",
        ),
    )
    db.execute(
        PART,
        (
            "run1",
            "p2",
            "claude-acp",
            "apply fix",
            "running",
            None,
            "editing",
            None,
            None,
            0,
            "2026-01-01T10:06:00+00:00",
            None,
            "C:/b",
        ),
    )
    db.execute(
        JOB,
        (
            "stop1",
            "t",
            "C:/a",
            "ask",
            "stopped",
            "2026-01-01T09:00:00+00:00",
            "2026-01-01T09:30:00+00:00",
            None,
            None,
            None,
            None,
            "2026-01-01T09:30:00+00:00",
        ),
    )
    db.execute(
        PART,
        (
            "stop1",
            "p1",
            "claude-acp",
            "t",
            "stopped",
            "stopped",
            None,
            None,
            None,
            1,
            "2026-01-01T09:00:00+00:00",
            "2026-01-01T09:30:00+00:00",
            "C:/a",
        ),
    )
    db.execute(
        JOB,
        (
            "err1",
            "t",
            "C:/a",
            "ask",
            "error",
            "2026-01-01T08:00:00+00:00",
            "2026-01-01T08:01:00+00:00",
            None,
            "not json",
            "Broke",
            "gone wrong",
            "2026-01-01T08:02:00+00:00",
        ),
    )
    db.execute(
        PART,
        (
            "err1",
            "p1",
            "claude-acp",
            "t",
            "error",
            "crashed",
            None,
            None,
            "boom",
            0,
            "2026-01-01T08:00:00+00:00",
            "2026-01-01T08:01:00+00:00",
            "C:/a",
        ),
    )
    db.execute(
        JOB,
        (
            "bare1",
            "no parts",
            "C:/a",
            "ask",
            "done",
            "2026-01-01T07:00:00+00:00",
            "2026-01-01T07:10:00+00:00",
            None,
            None,
            None,
            None,
            None,
        ),
    )
    db.execute(
        JOB,
        (
            "cont1",
            "again",
            "C:/a",
            "ask",
            "done",
            "2026-01-02T07:00:00+00:00",
            "2026-01-02T07:10:00+00:00",
            "stop1",
            None,
            None,
            None,
            "2026-01-02T07:10:00+00:00",
        ),
    )
    db.execute(
        PART,
        (
            "cont1",
            "p1",
            "claude-acp",
            "again",
            "done",
            "done",
            None,
            "s-2",
            "ok",
            1,
            "2026-01-02T07:00:00+00:00",
            "2026-01-02T07:10:00+00:00",
            "C:/a",
        ),
    )
    db.execute(
        JOB,
        (
            "long1",
            "big",
            "C:/a",
            "ask",
            "done",
            "2026-01-03T07:00:00+00:00",
            "2026-01-03T07:10:00+00:00",
            None,
            None,
            "Big",
            LONG,
            "2026-01-03T07:10:00+00:00",
        ),
    )
    db.execute(
        PART,
        (
            "long1",
            "p1",
            "claude-acp",
            "big",
            "done",
            "done",
            None,
            None,
            LONG,
            1,
            "2026-01-03T07:00:00+00:00",
            "2026-01-03T07:10:00+00:00",
            "C:/a",
        ),
    )
    db.execute(JOB, ("nulls1", None, None, None, None, None, None, None, None, None, None, None))
    db.execute(
        PART, ("nulls1", "p1", None, None, None, None, None, None, None, 0, None, None, None)
    )


@pytest.fixture(params=[18, 13], ids=["from-18", "from-13"])
def db(tmp_path, request):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=request.param)
    _seed(db)
    migrate(db)
    yield db
    db.close()


@pytest.fixture
def work(db):
    return WorkStore(db, lambda: None)  # reads only


def test_jobs_become_goals_with_mapped_states(work):
    states = {g.id: g.state for g in work.of_kind("goal")}
    assert states == {
        "run1": "active",
        "stop1": "cancelled",
        "err1": "failed",
        "bare1": "done",
        "cont1": "done",
        "long1": "done",
        "nulls1": "cancelled",
    }
    run = work.get("run1")
    assert run.title == "Fix export"
    assert run.created_at == T
    assert run.input == {"watch": [{"text": "tests pass", "done": False}]}
    assert work.get("err1").input is None  # an unreadable watch list reads as none
    assert work.get("stop1").reported_at == "2026-01-01T09:30:00+00:00"  # closed_at
    assert work.get("run1").reported_at is None


def test_parts_become_expert_calls_in_seq(work):
    calls = work.children("run1")
    assert [(c.id, c.seq, c.kind, c.state) for c in calls] == [
        ("run1.p1", 1, "expert_call", "done"),
        ("run1.p2", 2, "expert_call", "active"),
    ]
    assert calls[0].title == "find cause" and calls[0].input == {"task": "find cause"}
    assert calls[0].end_reason == "done" and calls[0].summary == "found it"
    assert calls[0].reported_at == "2026-01-01T10:05:00+00:00"  # reported=1: its ended_at
    assert calls[1].reported_at is None and calls[1].progress == "editing"
    assert work.get("err1.p1").state == "failed"
    assert work.get("err1.p1").end_reason == "crashed"
    assert work.get("stop1.p1").state == "cancelled"


def test_work_job_keeps_task_folder_mode_agent(work):
    assert work.job_detail("run1") == {
        "agent": None,
        "folder": "C:/a",
        "mode": "ask",
        "task": "fix it",
    }
    assert work.job_detail("run1.p2")["agent"] == "claude-acp"
    assert work.job_detail("run1.p2")["folder"] == "C:/b"


def test_session_id_to_checkpoint(work):
    assert work.get("run1.p1").checkpoint == {"session_id": "s-1"}
    assert work.get("run1.p2").checkpoint is None


def test_long_report_moves_to_tool_outputs(db, work):
    call = work.get("long1.p1")
    assert call.detail_id is not None
    assert len(call.summary) == 2000
    assert get_output(db, call.detail_id) == LONG
    goal = work.get("long1")  # the job's own result follows the same rule
    assert goal.detail_id is not None and goal.detail_id != call.detail_id
    assert len(goal.summary) == 2000 and get_output(db, goal.detail_id) == LONG
    assert work.get("err1.p1").detail_id is None


def test_parent_job_becomes_continued_event(work):
    kinds = [(e.kind, e.data) for e in work.events("cont1")]
    assert ("continued", {"from": "stop1"}) in kinds
    assert not any(e.kind == "continued" for e in work.events("run1"))


def test_old_job_tables_gone(db):
    names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "jobs" not in names and "job_parts" not in names
    assert {"work", "work_job", "job_activity"} <= names
    assert db.execute("PRAGMA user_version").fetchone()[0] >= 19


def test_job_with_no_parts_migrates(work):
    assert work.get("bare1").state == "done"
    assert work.children("bare1") == []
    assert work.job_detail("bare1")["task"] == "no parts"


def test_nulls_in_every_optional_column_migrate(work):
    goal = work.get("nulls1")
    assert goal.title == "" and goal.ended_at is not None and goal.end_reason
    call = work.get("nulls1.p1")
    assert call.state == "cancelled" and call.title == "" and call.end_reason
    assert call.input == {"task": ""}


def test_every_row_is_kept(db):
    assert db.execute("SELECT count(*) FROM work WHERE kind='goal'").fetchone()[0] == 7
    assert db.execute("SELECT count(*) FROM work WHERE kind='expert_call'").fetchone()[0] == 7
