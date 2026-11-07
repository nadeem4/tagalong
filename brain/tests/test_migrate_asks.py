"""Migration 0024: the approvals table becomes ended `ask` rows with a `work_ask` detail.

Runs on a file seeded at the last version before it, with the rows a real database has: every
outcome, an approval of a job that exists and of one that does not, a preference link that
still points at a preference and ones that point at nothing or at a mode rule that reused the
number.
"""

import json
import sqlite3

import pytest

from brain.store.db import migrate
from brain.store.work import WorkStore

BEFORE = 23


def approval(
    db, id, outcome, *, source="scout_tool", job=None, pref=None, sentence=None, by="person"
):
    db.execute(
        "INSERT INTO approvals(id, source, tool, summary, input, job_id, group_key, outcome,"
        " decided_by, preference_id, at, preference_sentence)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            id, source, f"t{id}", f"summary {id}", json.dumps({"n": id}), job, f"g{id}",
            outcome, by, pref, f"2026-01-0{id}T10:00:00+00:00", sentence,
        ),
    )  # fmt: skip


@pytest.fixture
def db(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    db.execute(
        "INSERT INTO work(id, root_id, seq, kind, state, title, created_at, updated_at)"
        " VALUES ('job1','job1',1,'goal','active','a goal','2026-01-01T00:00:00+00:00',"
        "'2026-01-01T00:00:00+00:00')"
    )
    # rule 1 is the built-in sentence rule; 50 is a mode rule that took an old preference's number
    db.execute(
        "INSERT INTO rules(id, kind, tool, effect, state, created_at)"
        " VALUES (50, 'mode', 'x', 'ask', 'active', '2026-01-01T00:00:00+00:00')"
    )
    approval(db, 1, "approved", source="claude_code", job="job1", pref=1, sentence="Always ask")
    approval(db, 2, "refused")
    approval(db, 3, "timed_out", by="none", source="app")
    approval(db, 4, "no_one", by="none", job="gone")
    approval(db, 5, "approved", by="scout", pref=50, sentence="was a preference")
    approval(db, 6, "approved", pref=99, sentence="deleted one")
    migrate(db)
    return db


def work(db):
    return WorkStore(db, lambda: None)


def test_approvals_become_ended_asks(db):
    got = {i: (work(db).get(f"a{i}").state, work(db).get(f"a{i}").end_reason) for i in range(1, 7)}
    assert got == {
        1: ("done", "approved"),
        2: ("cancelled", "refused"),
        3: ("expired", "timed_out"),
        4: ("expired", "no_one"),
        5: ("done", "approved"),
        6: ("done", "approved"),
    }
    row = work(db).get("a2")
    assert row.kind == "ask" and row.title == "summary 2"
    assert row.created_at == row.ended_at == row.reported_at == "2026-01-02T10:00:00+00:00"
    events = work(db).events("a2")
    assert [(e.kind, e.data) for e in events] == [
        ("decided", {"outcome": "refused", "decided_by": "person"})
    ]


def test_ask_ids_kept(db):
    rows = db.execute("SELECT id, work_id, tool FROM work_ask ORDER BY id").fetchall()
    assert rows == [(i, f"a{i}", f"t{i}") for i in range(1, 7)]
    one = db.execute("SELECT source, input, group_key, decided_by FROM work_ask WHERE id=1")
    assert one.fetchone() == ("claude_code", '{"n": 1}', "g1", "person")
    assert db.execute("SELECT source FROM work_ask WHERE id=3").fetchone() == ("app",)


def test_ask_parent_when_job_exists(db):
    assert work(db).get("a1").parent_id == "job1" and work(db).get("a1").root_id == "job1"
    assert work(db).get("a4").parent_id is None and work(db).get("a4").root_id == "a4"
    seqs = [work(db).get(f"a{i}").seq for i in (2, 3, 4)]
    assert seqs == sorted(set(seqs))  # roots are numbered one after another


def test_rule_link_kept(db):
    link = db.execute("SELECT rule_id, rule_sentence FROM work_ask WHERE id=1").fetchone()
    assert link == (1, "Always ask")
    assert db.execute("SELECT rule_id, rule_sentence FROM work_ask WHERE id=2").fetchone() == (
        None,
        None,
    )


def test_dangling_rule_link_is_dropped(db):
    # 50 is now a mode rule and 99 is nothing: neither may pass for a preference
    got = db.execute("SELECT rule_id, rule_sentence FROM work_ask WHERE id=5").fetchone()
    assert got == (None, "was a preference")
    assert db.execute("SELECT rule_id FROM work_ask WHERE id=6").fetchone() == (None,)


def test_approvals_table_gone(db):
    names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "approvals" not in names and "work_ask" in names
