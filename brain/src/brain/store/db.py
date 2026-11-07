"""Open the database and bring it to the latest schema.

Migrations are numbered files in `migrations/` (`NNNN_name.sql` or `NNNN_name.py`), applied
in order. Each runs in one transaction together with its `user_version` bump, so a failure
leaves the file at the last good version. PRAGMAs live here because they are SQLite-only.
"""

import importlib.util
import re
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from brain.store import search

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_FILE = re.compile(r"^(\d{4})_(\w+)\.(sql|py)$")


@dataclass(frozen=True)
class Migration:
    number: int
    name: str
    sql: str | None
    run: Callable[[sqlite3.Connection], None] | None


def _load_py(path: Path) -> Callable[[sqlite3.Connection], None]:
    spec = importlib.util.spec_from_file_location(f"_migration_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise ValueError(f"cannot load migration {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    run = getattr(module, "migrate", None)
    if run is None:
        raise ValueError(f"migration {path.name} defines no migrate(db)")
    return run


def load_migrations(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    found: list[Migration] = []
    for path in sorted(directory.iterdir()):
        match = _FILE.match(path.name)
        if match is None:
            if path.suffix.lower() in (".sql", ".py") and path.name != "__init__.py":
                raise ValueError(f"misnamed migration file {path.name}: expected NNNN_name.sql/.py")
            continue
        number, name, kind = int(match[1]), match[2], match[3]
        if kind == "sql":
            found.append(Migration(number, name, path.read_text(encoding="utf-8"), None))
        else:
            found.append(Migration(number, name, None, _load_py(path)))
    for expected, migration in enumerate(found, 1):
        if migration.number < expected:
            raise ValueError(f"duplicate migration number {migration.number:04d}")
        if migration.number > expected:
            raise ValueError(f"gap in migration numbers before {migration.number:04d}")
    return found


def migrate(
    db: sqlite3.Connection,
    migrations: list[Migration] | None = None,
    upto: int | None = None,
) -> None:
    """Apply every migration newer than the file's version, up to `upto` when given.

    The connection must be in autocommit mode (isolation_level=None). A `.py` migration
    must not call executescript, which would commit the surrounding transaction.
    """
    if migrations is None:
        migrations = load_migrations()
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version > (migrations[-1].number if migrations else 0):
        raise RuntimeError("database is newer than this brain")
    for m in migrations:
        if m.number <= version or (upto is not None and m.number > upto):
            continue
        bump = f"PRAGMA user_version={m.number};"
        try:
            if m.sql is not None:
                db.executescript("BEGIN;" + m.sql + bump + "COMMIT;")
            else:
                assert m.run is not None
                db.execute("BEGIN")
                m.run(db)
                db.execute(bump)
                db.execute("COMMIT")
        except BaseException:
            if db.in_transaction:
                db.execute("ROLLBACK")
            raise


def open_db(path: Path | str) -> sqlite3.Connection:
    """Open (creating if needed) the database file at the latest schema, in WAL mode."""
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    # Autocommit; transactions are explicit where atomicity matters.
    db = sqlite3.connect(str(path), isolation_level=None)
    try:
        try:
            search.probe_fts5(db)
        except sqlite3.OperationalError as err:
            raise RuntimeError(f"This Python's SQLite has no FTS5 support: {err}") from err
        db.execute("PRAGMA journal_mode=WAL")
        migrate(db)
    except BaseException:
        db.close()
        raise
    return db


@contextmanager
def transaction(db: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """One write transaction: commit on success, roll back and re-raise on any error."""
    db.execute("BEGIN IMMEDIATE")
    try:
        yield db
    except BaseException:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")


def utc_text(at: datetime) -> str:
    """Whole seconds in UTC, so stored text sorts the same as the instants it names."""
    return at.astimezone(UTC).isoformat(timespec="seconds")
