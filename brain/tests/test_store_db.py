"""The store's database opening and numbered migrations.

Covers the runner (order, versions, rollback, python migrations) against real files in a
temp folder; no provider is involved.
"""

import sqlite3

import pytest

from brain.store import db as store_db
from brain.store.db import Migration, load_migrations, migrate, open_db, transaction, utc_text


def _version(db: sqlite3.Connection) -> int:
    return db.execute("PRAGMA user_version").fetchone()[0]


def test_migrations_are_numbered_without_gaps():
    assert [m.number for m in load_migrations()] == list(range(1, 18))


def test_fresh_file_reaches_latest(tmp_path):
    db = open_db(tmp_path / "t.db")
    assert _version(db) == 17
    columns = [r[1] for r in db.execute("PRAGMA table_info(loops)")]
    assert "snoozed_until" in columns
    db.close()


def test_old_file_upgrades(tmp_path):
    path = tmp_path / "t.db"
    old = sqlite3.connect(path, isolation_level=None)
    migrate(old, upto=5)
    old.execute(
        "INSERT INTO memories(kind,text,created_at,updated_at) VALUES('about_you','tea','a','a')"
    )
    old.close()
    db = open_db(path)
    assert _version(db) == 17
    assert db.execute("SELECT text FROM memories").fetchone()[0] == "tea"
    db.close()


def test_newer_file_refused(tmp_path):
    path = tmp_path / "t.db"
    other = sqlite3.connect(path)
    other.execute("PRAGMA user_version = 99")
    other.close()
    with pytest.raises(RuntimeError, match="newer"):
        open_db(path)


def test_failed_migration_rolls_back(tmp_path):
    db = sqlite3.connect(tmp_path / "r.db", isolation_level=None)
    migrations = [
        Migration(1, "a", "CREATE TABLE a(x);", None),
        Migration(2, "b", "CREATE TABLE half(x); CREATE TABLE half(x);", None),
    ]
    with pytest.raises(sqlite3.OperationalError):
        migrate(db, migrations)
    assert _version(db) == 1
    assert db.execute("SELECT name FROM sqlite_master WHERE name='half'").fetchall() == []
    db.close()


def test_py_migration_runs_in_transaction(tmp_path):
    (tmp_path / "0001_a.sql").write_text("CREATE TABLE t(x);")
    (tmp_path / "0002_x.py").write_text(
        "def migrate(db):\n"
        "    db.execute(\"INSERT INTO t VALUES ('half')\")\n"
        "    raise ValueError('boom')\n"
    )
    migrations = load_migrations(tmp_path)
    db = sqlite3.connect(tmp_path / "t.db", isolation_level=None)
    with pytest.raises(ValueError, match="boom"):
        migrate(db, migrations)
    assert _version(db) == 1
    assert db.execute("SELECT count(*) FROM t").fetchone()[0] == 0
    db.close()


def test_py_migration_success_bumps_version(tmp_path):
    (tmp_path / "0001_a.sql").write_text("CREATE TABLE t(x);")
    (tmp_path / "0002_x.py").write_text(
        "def migrate(db):\n    db.execute(\"INSERT INTO t VALUES ('ok')\")\n"
    )
    db = sqlite3.connect(tmp_path / "t.db", isolation_level=None)
    migrate(db, load_migrations(tmp_path))
    assert _version(db) == 2
    assert db.execute("SELECT x FROM t").fetchone()[0] == "ok"
    db.close()


def test_gap_in_numbers_refused(tmp_path):
    (tmp_path / "0001_a.sql").write_text("SELECT 1;")
    (tmp_path / "0003_b.sql").write_text("SELECT 1;")
    with pytest.raises(ValueError, match="gap"):
        load_migrations(tmp_path)


def test_duplicate_number_refused(tmp_path):
    (tmp_path / "0001_a.sql").write_text("SELECT 1;")
    (tmp_path / "0001_b.sql").write_text("SELECT 1;")
    with pytest.raises(ValueError, match="duplicate"):
        load_migrations(tmp_path)


def test_open_db_is_wal(tmp_path):
    db = open_db(tmp_path / "t.db")
    assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    db.close()


def test_utc_text_is_whole_seconds_in_utc():
    from datetime import UTC, datetime, timedelta, timezone

    at = datetime(2026, 1, 2, 3, 4, 5, 999, tzinfo=timezone(timedelta(hours=2)))
    assert utc_text(at) == "2026-01-02T01:04:05+00:00"
    assert utc_text(datetime(2026, 1, 2, tzinfo=UTC)) == "2026-01-02T00:00:00+00:00"


def test_transaction_commits_on_success(tmp_path):
    db = sqlite3.connect(tmp_path / "t.db", isolation_level=None)
    db.execute("CREATE TABLE t(x)")
    with transaction(db):
        db.execute("INSERT INTO t VALUES (1)")
    assert not db.in_transaction
    other = sqlite3.connect(tmp_path / "t.db")
    assert other.execute("SELECT count(*) FROM t").fetchone()[0] == 1
    other.close()
    db.close()


def test_transaction_rolls_back_and_reraises(tmp_path):
    db = sqlite3.connect(tmp_path / "t.db", isolation_level=None)
    db.execute("CREATE TABLE t(x)")
    with pytest.raises(ValueError, match="boom"):
        with transaction(db):
            db.execute("INSERT INTO t VALUES (1)")
            raise ValueError("boom")
    assert not db.in_transaction
    assert db.execute("SELECT count(*) FROM t").fetchone()[0] == 0
    db.close()


def test_failed_open_leaves_no_write_open(tmp_path, monkeypatch):
    path = tmp_path / "f.db"
    bad = [
        Migration(1, "a", "CREATE TABLE a(x);", None),
        Migration(2, "b", "CREATE TABLE h(x); CREATE TABLE h(x);", None),
    ]
    monkeypatch.setattr(store_db, "load_migrations", lambda: bad)
    with pytest.raises(sqlite3.OperationalError):
        open_db(path)
    other = sqlite3.connect(path, timeout=0.2, isolation_level=None)
    other.execute("BEGIN IMMEDIATE")
    other.execute("ROLLBACK")
    other.close()
    monkeypatch.undo()
    db = open_db(path)
    assert _version(db) == 17
    db.close()


@pytest.mark.parametrize(
    "name", ["18_work.sql", "0018-work.sql", "0018_work.txt.py", "0018_work.PY"]
)
def test_misnamed_migration_file_refused(tmp_path, name):
    (tmp_path / "0001_a.sql").write_text("SELECT 1;")
    (tmp_path / name).write_text("SELECT 1;")
    with pytest.raises(ValueError, match="misnamed"):
        load_migrations(tmp_path)


def test_support_files_are_not_migrations(tmp_path):
    (tmp_path / "0001_a.sql").write_text("SELECT 1;")
    (tmp_path / "__init__.py").write_text("")
    (tmp_path / "__pycache__").mkdir()
    (tmp_path / "README.md").write_text("notes")
    assert [m.number for m in load_migrations(tmp_path)] == [1]
