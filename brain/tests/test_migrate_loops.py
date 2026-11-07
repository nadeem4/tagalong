"""Migration 0023: loops, their surface log and cursors become work rows and app cursors.

Runs on a file seeded at version 21 with one loop per status, a surfaced loop with two anchors,
a snoozed loop that also has a deadline, and every form of cursor key a real file holds.
"""

import json
import sqlite3
from datetime import datetime, timedelta

import pytest

from brain.store.db import migrate
from brain.store.work import WorkStore

BEFORE = 22
T = "2026-01-01T10:00:00+00:00"
LATER = "2026-01-05T10:00:00+00:00"
DEADLINE = "2026-02-01T10:00:00+00:00"
SNOOZE = "2026-03-01T10:00:00+00:00"

LOOP = (
    "INSERT INTO loops(id, source, ref, title, asks, direction, people, due, quiet_after,"
    " anchors, status, history, created, updated, snoozed_until)"
    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
)


def _loop(db, id, status, **kw):
    row = dict(
        due=None, quiet=None, anchors=[], history=[], snooze=None, direction="i_owe", people=[]
    )
    row.update(kw)
    db.execute(
        LOOP,
        (
            id,
            "gmail",
            f"thread-{id}",
            f"title {id}",
            f"asks {id}",
            row["direction"],
            json.dumps(row["people"]),
            row["due"],
            row["quiet"],
            json.dumps(row["anchors"]),
            status,
            json.dumps(row["history"]),
            T,
            LATER,
            row["snooze"],
        ),
    )


def _seed(db):
    db.execute(
        "INSERT INTO apps(id, name, transport, config, auth, enabled) VALUES (?,?,?,?,?,?)",
        ("gmail", "Gmail", "http", "{}", "none", 1),
    )
    db.execute(
        "INSERT INTO apps(id, name, transport, config, auth, enabled) VALUES (?,?,?,?,?,?)",
        ("other", "Other", "http", "{}", "none", 1),
    )
    _loop(
        db,
        "held1",
        "held",
        due=DEADLINE,
        people=["sam@x.com"],
        direction="they_owe",
        quiet="2026-01-09T10:00:00+00:00",
    )
    _loop(
        db,
        "surf1",
        "surfaced",
        anchors=["Q4 deck", "Q4 sheet"],
        history=[
            {"at": T, "note": "mail from sam", "mail_at": "2026-01-01T09:00:00+00:00"},
            {"at": LATER, "note": "reader: new"},
        ],
    )
    _loop(db, "snz1", "snoozed", due=DEADLINE, snooze=SNOOZE)
    _loop(db, "done1", "done", snooze=SNOOZE)  # the old code never cleared a woken snooze
    _loop(db, "woke1", "held", snooze=SNOOZE)
    db.execute(
        "INSERT INTO work(id, root_id, seq, kind, state, title, created_at, updated_at)"
        " VALUES ('g1','g1',7,'goal','planned','a goal',?,?)",
        (T, T),
    )
    _loop(db, "drop1", "dropped")
    _loop(db, "stale1", "stale")
    db.execute(
        "INSERT INTO loop_surfaced(loop_id, anchor, day) VALUES ('surf1','Q4 deck','2026-01-04')"
    )
    db.execute(
        "INSERT INTO loop_surfaced(loop_id, anchor, day) VALUES ('surf1','due:x','2026-01-05')"
    )
    for key, value in [
        ("gmail", "2026-01-03T00:00:00+00:00"),
        ("sent:gmail", "2026-01-02T00:00:00+00:00"),
        ("backfill:gmail", "done"),
        ("on:gmail", "1"),
        ("on:ghost", "1"),
        ("digest:day", "2026-01-04"),
    ]:
        db.execute("INSERT INTO loop_cursor(app_id, value) VALUES (?, ?)", (key, value))


@pytest.fixture
def db(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    _seed(db)
    migrate(db)
    yield db
    db.close()


@pytest.fixture
def work(db):
    return WorkStore(db, lambda: None)


def _detail(db, id):
    return db.execute(
        "SELECT source, ref, direction, people, anchors, quiet_after, snoozed_until, asks"
        " FROM work_loop WHERE work_id = ?",
        (id,),
    ).fetchone()


def test_loop_statuses_map(work):
    got = {r.id: r for r in work.of_kind("loop")}
    assert set(got) == {"held1", "surf1", "snz1", "done1", "drop1", "stale1", "woke1"}
    assert [got[i].state for i in ("held1", "surf1", "snz1")] == ["planned"] * 3
    assert (got["done1"].state, got["drop1"].state, got["stale1"].state) == (
        "done",
        "cancelled",
        "expired",
    )
    assert got["stale1"].end_reason == "went quiet"
    for id in ("done1", "drop1", "stale1"):
        assert got[id].ended_at == LATER
        assert got[id].reported_at is not None  # loops never ask Scout for a report
    assert got["held1"].title == "title held1"
    assert (got["held1"].created_at, got["held1"].updated_at) == (T, LATER)
    assert got["held1"].root_id == "held1"


def test_snooze_and_due_both_kept(work, db):
    row = work.get("snz1")
    assert row.due_at == DEADLINE
    assert _detail(db, "snz1")[6] == SNOOZE
    assert work.get("held1").due_at == DEADLINE
    assert _detail(db, "held1")[6] is None


def test_detail_fields_copied(db):
    source, ref, direction, people, anchors, quiet, _snooze, asks = _detail(db, "held1")
    assert (source, ref, direction, asks) == ("gmail", "thread-held1", "they_owe", "asks held1")
    assert json.loads(people) == ["sam@x.com"]
    assert quiet == "2026-01-09T10:00:00+00:00"
    assert json.loads(_detail(db, "surf1")[4]) == ["Q4 deck", "Q4 sheet"]


def test_history_and_surfaced_become_events(work):
    events = work.events("surf1")
    history = [e for e in events if e.kind == "history"]
    assert [(e.at, e.data) for e in history] == [
        (T, {"note": "mail from sam", "mail_at": "2026-01-01T09:00:00+00:00"}),
        (LATER, {"note": "reader: new"}),
    ]
    surfaced = [e.data for e in events if e.kind == "surfaced"]
    assert surfaced == [
        {"anchor": "Q4 deck", "day": "2026-01-04"},
        {"anchor": "due:x", "day": "2026-01-05"},
    ]


def test_cursors_move_to_app_cursors(db):
    rows = db.execute("SELECT app_id, stream, value FROM app_cursors ORDER BY stream").fetchall()
    assert rows == [
        ("gmail", "backfill", "done"),
        ("gmail", "mail", "2026-01-03T00:00:00+00:00"),
        ("gmail", "sent", "2026-01-02T00:00:00+00:00"),
    ]


def test_on_key_sets_reads_mail(db):
    got = dict(db.execute("SELECT id, reads_mail FROM apps"))
    assert got == {"gmail": 1, "other": 0}  # "on:ghost" has no app row to switch on


def test_digest_watch_created(work, db):
    row = work.get("loop-digest")
    assert (row.kind, row.state, row.input) == ("watch", "planned", {"trigger": "return"})
    assert work.repeat_of("loop-digest") == 86400
    due = datetime.fromisoformat(row.due_at).astimezone()
    assert (due.hour, due.minute, due.second) == (0, 0, 0)
    assert (
        0
        < (due - datetime.now().astimezone()).total_seconds()
        <= timedelta(days=1, hours=1).total_seconds()
    )


def test_old_loop_tables_gone(db):
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert not tables & {"loops", "loop_surfaced", "loop_cursor"}
    assert {"work_loop", "app_cursors"} <= tables


def test_empty_database_still_gets_the_digest(tmp_path):
    db = sqlite3.connect(tmp_path / "fresh.db", isolation_level=None)
    migrate(db)
    assert WorkStore(db, lambda: None).get("loop-digest") is not None
    assert WorkStore(db, lambda: None).of_kind("loop") == []


def test_snooze_kept_only_for_snoozed_loops(db):
    assert _detail(db, "snz1")[6] == SNOOZE
    assert _detail(db, "woke1")[6] is None
    assert _detail(db, "done1")[6] is None


def test_loops_sit_after_existing_roots(db):
    seqs = dict(db.execute("SELECT id, seq FROM work WHERE parent_id IS NULL"))
    assert seqs["g1"] == 7
    loops = [seqs[i] for i in ("held1", "surf1", "snz1", "done1", "drop1", "stale1", "woke1")]
    assert min(loops) > 7 and len(set(loops)) == len(loops)
    assert seqs["loop-digest"] > max(loops)


def test_times_are_normalised_to_whole_seconds_utc(db):
    got = db.execute("SELECT created_at FROM work WHERE id = 'held1'").fetchone()[0]
    assert got == T  # already UTC, whole seconds: unchanged
