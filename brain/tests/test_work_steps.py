"""Tests for the job_steps rows on the work store: save, page by rev, trim to the per-job caps."""

from datetime import UTC, datetime

import pytest

from brain.store.db import open_db
from brain.store.work import ActivityEntry, WorkStore

NOW = datetime(2026, 1, 1, tzinfo=UTC)


@pytest.fixture
def mem(tmp_path):
    db = open_db(tmp_path / "t.db")
    yield WorkStore(db, lambda: NOW)
    db.close()


def test_job_steps_table_renamed(mem):
    names = {r[0] for r in mem.db.execute("SELECT name FROM sqlite_master")}
    assert {"job_steps", "job_steps_rev"} <= names
    assert "job_activity" not in names and "job_activity_rev" not in names


def _entry(rev, seq, kind="command", text="x", **kw):
    at = "2026-01-01T00:00:00+00:00"
    return ActivityEntry(rev=rev, seq=seq, at=at, kind=kind, text=text, **kw)


def test_activity_roundtrip_orders_by_rev(mem):
    for n in (3, 1, 2):
        mem.save_activity("j", _entry(n, n))
    assert [e.rev for e in mem.activity_after("j", 1, 10)] == [2, 3]
    assert [e.rev for e in mem.activity_after("j", 0, 2)] == [1, 2]


def test_save_activity_updates_in_place_by_seq(mem):
    mem.save_activity("j", _entry(1, 1, status="running"))
    mem.save_activity("j", _entry(2, 1, status="done", exit=0))
    [row] = mem.activity_after("j", 0, 10)
    assert (row.rev, row.status, row.exit) == (2, "done", 0)


def test_last_rev_and_jobs_with_activity(mem):
    assert mem.last_rev("none") == 0
    assert mem.jobs_with_activity() == set()
    mem.save_activity("j", _entry(4, 1))
    assert mem.last_rev("j") == 4
    assert mem.jobs_with_activity() == {"j"}


def test_trim_blanks_oldest_output_text_first(mem):
    mem.save_activity("j", _entry(1, 1, "command", "ls"))
    for n in (2, 3, 4):
        mem.save_activity("j", _entry(n, n, "output", "a" * 400, step="s"))
    mem.trim_activity("j", 2000, 500)
    rows = sorted(mem.activity_after("j", 0, 10), key=lambda r: r.seq)
    assert len(rows) == 4
    assert [r.text == "" for r in rows if r.kind == "output"] == [True, True, False]


def test_trim_deletes_oldest_rows_over_the_entry_cap_and_keeps_one_marker(mem):
    for n in range(1, 6):
        mem.save_activity("j", _entry(n, n))
    mem.trim_activity("j", 3, 10_000_000)
    rows = sorted(mem.activity_after("j", 0, 10), key=lambda r: r.seq)
    assert [r.seq for r in rows] == [0, 3, 4, 5]
    assert (rows[0].kind, rows[0].text, rows[0].rev) == ("other", "[older steps dropped]", 6)
    mem.trim_activity("j", 3, 10_000_000)
    assert len(mem.activity_after("j", 0, 10)) == 4


def test_activity_survives_reopen(tmp_path):
    db = open_db(tmp_path / "t.db")
    WorkStore(db, lambda: NOW).save_activity("j", _entry(1, 1, text="npm test"))
    db.close()
    db = open_db(tmp_path / "t.db")
    assert WorkStore(db, lambda: NOW).activity_after("j", 0, 10)[0].text == "npm test"
    db.close()


def test_trim_deletes_oversized_non_output_rows_by_bytes(mem):
    for n in (1, 2, 3):
        mem.save_activity("j", _entry(n, n, "say", "s" * 400))
    mem.trim_activity("j", 2000, 700)
    rows = sorted(mem.activity_after("j", 0, 10), key=lambda r: r.seq)
    assert [r.seq for r in rows] == [0, 3]
    assert sum(len(r.text.encode()) for r in rows) <= 700 + 100


def test_trim_deletes_the_least_recently_written_not_the_lowest_seq(mem):
    for n in (1, 2, 3):
        mem.save_activity("j", _entry(n, n))
    mem.save_activity("j", _entry(4, 1, text="updated"))  # seq 1 written last
    mem.trim_activity("j", 2, 10_000_000)
    rows = sorted(mem.activity_after("j", 0, 10), key=lambda r: r.seq)
    assert [r.seq for r in rows] == [0, 1, 3]


def test_blanking_output_bumps_rev_so_cursors_see_it(mem):
    mem.save_activity("j", _entry(1, 1, "output", "a" * 400, step="s"))
    mem.save_activity("j", _entry(2, 2, "output", "b" * 400, step="s"))
    mem.trim_activity("j", 2000, 500)
    changed = mem.activity_after("j", 2, 10)
    assert [(r.seq, r.text) for r in changed] == [(1, "")]
