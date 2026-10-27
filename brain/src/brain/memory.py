"""Scout's long-term memory: one SQLite file in the data folder.

The kinds table below is the only place caps and rules live. Refusals raise MemoryRefused
with a plain sentence the model reads and can act on; code never evicts items silently.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
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
        Kind("tracking", "model", True, 30, 300),
        Kind("project", "model", False, 200, 500),
        Kind("summary", "code", False, None, None),
    )
}

MIGRATIONS = (
    """
    CREATE TABLE memories(
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        cadence TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE memories_fts USING fts5(
        text, content='memories', content_rowid='id', tokenize='porter unicode61'
    );
    CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
    END;
    """,
)


class MemoryRefused(Exception):
    """A refusal whose str() is the message the model sees."""


@dataclass(frozen=True)
class Item:
    id: int
    kind: str
    text: str
    cadence: str | None
    created_at: str
    updated_at: str


_COLUMNS = "id, kind, text, cadence, created_at, updated_at"


def _probe_fts5(db: sqlite3.Connection) -> None:
    db.execute("CREATE VIRTUAL TABLE temp._fts_probe USING fts5(x)")
    db.execute("DROP TABLE temp._fts_probe")


def _model_kinds() -> str:
    return ", ".join(k.name for k in KINDS.values() if k.written_by == "model")


class Memory:
    def __init__(
        self,
        path: Path | str,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ):
        self._now = now
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # Autocommit; transactions are explicit where atomicity matters.
        self._db = sqlite3.connect(str(path), isolation_level=None)
        try:
            _probe_fts5(self._db)
        except sqlite3.OperationalError as err:
            self._db.close()
            raise RuntimeError(f"This Python's SQLite has no FTS5 support: {err}") from err
        self._db.execute("PRAGMA journal_mode=WAL")
        self._migrate()

    def _migrate(self) -> None:
        version = self._db.execute("PRAGMA user_version").fetchone()[0]
        if version > len(MIGRATIONS):
            self._db.close()
            raise RuntimeError(
                f"The memory file is from a newer version (schema {version}); update the brain."
            )
        for n in range(version, len(MIGRATIONS)):
            # One transaction per migration; the version bump commits with it.
            script = "BEGIN;" + MIGRATIONS[n] + f"PRAGMA user_version = {n + 1}; COMMIT;"
            self._db.executescript(script)

    def close(self) -> None:
        self._db.close()

    def _item(self, item_id: int) -> Item | None:
        row = self._db.execute(f"SELECT {_COLUMNS} FROM memories WHERE id=?", (item_id,)).fetchone()
        return Item(*row) if row else None

    def _validate(self, kind: str, text: str, cadence: str | None) -> tuple[Kind, str]:
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
        if cadence is not None and kind != "tracking":
            raise MemoryRefused("cadence is only for tracking items.")
        return spec, text

    def remember(
        self, kind: str, text: str, cadence: str | None = None, replaces: int | None = None
    ) -> Item:
        spec, text = self._validate(kind, text, cadence)
        now = self._now().isoformat()
        self._db.execute("BEGIN IMMEDIATE")
        try:
            item = self._write(spec, text, cadence, replaces, now)
        except BaseException:
            self._db.execute("ROLLBACK")
            raise
        self._db.execute("COMMIT")
        return item

    def _write(
        self, spec: Kind, text: str, cadence: str | None, replaces: int | None, now: str
    ) -> Item:
        twin = self._db.execute(
            "SELECT id FROM memories WHERE kind=? AND text=? AND id IS NOT ?",
            (spec.name, text, replaces),
        ).fetchone()
        if replaces is None:
            if twin:
                return self._item(twin[0])  # type: ignore[return-value]
            count = self._db.execute(
                "SELECT count(*) FROM memories WHERE kind=?", (spec.name,)
            ).fetchone()[0]
            if spec.max_items is not None and count >= spec.max_items:
                raise MemoryRefused(
                    f"{spec.name} is full ({spec.max_items}). "
                    "Use replaces=<id> to update one or forget one first."
                )
            cur = self._db.execute(
                "INSERT INTO memories(kind, text, cadence, created_at, updated_at)"
                " VALUES (?,?,?,?,?)",
                (spec.name, text, cadence, now, now),
            )
            return self._item(cur.lastrowid)  # type: ignore[arg-type,return-value]
        old = self._item(replaces)
        if old is None or old.kind != spec.name:
            raise MemoryRefused(f"No {spec.name} memory with id {replaces} to replace.")
        if twin:
            # The new text already exists as another item: drop the old one, keep that one.
            self._db.execute("DELETE FROM memories WHERE id=?", (replaces,))
            return self._item(twin[0])  # type: ignore[return-value]
        self._db.execute(
            "UPDATE memories SET text=?, cadence=?, updated_at=? WHERE id=?",
            (text, cadence, now, replaces),
        )
        return self._item(replaces)  # type: ignore[return-value]

    def forget(self, item_id: int) -> Item:
        item = self._item(item_id)
        if item is None:
            raise MemoryRefused(f"no memory with id {item_id}.")
        self._db.execute("DELETE FROM memories WHERE id=?", (item_id,))
        return item
