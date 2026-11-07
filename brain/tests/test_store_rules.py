"""store/rules.py: one table for tool modes, standing preferences and offers."""

import pytest

from brain.store import rules
from brain.store.db import open_db

T = "2026-01-01T10:00:00+00:00"


@pytest.fixture
def db(tmp_path):
    return open_db(tmp_path / "t.db")


def test_set_permission_mode_upserts(db):
    rules.set_permission_mode(db, "x", "auto")
    rules.set_permission_mode(db, "x", "off")
    assert rules.permission_modes(db) == {"x": "off"}
    assert db.execute("SELECT COUNT(*) FROM rules WHERE kind='mode'").fetchone()[0] == 1


def test_removed_preference_not_listed(db):
    p = rules.add_preference(db, sentence="s", source=None, tool=None, group_key="g", at=T)
    assert rules.has_preference_for(db, "g")
    assert rules.remove_preference(db, p.id) is True
    assert rules.remove_preference(db, p.id) is False
    assert p.id not in [x.id for x in rules.list_preferences(db)]
    assert not rules.has_preference_for(db, "g")
    assert rules.edit_preference(db, p.id, "new") is False


def test_builtin_listed_first_and_not_a_user_preference(db):
    assert [p.builtin for p in rules.list_preferences(db)] == [True]
    assert not rules.has_user_preferences(db)
    rules.add_preference(db, sentence="mine", source=None, tool=None, group_key=None, at=T)
    assert rules.has_user_preferences(db)
    assert [p.builtin for p in rules.list_preferences(db)] == [True, False]


def test_use_and_edit_preference(db):
    p = rules.add_preference(db, sentence="s", source="app", tool="t", group_key="g", at=T)
    rules.use_preference(db, p.id, "2026-02-01T00:00:00+00:00")
    assert rules.edit_preference(db, p.id, "better") is True
    got = next(x for x in rules.list_preferences(db) if x.id == p.id)
    assert (got.sentence, got.use_count, got.last_used) == (
        "better",
        1,
        "2026-02-01T00:00:00+00:00",
    )


def test_offers_for_returns_outcome_words(db):
    rules.add_offer(db, "g", "2026-01-01T00:00:00+00:00", "keep_asking")
    rules.add_offer(db, "g", "2026-01-02T00:00:00+00:00", "no_answer")
    rules.add_offer(db, "other", "2026-01-03T00:00:00+00:00", "yes")
    assert rules.offers_for(db, "g") == [
        ("2026-01-02T00:00:00+00:00", "no_answer"),
        ("2026-01-01T00:00:00+00:00", "keep_asking"),
    ]


def test_offer_does_not_count_as_preference(db):
    rules.add_offer(db, "g", T, "yes")
    assert not rules.has_preference_for(db, "g")
