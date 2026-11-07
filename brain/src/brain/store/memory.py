"""Scout's long-term memory rows: the `memories` table and the rules for each kind.

The kinds table below is the only place caps and rules live. Refusals raise MemoryRefused
with a plain sentence the model reads and can act on; code never evicts items silently.
"""

import sqlite3
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Kind:
    name: str
    written_by: Literal["model", "code"]
    always_loaded: bool
    max_items: int | None
    max_chars: int | None


# Insertion order is the order kinds appear in the prompt.
KINDS: dict[str, Kind] = {
    k.name: k
    for k in (
        Kind("instruction", "model", True, 50, 300),
        Kind("about_you", "model", True, 50, 300),
        Kind("project", "model", False, 200, 500),
        Kind("summary", "code", False, None, None),
    )
}


class MemoryRefused(Exception):
    """A refusal whose str() is the message the model sees."""


@dataclass(frozen=True)
class Item:
    id: int
    kind: str
    text: str
    created_at: str
    updated_at: str


_COLUMNS = "id, kind, text, created_at, updated_at"


def _model_kinds() -> str:
    return ", ".join(k.name for k in KINDS.values() if k.written_by == "model")


def _item(db: sqlite3.Connection, item_id: int) -> Item | None:
    row = db.execute(f"SELECT {_COLUMNS} FROM memories WHERE id=?", (item_id,)).fetchone()
    return Item(*row) if row else None


def _validate(kind: str, text: str) -> tuple[Kind, str]:
    spec = KINDS.get(kind)
    if spec is None:
        raise MemoryRefused(f"Unknown kind '{kind}'. Use one of: {_model_kinds()}.")
    if spec.written_by != "model":
        raise MemoryRefused(f"'{kind}' is written by code, not by you. Use: {_model_kinds()}.")
    text = text.strip()
    if not text:
        raise MemoryRefused("The text is empty.")
    if spec.max_chars is not None and len(text) > spec.max_chars:
        raise MemoryRefused(
            f"That is {len(text)} characters; {kind} items are at most {spec.max_chars}."
        )
    return spec, text


def remember(
    db: sqlite3.Connection,
    kind: str,
    text: str,
    replaces: int | None,
    at: str,
) -> Item:
    spec, text = _validate(kind, text)
    db.execute("BEGIN IMMEDIATE")
    try:
        item = _write(db, spec, text, replaces, at)
    except BaseException:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")
    return item


def _write(
    db: sqlite3.Connection,
    spec: Kind,
    text: str,
    replaces: int | None,
    now: str,
) -> Item:
    twin = db.execute(
        "SELECT id FROM memories WHERE kind=? AND text=? AND id IS NOT ?",
        (spec.name, text, replaces),
    ).fetchone()
    if replaces is None:
        if twin:
            return _item(db, twin[0])  # type: ignore[return-value]
        count = db.execute("SELECT count(*) FROM memories WHERE kind=?", (spec.name,)).fetchone()[0]
        if spec.max_items is not None and count >= spec.max_items:
            raise MemoryRefused(
                f"{spec.name} is full ({spec.max_items}). "
                "Use replaces=<id> to update one or forget one first."
            )
        cur = db.execute(
            "INSERT INTO memories(kind, text, created_at, updated_at) VALUES (?,?,?,?)",
            (spec.name, text, now, now),
        )
        return _item(db, cur.lastrowid)  # type: ignore[arg-type,return-value]
    old = _item(db, replaces)
    if old is None or old.kind != spec.name:
        raise MemoryRefused(f"No {spec.name} memory with id {replaces} to replace.")
    if twin:
        # The new text already exists as another item: drop the old one, keep that one.
        db.execute("DELETE FROM memories WHERE id=?", (replaces,))
        return _item(db, twin[0])  # type: ignore[return-value]
    db.execute("UPDATE memories SET text=?, updated_at=? WHERE id=?", (text, now, replaces))
    return _item(db, replaces)  # type: ignore[return-value]


def forget(db: sqlite3.Connection, item_id: int) -> Item:
    item = _item(db, item_id)
    if item is None:
        raise MemoryRefused(f"no memory with id {item_id}.")
    db.execute("DELETE FROM memories WHERE id=?", (item_id,))
    return item


def list_items(db: sqlite3.Connection, limit: int) -> list[Item]:
    """Every kind, newest first (by last change); for Home's memory list."""
    rows = db.execute(
        f"SELECT {_COLUMNS} FROM memories ORDER BY updated_at DESC, id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [Item(*r) for r in rows]


def always_loaded(db: sqlite3.Connection) -> dict[str, list[Item]]:
    out: dict[str, list[Item]] = {}
    for spec in KINDS.values():
        if not spec.always_loaded:
            continue
        rows = db.execute(
            f"SELECT {_COLUMNS} FROM memories WHERE kind=? ORDER BY id", (spec.name,)
        ).fetchall()
        if rows:
            out[spec.name] = [Item(*r) for r in rows]
    return out


def add_summary(db: sqlite3.Connection, text: str, at: str) -> Item:
    """Code-written compaction summary, an episodic entry for the day; skips the model-write
    checks and caps."""
    cur = db.execute(
        "INSERT INTO memories(kind, text, created_at, updated_at, layer, period, span_start,"
        " span_end) VALUES ('summary',?,?,?,'episodic','day',?,?)",
        (text.strip(), at, at, at, at),
    )
    return _item(db, cur.lastrowid)  # type: ignore[arg-type,return-value]
