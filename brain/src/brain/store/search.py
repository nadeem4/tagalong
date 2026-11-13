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
    category: str = ""
    span: str = ""


def span_text(start: str | None, end: str | None) -> str:
    """A fact's years as people say them: "2019", "2019–2021" or "since 2019"."""
    if not start:
        return ""
    start = start[:4]
    if not end:
        return f"since {start}"
    end = end[:4]
    return start if end == start else f"{start}–{end}"


def _year_filters(
    year: int | None, from_year: int | None, to_year: int | None
) -> tuple[list[str], list]:
    """SQL conditions and args for a span overlap; a fact with no end is still true."""
    lo, hi = (year, year) if year is not None else (from_year, to_year)
    conds: list[str] = []
    args: list = []
    if lo is not None or hi is not None:
        conds.append("m.span_start IS NOT NULL")
    if hi is not None:
        conds.append("CAST(substr(m.span_start,1,4) AS INTEGER) <= ?")
        args.append(hi)
    if lo is not None:
        conds.append("(m.span_end IS NULL OR CAST(substr(m.span_end,1,4) AS INTEGER) >= ?)")
        args.append(lo)
    return conds, args


def probe_fts5(db: sqlite3.Connection) -> None:
    """Raise OperationalError when this Python's SQLite was built without FTS5."""
    db.execute("CREATE VIRTUAL TABLE temp._fts_probe USING fts5(x)")
    db.execute("DROP TABLE temp._fts_probe")


def fts_query(text: str) -> str:
    """Turn free text into a safe FTS5 query: quoted word tokens joined by OR."""
    return " OR ".join(f'"{w}"' for w in re.findall(r"\w+", text.lower()))


def search(
    db: sqlite3.Connection,
    query: str,
    kind: str | None,
    limit: int,
    include_personal: bool = False,
    year: int | None = None,
    from_year: int | None = None,
    to_year: int | None = None,
    category: str | None = None,
) -> list[Hit]:
    """Memory items, saved chat and work (jobs, steps) matching `query`; `kind` narrows to one
    memory kind, "chat" or "work". Personal (asked) facts only come back with
    `include_personal`; the portrait never does, it is already in the prompt.

    A year, range or category narrows to dated or categorised memory facts (never chat, work or
    summaries, whose timestamps are days); with no words the filter alone lists them by date."""
    match = fts_query(query)
    conds, fargs = _year_filters(year, from_year, to_year)
    if category and category.strip():
        conds.append("m.category = ? COLLATE NOCASE")
        fargs.append(category.strip())
    filtered = bool(conds)
    bad_kind = kind is not None and kind not in ("chat", "work") and kind not in KINDS
    if (not match and not filtered) or bad_kind:
        return []
    hits: list[Hit] = []
    if kind not in ("chat", "work"):
        cols = "m.id, m.kind, m.updated_at, m.text, m.category, m.span_start, m.span_end"
        if match:
            sql = (
                f"SELECT {cols} FROM memories_fts"
                " JOIN memories m ON m.id = memories_fts.rowid WHERE memories_fts MATCH ?"
            )
            args: list = [match]
        else:
            sql = f"SELECT {cols} FROM memories m WHERE 1=1"
            args = []
        sql += " AND m.kind != 'portrait'"
        if filtered:
            sql += " AND m.kind != 'summary'"
        if not include_personal:
            sql += " AND m.visibility = 'free'"
        for c in conds:
            sql += f" AND {c}"
        args += fargs
        if kind is not None:
            sql += " AND m.kind = ?"
            args.append(kind)
        sql += " ORDER BY bm25(memories_fts)" if match else " ORDER BY m.span_start, m.id"
        sql += " LIMIT ?"
        args.append(limit)
        hits = [
            Hit(str(i), k, at, t, c or "", span_text(s, e))
            for i, k, at, t, c, s, e in db.execute(sql, args)
        ]
    if filtered:
        return hits
    if kind is None or kind == "work":
        rows = db.execute(
            "SELECT w.id, w.updated_at, w.title FROM work_fts"
            " JOIN work w ON w.rowid = work_fts.rowid WHERE work_fts MATCH ?"
            " ORDER BY bm25(work_fts) LIMIT ?",
            (match, limit - len(hits)),
        )
        hits += [Hit(i, "work", at, t) for i, at, t in rows]
    if kind is None or kind == "chat":
        rows = db.execute(
            "SELECT m.id, m.at, m.text FROM messages_fts"
            " JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ?"
            " ORDER BY bm25(messages_fts) LIMIT ?",
            (match, limit - len(hits)),
        )
        hits += [Hit(f"chat:{i}", "chat", at, t) for i, at, t in rows]
    return hits
