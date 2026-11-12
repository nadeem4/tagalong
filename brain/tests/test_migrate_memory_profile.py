"""Migration 0033: memory rows gain provenance columns, and forgotten facts are remembered.

Seeds a file at the version before it, then checks old rows read as chat and free, the
dismissed table's key, and the pure tag rules and kinds that go with it.
"""

import sqlite3

import pytest

from brain.know.facts import normalise_tag, visibility_for
from brain.store.db import migrate
from brain.store.memory import KINDS


def test_old_rows_default_to_chat_free(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=32)
    db.execute(
        "INSERT INTO memories(kind,text,created_at,updated_at) VALUES('about_you','tea','a','a')"
    )
    migrate(db)
    row = db.execute("SELECT source, tag, visibility, evidence FROM memories").fetchone()
    assert row == ("chat", "", "free", None)


def test_memory_dismissed_table_exists(tmp_path):
    db = sqlite3.connect(tmp_path / "n.db", isolation_level=None)
    migrate(db)
    db.execute("INSERT INTO memory_dismissed(source, evidence) VALUES ('github','x')")
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO memory_dismissed(source, evidence) VALUES ('github','x')")


def test_visibility_for_tags():
    for tag in ("work", "skills", "projects", "interests"):
        assert visibility_for(tag) == "free"
    for tag in ("personal", "family", ""):
        assert visibility_for(tag) == "asked"


def test_normalise_tag():
    assert normalise_tag(" Side Projects ") == "side_projects"
    assert normalise_tag("") == "other"
    assert len(normalise_tag("x" * 50)) == 20


def test_profile_and_portrait_kinds():
    assert KINDS["profile"].max_items == 500
    assert KINDS["portrait"].always_loaded
    assert KINDS["portrait"].max_chars == 1500
    assert KINDS["profile"].written_by == KINDS["portrait"].written_by == "code"
