"""Migration 0028: an installed app keeps whether it was Official or Community.

Runs on a file seeded at the version before it, with apps a real database has: one named by an
Official registry id, one by a third party's, and one added by hand with a plain name.
"""

import sqlite3

import pytest

from brain.store.db import migrate

BEFORE = 27


@pytest.fixture
def db(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    for app_id, name in [
        ("a", "com.notion/mcp"),
        ("b", "io.github.bob/notion-tools"),
        ("c", "My notes"),
    ]:
        db.execute(
            "INSERT INTO apps(id, name, transport, config, auth) VALUES (?,?,'http','{}','oauth')",
            (app_id, name),
        )
    migrate(db)
    return db


def test_migration_backfills_official_by_name(db):
    rows = db.execute("SELECT id, trust FROM apps ORDER BY id").fetchall()
    assert rows == [("a", "official"), ("b", "community"), ("c", "community")]


def test_trust_only_takes_the_two_values(db):
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE apps SET trust='trusted' WHERE id='a'")
