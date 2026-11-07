"""Full-text search helpers. FTS5 is SQLite-only, so it stays here, away from callers."""

import re
import sqlite3


def probe_fts5(db: sqlite3.Connection) -> None:
    """Raise OperationalError when this Python's SQLite was built without FTS5."""
    db.execute("CREATE VIRTUAL TABLE temp._fts_probe USING fts5(x)")
    db.execute("DROP TABLE temp._fts_probe")


def fts_query(text: str) -> str:
    """Turn free text into a safe FTS5 query: quoted word tokens joined by OR."""
    return " OR ".join(f'"{w}"' for w in re.findall(r"\w+", text.lower()))
