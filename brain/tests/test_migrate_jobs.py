"""Migration 0019: old jobs and job parts become goal and expert_call rows.

Runs on a file seeded at an old schema version, with the awkward rows a real database has:
no parts, nulls in every optional column, a 100 kB report, an unreadable watch list.
"""

import json
import sqlite3
from datetime import UTC, datetime

import pytest

from brain.job_records import JobRecords, home_state
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
    for job_id, state, reason, report in (
        ("open1", "done", "done", "fine"),
        ("openerr1", "error", "crashed", "boom"),
    ):
        db.execute(
            JOB,
            (job_id, "t", "C:/a", "ask", state, T, "2026-01-04T07:10:00+00:00")
            + (None, None, None, None, None),
        )
        db.execute(
            PART,
            (job_id, "p1", "claude-acp", "t", state, reason, "tail", None, report, 0, T)
            + ("2026-01-04T07:10:00+00:00", "C:/a"),
        )
    db.execute(JOB, ("retried1", "t", "C:/a", "ask", "done", T, T) + (None,) * 5)
    db.execute(JOB, ("shut1", "t", "C:/a", "ask", "running", T, None, None, None, None, None, T))
    for part_id, state in (("p1", "error"), ("p2", "done")):
        db.execute(
            PART,
            ("retried1", part_id, "claude-acp", "t", state, "x", None, None, None, 0, T, T)
            + ("C:/a",),
        )
    db.execute(
        PART, ("ghost", "p1", "claude-acp", "t", "done", "done", None, None, "x", 0, T, T, "C:/a")
    )
    db.execute(JOB, ("nulls1", None, None, None, None, None, None, None, None, None, None, None))
    db.execute(
        PART, ("nulls1", "p1", None, None, None, None, None, None, None, 0, None, None, None)
    )


@pytest.fixture(params=[18, 13], ids=["from-18", "from-13"])
def db(tmp_path, request, caplog):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=request.param)
    _seed(db)
    with caplog.at_level("WARNING"):
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
        "bare1": "active",  # done but never closed: still open for a follow-up part
        "cont1": "done",
        "long1": "done",
        "open1": "active",
        "openerr1": "blocked",  # its last part failed, the job was not closed
        "retried1": "active",  # p1 failed but p2 ran after it: a later part reopens a goal
        "shut1": "cancelled",  # closed while still marked running
        "nulls1": "active",
    }
    run = work.get("run1")
    assert run.title == "Fix export"
    assert run.created_at == T
    assert run.input == {"watch": [{"text": "tests pass", "done": False}]}
    assert work.get("err1").input is None  # an unreadable watch list reads as none
    assert work.get("stop1").reported_at == "2026-01-01T09:30:00+00:00"  # closed_at
    assert work.get("stop1").ended_at == "2026-01-01T09:30:00+00:00"
    assert work.get("open1").ended_at is None and work.get("open1").end_reason is None
    assert work.get("open1").reported_at is None
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
    assert {"work", "work_job", "job_steps"} <= names
    assert db.execute("PRAGMA user_version").fetchone()[0] >= 19


def test_job_with_no_parts_migrates(work):
    assert work.get("bare1").state == "active"
    assert work.children("bare1") == []
    assert work.job_detail("bare1")["task"] == "no parts"


def test_nulls_in_every_optional_column_migrate(work):
    goal = work.get("nulls1")
    assert goal.title == "" and goal.state == "active" and goal.ended_at is None
    call = work.get("nulls1.p1")
    assert call.state == "cancelled" and call.title == "" and call.end_reason
    assert call.input == {"task": ""}


def test_every_row_is_kept(db):
    assert db.execute("SELECT count(*) FROM work WHERE kind='goal'").fetchone()[0] == 11
    assert db.execute("SELECT count(*) FROM work WHERE kind='expert_call'").fetchone()[0] == 11


def test_orphan_parts_are_counted_in_the_log(db, caplog):
    assert any("dropped 1 job part" in r.getMessage() for r in caplog.get_records("setup"))
    assert db.execute("SELECT count(*) FROM work WHERE id LIKE 'ghost%'").fetchone()[0] == 0


def test_ended_parts_have_no_progress(work):
    assert work.get("openerr1.p1").progress is None  # it ended, as at runtime
    assert work.get("run1.p2").progress == "editing"


def test_closed_state_survives_through_job_records(db):
    """An unclosed done job stays open; closed jobs keep their old closed_at and ended_at."""
    records = JobRecords(WorkStore(db, lambda: datetime(2026, 2, 1, tzinfo=UTC)), db, lambda: None)
    open1 = records.get_job("open1")
    assert (open1.closed_at, open1.ended_at, open1.state) == (
        None,
        "2026-01-04T07:10:00+00:00",
        "done",
    )
    records.add_part("open1", "claude-acp", "more", "C:/a")  # a follow-up is still allowed
    err = records.get_job("err1")
    assert (err.closed_at, err.ended_at, err.state) == (
        "2026-01-01T08:02:00+00:00",
        "2026-01-01T08:01:00+00:00",
        "failed",
    )
    stop = records.get_job("stop1")
    assert (stop.closed_at, stop.ended_at, stop.state) == (
        "2026-01-01T09:30:00+00:00",
        "2026-01-01T09:30:00+00:00",
        "cancelled",
    )


def _home(job):
    return {
        "state": home_state(job.state),
        "closed": job.closed_at,
        "parts": [(p.id, home_state(p.state), p.reason, p.session_id) for p in job.parts],
        "result": job.scout_result and job.scout_result[:20],
    }


def test_home_rows_after_the_migration_match_the_old_ones(db):
    """What Home showed for these jobs before (written out from the seeded rows) is what it shows
    now. A reason that only repeated its state word is no longer shown."""
    records = JobRecords(WorkStore(db, lambda: None), db, lambda: None)
    assert _home(records.get_job("run1")) == {
        "state": "running",
        "closed": None,
        "parts": [("p1", "done", None, "s-1"), ("p2", "running", None, None)],
        "result": None,
    }
    assert _home(records.get_job("err1")) == {
        "state": "error",
        "closed": "2026-01-01T08:02:00+00:00",
        "parts": [("p1", "error", "crashed", None)],
        "result": "gone wrong",
    }
    assert _home(records.get_job("stop1")) == {
        "state": "stopped",
        "closed": "2026-01-01T09:30:00+00:00",
        "parts": [("p1", "stopped", None, None)],
        "result": None,
    }
    assert _home(records.get_job("openerr1"))["state"] == "error"
    assert _home(records.get_job("cont1"))["state"] == "done"
    assert records.get_job("cont1").parent_job == "stop1"


@pytest.fixture
def db_from_11(tmp_path):
    """Jobs from before parts existed: one flat row each, 0013 makes their p1."""
    db = sqlite3.connect(tmp_path / "old11.db", isolation_level=None)
    migrate(db, upto=11)
    ins = (
        "INSERT INTO jobs(id, agent, task, folder, mode, state, reason, progress, result,"
        " session_id, reported, started_at, ended_at, parent_job, watch)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    db.execute(
        ins,
        ("old1", "claude-acp", "t", "C:/a", "ask", "done", "done", None, "fine", "s-9", 1, T)
        + ("2026-01-01T10:05:00+00:00", None, None),
    )
    db.execute(
        ins,
        ("old2", "claude-acp", "u", "C:/a", "ask", "running", None, "typing", None, None, 0, T)
        + (None, None, None),
    )
    migrate(db)
    yield db
    db.close()


def test_a_job_from_before_parts_gets_its_p1(db_from_11):
    records = JobRecords(WorkStore(db_from_11, lambda: None), db_from_11, lambda: None)
    old1, old2 = records.get_job("old1"), records.get_job("old2")
    assert [(p.id, p.state, p.session_id, p.report) for p in old1.parts] == [
        ("p1", "done", "s-9", "fine")
    ]
    assert old1.closed_at == "2026-01-01T10:05:00+00:00"  # 0013 closed every non-running job
    assert [(p.id, p.state) for p in old2.parts] == [("p1", "active")]
    assert old2.closed_at is None and old2.state == "active"


def test_closed_while_running_reads_as_stopped(work):
    goal = work.get("shut1")
    assert (goal.state, goal.end_reason) == ("cancelled", "stopped")
