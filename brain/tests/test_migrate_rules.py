"""Migration 0021: permissions, preferences and offers become rows of one `rules` table.

Runs on a file seeded at the last version before it, with the rows a real database has: a tool
set to off, the built-in preference, a user preference with nulls, and an offer of every outcome.
"""

import sqlite3

import pytest

from brain.store import rules
from brain.store.db import migrate

T = "2026-01-01T10:00:00+00:00"
BEFORE = 20


@pytest.fixture
def db(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    for tool, mode in [("a", "auto"), ("b", "off"), ("c", "ask")]:
        db.execute("INSERT INTO permissions(tool, mode) VALUES (?,?)", (tool, mode))
    db.execute(
        "INSERT INTO preferences(id, sentence, source, tool, group_key, builtin, created_at,"
        " use_count, last_used)"
        " VALUES (7, 'Only small files', 'app', 'read', 'app:read', 0, ?, 3, ?)",
        (T, "2026-01-02T00:00:00+00:00"),
    )
    db.execute("INSERT INTO preferences(id, sentence, created_at) VALUES (9, 'Bare', ?)", (T,))
    for i, outcome in enumerate(["yes", "keep_asking", "none", "no_answer"]):
        db.execute(
            "INSERT INTO offers(group_key, at, outcome) VALUES ('g', ?, ?)",
            (f"2026-01-0{i + 1}T00:00:00+00:00", outcome),
        )
    migrate(db)
    return db


def test_permissions_become_mode_rules(db):
    assert rules.permission_modes(db) == {"a": "auto", "b": "off", "c": "ask"}
    row = db.execute("SELECT kind, effect, state FROM rules WHERE tool='b' AND kind='mode'")
    assert row.fetchone() == ("mode", "off", "active")


def test_preferences_keep_ids(db):
    by_id = {p.id: p for p in rules.list_preferences(db)}
    assert by_id[7].sentence == "Only small files"
    assert (by_id[7].source, by_id[7].tool, by_id[7].group_key) == ("app", "read", "app:read")
    assert (by_id[7].use_count, by_id[7].last_used) == (3, "2026-01-02T00:00:00+00:00")
    assert by_id[9].source is None and by_id[9].created_at == T
    assert any(p.builtin for p in by_id.values())


def test_offer_outcomes_map_states(db):
    got = db.execute(
        "SELECT effect, state, created_at, decided_at FROM rules WHERE kind='offer' ORDER BY id"
    ).fetchall()
    assert [(e, s) for e, s, _, _ in got] == [
        ("yes", "active"),
        ("keep_asking", "declined"),
        ("none", "declined"),
        ("no_answer", "offered"),
    ]
    assert all(c == d for _, _, c, d in got)


def test_old_rule_tables_gone(db):
    names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert not names & {"permissions", "preferences", "offers"}
    assert "rules" in names
