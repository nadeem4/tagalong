"""Scout's long-term memory rows: the `memories` table and the rules for each kind.

The kinds table below is the only place caps and rules live. Refusals raise MemoryRefused
with a plain sentence the model reads and can act on; code never evicts items silently.
"""

import sqlite3
from dataclasses import dataclass
from typing import Literal

from brain.know.facts import TAG_VISIBILITY, normalise_tag, visibility_for


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
        Kind("profile", "code", False, 500, 500),
        Kind("portrait", "code", True, 1, 1500),
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
    tag: str = ""
    source: str = "chat"
    source_ref: str | None = None
    evidence: str | None = None
    visibility: str = "free"
    category: str | None = None
    span_start: str | None = None
    span_end: str | None = None


_COLUMNS = (
    "id, kind, text, created_at, updated_at, tag, source, source_ref, evidence, visibility,"
    " category, span_start, span_end"
)


def _span_columns(start: str | None) -> tuple[str, str | None]:
    """Layer and period for a fact: dated facts are episodic by year, the rest stay core."""
    return ("episodic", "year") if start else ("core", None)


def normalise(text: str) -> str:
    """Whitespace collapsed and case folded: how evidence and duplicates are compared."""
    return " ".join(text.split()).casefold()


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
    tag: str = "",
    evidence: str | None = None,
    category: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> Item:
    spec, text = _validate(kind, text)
    db.execute("BEGIN IMMEDIATE")
    try:
        item = _write(db, spec, text, replaces, at, tag, evidence, category, start, end)
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
    tag: str = "",
    evidence: str | None = None,
    category: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> Item:
    # A chat fact with no tag stays free; a tag decides (personal is asked).
    tag = normalise_tag(tag) if tag.strip() else ""
    visibility = visibility_for(tag) if tag else "free"
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
        layer, period = _span_columns(start)
        cur = db.execute(
            "INSERT INTO memories(kind, text, created_at, updated_at, tag, evidence, visibility,"
            " category, layer, period, span_start, span_end) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (spec.name, text, now, now, tag, evidence, visibility, category, layer, period)
            + (start, end if start else None),
        )
        return _item(db, cur.lastrowid)  # type: ignore[arg-type,return-value]
    old = _item(db, replaces)
    if old is None or old.kind != spec.name:
        raise MemoryRefused(f"No {spec.name} memory with id {replaces} to replace.")
    if twin:
        # The new text already exists as another item: drop the old one, keep that one.
        db.execute("DELETE FROM memories WHERE id=?", (replaces,))
        return _item(db, twin[0])  # type: ignore[return-value]
    # Dates and category change only when passed; a new start replaces the old span whole.
    if start:
        layer, period = _span_columns(start)
        span = (start, end)
    else:
        layer, period = _span_columns(old.span_start)
        span = (old.span_start, old.span_end)
    db.execute(
        "UPDATE memories SET text=?, updated_at=?, tag=?, evidence=?, visibility=?, category=?,"
        " layer=?, period=?, span_start=?, span_end=? WHERE id=?",
        (
            text,
            now,
            tag or old.tag,
            evidence or old.evidence,
            visibility if tag else old.visibility,
            category or old.category,
            layer,
            period,
            *span,
            replaces,
        ),
    )
    return _item(db, replaces)  # type: ignore[return-value]


def forget(db: sqlite3.Connection, item_id: int) -> Item:
    item = _item(db, item_id)
    if item is None:
        raise MemoryRefused(f"no memory with id {item_id}.")
    if item.kind == "portrait":
        raise MemoryRefused(
            "The portrait is rewritten, not deleted: correct a fact or run get to know me again."
        )
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("DELETE FROM memories WHERE id=?", (item_id,))
        if item.kind == "profile" and item.evidence:
            # Remembered per source so a later run does not bring the forgotten fact back.
            db.execute(
                "INSERT OR IGNORE INTO memory_dismissed(source, evidence) VALUES (?,?)",
                (item.source, normalise(item.evidence)),
            )
    except BaseException:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")
    return item


@dataclass(frozen=True)
class NewFact:
    tag: str
    text: str
    evidence: str
    source_ref: str
    category: str | None = None
    start: str | None = None
    end: str | None = None


def save_source_facts(
    db: sqlite3.Connection, source: str, facts: list[NewFact], at: str
) -> list[Item]:
    """Replace one source's profile facts. Facts the person forgot, ones another source
    already holds and any past the cap are skipped."""
    cap = KINDS["profile"].max_items or 0
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("DELETE FROM memories WHERE kind='profile' AND source=?", (source,))
        dismissed = {
            r[0]
            for r in db.execute("SELECT evidence FROM memory_dismissed WHERE source=?", (source,))
        }
        known = {
            normalise(r[0]) for r in db.execute("SELECT text FROM memories WHERE kind='profile'")
        }
        count = len(known)
        saved: list[Item] = []
        max_chars = KINDS["profile"].max_chars or 0
        for f in facts:
            text = f.text.strip()
            if not text or len(text) > max_chars:
                continue
            key = normalise(text)
            if normalise(f.evidence) in dismissed or key in known:
                continue
            if count >= cap:
                break
            tag = normalise_tag(f.tag)
            layer, period = _span_columns(f.start)
            cur = db.execute(
                "INSERT INTO memories(kind, text, created_at, updated_at, tag, source,"
                " source_ref, evidence, visibility, category, layer, period, span_start,"
                " span_end) VALUES ('profile',?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (text, at, at, tag, source, f.source_ref, f.evidence, visibility_for(tag))
                + (f.category, layer, period, f.start, f.end if f.start else None),
            )
            known.add(key)
            count += 1
            saved.append(_item(db, cur.lastrowid))  # type: ignore[arg-type]
    except BaseException:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")
    return saved


def profile_facts(db: sqlite3.Connection, include_asked: bool = True) -> list[Item]:
    sql = f"SELECT {_COLUMNS} FROM memories WHERE kind='profile'"
    if not include_asked:
        sql += " AND visibility='free'"
    return [Item(*r) for r in db.execute(sql + " ORDER BY id")]


@dataclass(frozen=True)
class Shape:
    """What the prompt may say about the saved facts: the years they cover and their categories,
    free facts only. Computed per call, never cached, so a forgotten fact vanishes at once."""

    years: tuple[str, str] | None
    categories: list[tuple[str, int]]


def shape(db: sqlite3.Connection) -> Shape:
    where = "kind IN ('profile','about_you') AND visibility='free'"
    low, high = db.execute(
        "SELECT MIN(substr(span_start,1,4)),"
        " MAX(substr(COALESCE(span_end, span_start),1,4)) FROM memories"
        f" WHERE {where} AND span_start IS NOT NULL"
    ).fetchone()
    rows = db.execute(
        f"SELECT category, COUNT(*) AS n FROM memories WHERE {where}"
        " AND category IS NOT NULL AND category != '' GROUP BY category ORDER BY n DESC, category"
    )
    return Shape((low, high) if low else None, [(c, n) for c, n in rows])


def categories_in_use(db: sqlite3.Connection) -> list[str]:
    """Distinct categories over facts, so extraction can reuse one. Asked facts count too: this
    only guides the extractor and never reaches the prompt."""
    rows = db.execute(
        "SELECT DISTINCT category FROM memories WHERE kind IN ('profile','about_you')"
        " AND category IS NOT NULL AND category != '' ORDER BY category"
    )
    return [r[0] for r in rows]


def asked_topics(db: sqlite3.Connection) -> list[str]:
    """Topics of the asked facts, never their text: the prompt may name what is held, not say it.
    A tag the model made up could itself carry the fact, so only known tags are named; any
    other shows as personal."""
    rows = db.execute(
        "SELECT DISTINCT tag FROM memories WHERE kind IN ('profile','about_you')"
        " AND visibility='asked'"
    )
    return sorted({r[0] if r[0] in TAG_VISIBILITY else "personal" for r in rows})


def chat_facts(db: sqlite3.Connection) -> list[Item]:
    """Free facts the person told Scout in chat (about_you); asked ones stay out."""
    sql = (
        f"SELECT {_COLUMNS} FROM memories WHERE kind='about_you' AND visibility='free' ORDER BY id"
    )
    return [Item(*r) for r in db.execute(sql)]


def set_portrait(db: sqlite3.Connection, text: str, at: str) -> Item:
    text = text.strip()
    cap = KINDS["portrait"].max_chars or 0
    if not text:
        raise MemoryRefused("The portrait is empty.")
    if len(text) > cap:
        raise MemoryRefused(f"That is {len(text)} characters; the portrait is at most {cap}.")
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("DELETE FROM memories WHERE kind='portrait'")
        cur = db.execute(
            "INSERT INTO memories(kind, text, created_at, updated_at, source) VALUES"
            " ('portrait',?,?,?,'know')",
            (text, at, at),
        )
    except BaseException:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")
    return _item(db, cur.lastrowid)  # type: ignore[arg-type,return-value]


def get_portrait(db: sqlite3.Connection) -> Item | None:
    row = db.execute(f"SELECT {_COLUMNS} FROM memories WHERE kind='portrait'").fetchone()
    return Item(*row) if row else None


def list_items(db: sqlite3.Connection, limit: int) -> list[Item]:
    """Every kind but the portrait, newest first (by last change); for Home's memory list."""
    rows = db.execute(
        f"SELECT {_COLUMNS} FROM memories WHERE kind != 'portrait'"
        " ORDER BY updated_at DESC, id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [Item(*r) for r in rows]


def always_loaded(db: sqlite3.Connection) -> dict[str, list[Item]]:
    out: dict[str, list[Item]] = {}
    for spec in KINDS.values():
        if not spec.always_loaded:
            continue
        rows = db.execute(
            f"SELECT {_COLUMNS} FROM memories WHERE kind=? AND visibility='free' ORDER BY id",
            (spec.name,),
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
