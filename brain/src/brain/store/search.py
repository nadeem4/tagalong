"""Full-text search helpers. FTS5 is SQLite-only, so it stays here, away from callers."""

import re
import sqlite3
from dataclasses import dataclass

from brain.store.memory import KINDS


@dataclass(frozen=True)
class Hit:
    ref: str
    kind: str
    at: str
    text: str


def probe_fts5(db: sqlite3.Connection) -> None:
    """Raise OperationalError when this Python's SQLite was built without FTS5."""
    db.execute("CREATE VIRTUAL TABLE temp._fts_probe USING fts5(x)")
    db.execute("DROP TABLE temp._fts_probe")


def fts_query(text: str) -> str:
    """Turn free text into a safe FTS5 query: quoted word tokens joined by OR."""
    return " OR ".join(f'"{w}"' for w in re.findall(r"\w+", text.lower()))


def search(db: sqlite3.Connection, query: str, kind: str | None, limit: int) -> list[Hit]:
    """Memory items and saved chat matching `query`; `kind` narrows to one kind or "chat"."""
    match = fts_query(query)
    if not match or (kind is not None and kind != "chat" and kind not in KINDS):
        return []
    hits: list[Hit] = []
    if kind != "chat":
        sql = (
            "SELECT m.id, m.kind, m.updated_at, m.text FROM memories_fts"
            " JOIN memories m ON m.id = memories_fts.rowid WHERE memories_fts MATCH ?"
        )
        args: list = [match]
        if kind is not None:
            sql += " AND m.kind = ?"
            args.append(kind)
        sql += " ORDER BY bm25(memories_fts) LIMIT ?"
        args.append(limit)
        hits = [Hit(str(i), k, at, t) for i, k, at, t in db.execute(sql, args)]
    if kind is None or kind == "chat":
        rows = db.execute(
            "SELECT m.id, m.at, m.text FROM messages_fts"
            " JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ?"
            " ORDER BY bm25(messages_fts) LIMIT ?",
            (match, limit - len(hits)),
        )
        hits += [Hit(f"chat:{i}", "chat", at, t) for i, at, t in rows]
    return hits
