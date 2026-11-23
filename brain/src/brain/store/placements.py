"""SQL for where an expert or app runs.

One row per placed name; placements.py resolves a row against the connected bodies.
"""

import sqlite3


def get_placement(
    db: sqlite3.Connection, kind: str, target_id: str
) -> tuple[str, str | None, str | None] | None:
    """(mode, body_id, prefer)."""
    return db.execute(
        "SELECT mode, body_id, prefer FROM placements WHERE target_kind=? AND target_id=?",
        (kind, target_id),
    ).fetchone()


def set_placement(
    db: sqlite3.Connection,
    kind: str,
    target_id: str,
    mode: str,
    body_id: str | None,
    prefer: str | None,
) -> None:
    db.execute(
        "INSERT OR REPLACE INTO placements(target_kind, target_id, mode, body_id, prefer)"
        " VALUES (?, ?, ?, ?, ?)",
        (kind, target_id, mode, body_id, prefer),
    )


def all_placements(
    db: sqlite3.Connection, kind: str
) -> list[tuple[str, str, str | None, str | None]]:
    """(target_id, mode, body_id, prefer) for every target of this kind."""
    return db.execute(
        "SELECT target_id, mode, body_id, prefer FROM placements WHERE target_kind=?", (kind,)
    ).fetchall()
