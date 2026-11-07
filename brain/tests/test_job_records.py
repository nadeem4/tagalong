"""JobRecords: jobs and their parts as goal and expert_call rows, read back as Job and JobPart.

Real temp database and a hand-moved clock; no expert is involved.
"""

import sys
from datetime import UTC, datetime, timedelta

import pytest

from brain.job_records import JobRecords, home_state
from brain.store.db import open_db
from brain.store.outputs import get_output
from brain.store.work import TransitionRefused, WorkStore

START = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.at = START

    def __call__(self) -> datetime:
        return self.at


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def db(tmp_path):
    return open_db(tmp_path / "t.db")


@pytest.fixture
def work(db, clock):
    return WorkStore(db, clock)


@pytest.fixture
def records(work, db, clock):
    return JobRecords(work, db, clock)


def test_add_job_and_part_round_trip(records):
    job = records.add_job("j1", "claude-acp", "fix it", "C:/a", "ask")
    assert (job.id, job.task, job.folder, job.mode, job.state) == (
        "j1",
        "fix it",
        "C:/a",
        "ask",
        "active",
    )
    assert job.title is None and job.watch is None and job.parent_job is None
    assert job.scout_result is None and job.closed_at is None and job.ended_at is None
    assert job.started_at == "2026-01-01T12:00:00+00:00"
    (part,) = job.parts
    assert (part.job_id, part.id, part.agent, part.task) == ("j1", "p1", "claude-acp", "fix it")
    assert (part.state, part.reason, part.report, part.reported) == ("active", None, None, False)
    assert part.folder == "C:/a" and part.session_id is None
    assert records.next_part_id("j1") == "p2"
    assert records.add_part("j1", "gemini", "check", "C:/b") == "p2"
    again = records.get_job("j1")
    assert [(p.id, p.agent, p.folder) for p in again.parts] == [
        ("p1", "claude-acp", "C:/a"),
        ("p2", "gemini", "C:/b"),
    ]
    assert records.parts_of("j1") == again.parts
    assert records.get_job("nope") is None


def test_update_part_state_uses_transition(records, work):
    records.add_job("j1", "claude-acp", "t", "C:/a", "ask")
    records.update_part("j1", "p1", state="done", reason="done", report="all good")
    (part,) = records.get_job("j1").parts
    assert (part.state, part.reason, part.report) == ("done", None, "all good")  # no news in "done"
    assert part.ended_at == "2026-01-01T12:00:00+00:00"
    with pytest.raises(TransitionRefused):  # a second writer finds it already ended
        records.update_part("j1", "p1", state="failed", reason="late")
    records.add_job("j2", "claude-acp", "t", "C:/a", "ask")
    records.update_part("j2", "p1", state="failed", reason="crashed")
    assert work.get("j2").state == "blocked"  # a failed part blocks its goal (the one rollup)
    with pytest.raises(ValueError, match="Unknown part fields"):
        records.update_part("j2", "p1", colour="red")


def test_a_refused_late_writer_leaves_the_report_alone(records):
    records.add_job("j1", "claude-acp", "t", "C:/a", "ask")
    records.update_part("j1", "p1", state="done", reason="done", report="first")
    with pytest.raises(TransitionRefused):
        records.update_part("j1", "p1", state="failed", reason="late", report="late words")
    assert records.get_job("j1").parts[0].report == "first"


def test_update_part_session_progress_and_reported(records, work):
    records.add_job("j1", "claude-acp", "t", "C:/a", "ask")
    records.update_part("j1", "p1", session_id="s-9", progress="x" * 3000)
    part = records.get_job("j1").parts[0]
    assert part.session_id == "s-9"
    assert part.progress == "x" * 2000  # a running tail
    records.update_part("j1", "p1", state="done", reason="done")
    assert not records.get_job("j1").parts[0].reported
    records.update_part("j1", "p1", reported=True)
    assert records.get_job("j1").parts[0].reported


def test_close_job_done_and_failed(records, work):
    records.add_job("j1", "claude-acp", "t", "C:/a", "ask")
    records.update_part("j1", "p1", state="done", reason="done")
    records.set_result("j1", "all fixed")
    records.close_job("j1")
    job = records.get_job("j1")
    assert work.get("j1").state == "done"
    assert job.closed_at == "2026-01-01T12:00:00+00:00"
    assert job.scout_result == "all fixed"  # closing keeps Scout's result
    assert job.state == "done"
    records.add_job("j2", "claude-acp", "t", "C:/a", "ask")
    records.update_part("j2", "p1", state="done", reason="done")
    records.close_job("j2", outcome="failed")
    assert work.get("j2").state == "failed"
    assert records.get_job("j2").state == "failed"


def test_long_report_stored_in_outputs(records, db, work):
    records.add_job("j1", "claude-acp", "t", "C:/a", "ask")
    big = "w" * 5000
    records.update_part("j1", "p1", state="done", reason="done", report=big)
    row = work.get("j1.p1")
    assert len(row.summary) == 2000 and row.detail_id is not None
    assert get_output(db, row.detail_id) == big
    assert records.get_job("j1").parts[0].report == big
    records.update_part("j1", "p1", report="short now")  # a shorter text drops the pointer
    assert work.get("j1.p1").detail_id is None
    assert records.get_job("j1").parts[0].report == "short now"
    records.set_result("j1", big)
    assert records.get_job("j1").scout_result == big


def test_running_jobs_means_active_part(records):
    records.add_job("a", "claude-acp", "t", "C:/a", "ask")
    records.add_job("b", "claude-acp", "t", "C:/a", "ask")
    records.update_part("a", "p1", state="done", reason="done")
    assert [j.id for j in records.running_jobs()] == ["b"]
    assert records.get_job("a").state == "done"  # the goal stays open, the job reads as done
    assert records.get_job("b").state == "active"


def test_home_state_mapping():
    assert [
        home_state(s) for s in ("active", "done", "failed", "cancelled", "blocked", "expired")
    ] == ["running", "done", "error", "stopped", "stopped", "stopped"]


def test_continued_job_event(records, work):
    records.add_job("j1", "claude-acp", "t", "C:/a", "ask")
    records.add_job("j2", "claude-acp", "again", "C:/a", "ask", parent_job="j1")
    assert records.get_job("j2").parent_job == "j1"
    assert records.get_job("j1").parent_job is None
    assert [e.data for e in work.events("j2") if e.kind == "continued"] == [{"from": "j1"}]


def test_job_ended_at_title_watch(records, clock):
    records.add_job("j1", "claude-acp", "t", "C:/a", "ask")
    records.set_title("j1", "T" * 300)
    records.set_watch("j1", [{"text": "tests", "done": False}])
    job = records.get_job("j1")
    assert job.title == "T" * 200 and job.watch == [{"text": "tests", "done": False}]
    clock.at += timedelta(minutes=5)
    records.update_part("j1", "p1", state="done", reason="done")
    assert records.get_job("j1").ended_at == "2026-01-01T12:05:00+00:00"
    records.set_watch("j1", None)
    assert records.get_job("j1").watch is None


def test_blocked_goal_reopens_when_a_part_is_added(records, work):
    records.add_job("j1", "claude-acp", "t", "C:/a", "ask")
    records.update_part("j1", "p1", state="failed", reason="crashed")
    assert work.get("j1").state == "blocked"
    records.add_part("j1", "claude-acp", "retry", "C:/a")
    assert work.get("j1").state == "active"
    assert records.get_job("j1").state == "active"


def test_list_jobs_newest_first_and_limited(records):
    for i in range(5):
        records.add_job(f"j{i}", "claude-acp", "t", "C:/a", "ask")
    assert [j.id for j in records.list_jobs(3)] == ["j4", "j3", "j2"]


def test_last_part_for_matches_agent_and_folder(records):
    records.add_job("a", "claude-acp", "t", "C:/a", "ask")
    records.update_part("a", "p1", session_id="s-a")
    assert records.last_part_for("claude-acp", "C:/a") is None  # still running
    records.update_part("a", "p1", state="done", reason="done")
    job, part = records.last_part_for("claude-acp", "C:/a")
    assert (job.id, part.id, part.session_id) == ("a", "p1", "s-a")
    assert records.last_part_for("gemini", "C:/a") is None
    assert records.last_part_for("claude-acp", "C:/other") is None


def test_unreported_jobs_and_mark_reported(records):
    records.add_job("run", "claude-acp", "t", "C:/a", "ask")
    records.add_job("fin", "claude-acp", "t", "C:/a", "ask")
    records.update_part("fin", "p1", state="done", reason="done")
    assert [j.id for j in records.unreported_jobs()] == ["fin"]  # a running job is not news
    records.mark_reported("fin")
    assert records.unreported_jobs() == []
    assert records.get_job("fin").parts[0].reported


def test_blocked_part_after_a_restart_is_news_with_its_reason(records, work):
    records.add_job("run", "claude-acp", "t", "C:/a", "ask")
    records.update_part("run", "p1", session_id="s1")
    records.add_job("fin", "claude-acp", "t", "C:/a", "ask")
    records.update_part("fin", "p1", state="done", reason="done")
    records.mark_reported("fin")
    assert work.resume_scan(lambda row: True) == [("run.p1", "blocked")]
    job = records.get_job("run")
    assert (job.state, job.parts[0].state, job.parts[0].reason) == (
        "blocked",
        "blocked",
        "brain restarted",
    )
    assert job.closed_at is None  # Scout can carry on
    assert [j.id for j in records.unreported_jobs()] == ["run"]


@pytest.mark.parametrize("state", ["cancelled", "failed"])
def test_last_part_for_counts_stopped_and_failed_parts(records, state):
    records.add_job("a", "claude-acp", "t", "C:/a", "ask")
    records.update_part("a", "p1", session_id="s-a")
    records.update_part("a", "p1", state=state, reason="x")
    job, part = records.last_part_for("claude-acp", "C:/a")
    assert (job.id, part.session_id) == ("a", "s-a")


def test_last_part_for_ignores_parts_without_a_session_and_picks_the_newest(records):
    records.add_job("a", "claude-acp", "t", "C:/a", "ask")
    records.update_part("a", "p1", state="done", reason="done")  # no session saved
    assert records.last_part_for("claude-acp", "C:/a") is None
    records.add_job("b", "claude-acp", "t", "C:/a", "ask")
    records.update_part("b", "p1", session_id="s-b", state="done", reason="done")
    records.add_job("c", "claude-acp", "t", "C:/a", "ask")
    records.update_part("c", "p1", session_id="s-c", state="done", reason="done")
    assert records.last_part_for("claude-acp", "C:/a")[0].id == "c"


def test_last_part_for_uses_the_parts_folder_and_expert_in_a_mixed_job(records):
    records.add_job("j", "codex", "t", "C:/a", "ask")
    records.add_part("j", "claude-acp", "t2", "C:/b")
    records.update_part("j", "p1", session_id="s-codex", state="done", reason="done")
    records.update_part("j", "p2", session_id="s-claude", state="done", reason="done")
    job, part = records.last_part_for("claude-acp", "C:/b")
    assert (job.id, part.id, part.session_id) == ("j", "p2", "s-claude")
    assert records.last_part_for("claude-acp", "C:/a") is None  # the job's folder is not p2's
    assert records.last_part_for("codex", "C:/a")[1].id == "p1"


def test_last_part_for_matches_folder_spelling_variants(records):
    records.add_job("a", "claude-acp", "t", "/a/b/", "ask")
    records.update_part("a", "p1", session_id="s", state="done", reason="done")
    assert records.last_part_for("claude-acp", "/a/b") is not None  # a trailing slash is nothing


@pytest.mark.skipif(sys.platform != "win32", reason="drive letters and case are Windows rules")
def test_last_part_for_matches_windows_folder_spellings(records):
    records.add_job("a", "claude-acp", "t", "C:/Proj/", "ask")
    records.update_part("a", "p1", session_id="s", state="done", reason="done")
    assert records.last_part_for("claude-acp", "C:/Proj") is not None
    assert records.last_part_for("claude-acp", "c:\\proj") is not None


def test_a_failed_part_keeps_its_reason(records):
    records.add_job("a", "claude-acp", "t", "C:/a", "ask")
    records.update_part("a", "p1", state="failed", reason="connection lost")
    assert records.get_job("a").parts[0].reason == "connection lost"
