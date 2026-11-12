"""Migration 0021: timers and tracking memories become timer and watch rows.

Runs on a file seeded at version 20 with the awkward rows a real database has: a fired one-off,
a timer tied to a job that is gone, and a cadence nobody can parse.
"""

import sqlite3

import pytest

from brain.store.db import migrate
from brain.store.search import search
from brain.store.work import WorkStore, parse_cadence

T = "2026-01-01T10:00:00+00:00"
TIMER = (
    "INSERT INTO timers(id, note, next_at, repeat_s, created_at, fired, job_id)"
    " VALUES (?,?,?,?,?,?,?)"
)
MEMORY = (
    "INSERT INTO memories(id, kind, text, cadence, created_at, updated_at) VALUES (?,?,?,?,?,?)"
)


def _seed(db):
    db.execute(
        "INSERT INTO work(id, root_id, seq, kind, state, title, created_at, updated_at)"
        " VALUES ('job1','job1',1,'goal','active','Fix export',?,?)",
        (T, T),
    )
    db.execute(TIMER, (1, "stretch", "2026-02-01T10:00:00+00:00", 3600, T, 0, None))
    db.execute(TIMER, (2, "fired one", "2026-01-02T10:00:00+00:00", None, T, 1, None))
    db.execute(TIMER, (3, "check the job", "2026-03-01T10:00:00+00:00", None, T, 0, "job1"))
    db.execute(TIMER, (4, "job is gone", "2026-03-01T10:00:00+00:00", None, T, 0, "ghost"))
    db.execute(MEMORY, (1, "tracking", "watch the build", "daily", T, T))
    db.execute(MEMORY, (2, "tracking", "check CI", "every 2 hours", T, T))
    db.execute(MEMORY, (3, "tracking", "watch the sky", "whenever it rains", T, T))
    db.execute(MEMORY, (4, "instruction", "be brief", None, T, T))


@pytest.fixture
def db(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=20)
    _seed(db)
    migrate(db, upto=21)
    yield db
    db.close()


@pytest.fixture
def work(db):
    return WorkStore(db, lambda: None)


def test_timers_become_timer_rows(work):
    rows = {r.id: r for r in work.of_kind("timer")}
    assert set(rows) == {"t1", "t2", "t3", "t4"}
    assert rows["t1"].title == "stretch"
    assert rows["t1"].state == "planned"
    assert rows["t1"].due_at == "2026-02-01T10:00:00+00:00"
    assert work.repeat_of("t1") == 3600
    assert work.repeat_of("t3") is None


def test_fired_one_off_stays_active_so_start_re_emits_it(work):
    row = work.get("t2")  # fired=1 on main: fired, but Scout's turn may never have started
    assert row.state == "active"
    assert (row.ended_at, row.end_reason, row.reported_at) == (None, None, None)


def test_timer_job_becomes_parent(work):
    linked = work.get("t3")
    assert (linked.parent_id, linked.root_id) == ("job1", "job1")
    orphan = work.get("t4")
    assert (orphan.parent_id, orphan.root_id) == (None, "t4")


def test_tracking_becomes_paused_watch(work):
    rows = {r.id: r for r in work.of_kind("watch")}
    assert set(rows) == {"w1", "w2", "w3"}
    assert (rows["w1"].state, rows["w1"].title, rows["w1"].reported_at) == (
        "paused",
        "watch the build",
        None,
    )
    assert work.repeat_of("w1") == 86400
    assert work.repeat_of("w2") == 7200


def test_unparsed_cadence_kept_in_input(work):
    row = work.get("w3")
    assert row.input == {"cadence": "whenever it rains"}
    assert work.repeat_of("w3") is None


def test_secret_in_tracking_text_is_masked(tmp_path):
    db = sqlite3.connect(tmp_path / "s.db", isolation_level=None)
    migrate(db, upto=20)
    db.execute(MEMORY, (1, "tracking", "use sk-ant-" + "a" * 30, None, T, T))
    migrate(db)
    assert "sk-ant" not in WorkStore(db, lambda: None).get("w1").title


def test_long_note_survives_in_input(tmp_path):
    db = sqlite3.connect(tmp_path / "l.db", isolation_level=None)
    migrate(db, upto=20)
    db.execute(TIMER, (1, "n" * 400, T, None, T, 0, None))
    migrate(db)
    row = WorkStore(db, lambda: None).get("t1")
    assert len(row.title) == 200
    assert row.input == {"note": "n" * 400}


def test_cadence_column_and_timers_table_gone(db):
    cols = [r[1] for r in db.execute("PRAGMA table_info(memories)")]
    assert "cadence" not in cols
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "timers" not in tables
    assert db.execute("SELECT count(*) FROM memories WHERE kind='tracking'").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM memories").fetchone()[0] == 1


def test_memory_search_still_works_after_the_column_drop(db):
    migrate(db)  # search reads columns added by later migrations
    assert [h.text for h in search(db, "brief", None, 5)] == ["be brief"]


@pytest.mark.parametrize(
    ("text", "seconds"),
    [
        ("daily", 86400),
        ("Hourly", 3600),
        (" weekly ", 604800),
        ("every 5 minutes", 300),
        ("every 1 minute", 60),
        ("every 2 hours", 7200),
        ("EVERY 3 days", 259200),
        ("every 2 weeks", 1209600),
        ("whenever it rains", None),
        ("every few hours", None),
        ("every 0 hours", None),
        ("", None),
        ("daily at noon", None),
    ],
)
def test_parse_cadence(text, seconds):
    assert parse_cadence(text) == seconds
