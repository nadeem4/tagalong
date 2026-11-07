"""Rules: a tool's off/ask/auto mode, standing preferences and offered preferences.

One `rules` table, told apart by `kind` (`mode`, `sentence`, `offer`). Removing a preference
sets its state to `removed`; the row stays so the log never points at nothing.
"""

import sqlite3
from dataclasses import dataclass


@dataclass(frozen=True)
class Preference:
    id: int
    sentence: str
    source: str | None
    tool: str | None
    group_key: str | None
    builtin: bool
    created_at: str
    use_count: int
    last_used: str | None


_ACTIVE = "kind='sentence' AND state='active'"


def permission_modes(db: sqlite3.Connection) -> dict[str, str]:
    return dict(db.execute("SELECT tool, effect FROM rules WHERE kind='mode'"))


def set_permission_mode(db: sqlite3.Connection, tool: str, mode: str) -> None:
    cur = db.execute("UPDATE rules SET effect=? WHERE kind='mode' AND tool=?", (mode, tool))
    if cur.rowcount == 0:
        db.execute(
            "INSERT INTO rules(kind, tool, effect, state, created_at)"
            " VALUES ('mode', ?, ?, 'active', strftime('%Y-%m-%dT%H:%M:%S+00:00','now'))",
            (tool, mode),
        )


def _preferences(db: sqlite3.Connection, where: str = "", args: tuple = ()) -> list[Preference]:
    rows = db.execute(
        "SELECT id, sentence, source, tool, group_key, builtin, created_at, use_count, last_used"
        f" FROM rules WHERE {_ACTIVE}{where} ORDER BY builtin DESC, id",
        args,
    ).fetchall()
    return [Preference(*r[:5], bool(r[5]), *r[6:]) for r in rows]


def add_preference(
    db: sqlite3.Connection,
    *,
    sentence: str,
    source: str | None,
    tool: str | None,
    group_key: str | None,
    at: str,
) -> Preference:
    cur = db.execute(
        "INSERT INTO rules(kind, sentence, source, tool, group_key, state, created_at)"
        " VALUES ('sentence', ?, ?, ?, ?, 'active', ?)",
        (sentence, source, tool, group_key, at),
    )
    return _preferences(db, " AND id=?", (cur.lastrowid,))[0]


def list_preferences(db: sqlite3.Connection) -> list[Preference]:
    return _preferences(db)


def remove_preference(db: sqlite3.Connection, id: int) -> bool:
    cur = db.execute(f"UPDATE rules SET state='removed' WHERE {_ACTIVE} AND id=?", (id,))
    return cur.rowcount > 0


def edit_preference(db: sqlite3.Connection, id: int, sentence: str) -> bool:
    cur = db.execute(f"UPDATE rules SET sentence=? WHERE {_ACTIVE} AND id=?", (sentence, id))
    return cur.rowcount > 0


def use_preference(db: sqlite3.Connection, id: int, at: str) -> None:
    db.execute(
        f"UPDATE rules SET use_count=use_count+1, last_used=? WHERE {_ACTIVE} AND id=?", (at, id)
    )


def has_user_preferences(db: sqlite3.Connection) -> bool:
    return bool(db.execute(f"SELECT 1 FROM rules WHERE {_ACTIVE} AND builtin=0").fetchone())


def has_preference_for(db: sqlite3.Connection, group_key: str) -> bool:
    row = db.execute(f"SELECT 1 FROM rules WHERE {_ACTIVE} AND group_key=?", (group_key,))
    return bool(row.fetchone())


_OFFER_STATE = {"yes": "active", "no_answer": "offered"}


def add_offer(db: sqlite3.Connection, group_key: str, at: str, outcome: str) -> None:
    state = _OFFER_STATE.get(outcome, "declined")
    db.execute(
        "INSERT INTO rules(kind, group_key, effect, state, decided_at, created_at)"
        " VALUES ('offer', ?, ?, ?, ?, ?)",
        (group_key, outcome, state, at, at),
    )


def offers_for(db: sqlite3.Connection, group_key: str) -> list[tuple[str, str]]:
    rows = db.execute(
        "SELECT created_at, effect FROM rules WHERE kind='offer' AND group_key=?"
        " ORDER BY created_at DESC, id DESC",
        (group_key,),
    ).fetchall()
    return [(a, o) for a, o in rows]
