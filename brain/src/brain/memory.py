"""Scout's long-term memory: one SQLite file in the data folder.

The kinds table below is the only place caps and rules live. Refusals raise MemoryRefused
with a plain sentence the model reads and can act on; code never evicts items silently.
"""

import json
import re
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from brain.apps import AppRow


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
    # Saved chat. Images and documents never land here; see _clean_block.
    """
    CREATE TABLE messages(
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        role TEXT NOT NULL,
        content_json TEXT NOT NULL,
        text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE messages_fts USING fts5(
        text, content='messages', content_rowid='id', tokenize='porter unicode61'
    );
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
    END;
    """,
    # Per-tool permission choice; no row means the tool's default applies.
    """
    CREATE TABLE permissions(
        tool TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('ask','auto'))
    );
    """,
    # Expert jobs (Claude Code hand-offs). Rows still running at brain start become stopped.
    """
    CREATE TABLE jobs(
        id TEXT PRIMARY KEY,
        agent TEXT, task TEXT, folder TEXT, mode TEXT,
        state TEXT, reason TEXT, progress TEXT, result TEXT, session_id TEXT,
        reported INTEGER DEFAULT 0,
        started_at TEXT, ended_at TEXT
    );
    """,
    # Connected apps (MCP servers). config holds transport details as JSON; tokens never live here.
    """
    CREATE TABLE apps(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK(transport IN ('stdio','http')),
        config TEXT NOT NULL,
        auth TEXT NOT NULL CHECK(auth IN ('none','token','oauth')),
        enabled INTEGER NOT NULL DEFAULT 1
    );
    """,
    # Scout's timers. next_at is UTC ISO text so text order equals time order; fired marks
    # one-offs that already woke Scout (kept, so a restart never replays them).
    """
    CREATE TABLE timers(
        id INTEGER PRIMARY KEY,
        note TEXT NOT NULL,
        next_at TEXT NOT NULL,
        repeat_s INTEGER,
        created_at TEXT NOT NULL,
        fired INTEGER NOT NULL DEFAULT 0
    );
    """,
    # Learned approvals. approvals is the audit log of every ask; preferences are the person's
    # sentences (the one builtin default is seeded here, so deleting it sticks); offers record
    # each "want me to handle these?" so Scout does not nag.
    """
    CREATE TABLE approvals(
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('scout_tool','claude_code','app')),
        tool TEXT NOT NULL,
        summary TEXT NOT NULL,
        input TEXT NOT NULL,
        job_id TEXT,
        group_key TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('approved','refused','timed_out','no_one')),
        decided_by TEXT NOT NULL CHECK(decided_by IN ('person','scout','none')),
        preference_id INTEGER,
        at TEXT NOT NULL
    );
    CREATE TABLE preferences(
        id INTEGER PRIMARY KEY,
        sentence TEXT NOT NULL,
        source TEXT,
        tool TEXT,
        group_key TEXT,
        builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used TEXT
    );
    CREATE TABLE offers(
        id INTEGER PRIMARY KEY,
        group_key TEXT NOT NULL,
        at TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('yes','keep_asking','no_answer','none'))
    );
    INSERT INTO preferences(sentence, builtin, created_at)
        VALUES ('Always ask me before risky actions', 1, strftime('%Y-%m-%dT%H:%M:%S+00:00','now'));
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


@dataclass(frozen=True)
class Job:
    id: str
    agent: str
    task: str
    folder: str
    mode: str
    state: str
    reason: str | None
    progress: str | None
    result: str | None
    session_id: str | None
    reported: bool
    started_at: str
    ended_at: str | None


@dataclass(frozen=True)
class Timer:
    id: int
    note: str
    next_at: datetime
    repeat_s: int | None
    created_at: str
    fired: bool


@dataclass(frozen=True)
class Approval:
    id: int
    source: str
    tool: str
    summary: str
    input: dict
    job_id: str | None
    group_key: str
    outcome: str
    decided_by: str
    preference_id: int | None
    at: str


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


@dataclass(frozen=True)
class Hit:
    ref: str
    kind: str
    at: str
    text: str


_COLUMNS = "id, kind, text, cadence, created_at, updated_at"
_JOB_COLUMNS = (
    "id, agent, task, folder, mode, state, reason, progress, result, session_id,"
    " reported, started_at, ended_at"
)
_JOB_FIELDS = {c.strip() for c in _JOB_COLUMNS.split(",")} - {"id"}
JOB_RESULT_CAP = 20_000
JOB_PROGRESS_CAP = 2_000


def _utc_text(at: datetime) -> str:
    """Whole seconds in UTC, so stored text sorts the same as the instants it names."""
    return at.astimezone(UTC).isoformat(timespec="seconds")


def _probe_fts5(db: sqlite3.Connection) -> None:
    db.execute("CREATE VIRTUAL TABLE temp._fts_probe USING fts5(x)")
    db.execute("DROP TABLE temp._fts_probe")


def fts_query(text: str) -> str:
    """Turn free text into a safe FTS5 query: quoted word tokens joined by OR."""
    return " OR ".join(f'"{w}"' for w in re.findall(r"\w+", text.lower()))


_MARKERS = {"image": "[screenshot]", "document": "[document]"}


def _compaction_text(block: dict) -> str:
    """The summary text of a compaction block; empty when compaction failed (content null)."""
    return block.get("content") or ""


def _clean_block(block, texts: list[str]):
    """Replace image/document blocks with text markers; collect searchable text.

    Thinking and tool_use input are kept in content_json (the API needs them to resume) but
    never reach the searchable text.
    """
    if not isinstance(block, dict):
        return block
    kind = block.get("type")
    if kind in _MARKERS:
        texts.append(_MARKERS[kind])
        return {"type": "text", "text": _MARKERS[kind]}
    if kind == "text":
        texts.append(block.get("text", ""))
    elif kind == "tool_result":
        inner = block.get("content")
        if isinstance(inner, str):
            texts.append(inner)
        elif isinstance(inner, list):
            return {**block, "content": [_clean_block(b, texts) for b in inner]}
    return block


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
            try:
                self._db.executescript(script)
            except BaseException:
                if self._db.in_transaction:
                    self._db.execute("ROLLBACK")
                self._db.close()
                raise

    def close(self) -> None:
        self._db.close()

    def permission_modes(self) -> dict[str, str]:
        return dict(self._db.execute("SELECT tool, mode FROM permissions"))

    def set_permission_mode(self, tool: str, mode: str) -> None:
        self._db.execute(
            "INSERT INTO permissions(tool, mode) VALUES (?,?)"
            " ON CONFLICT(tool) DO UPDATE SET mode=excluded.mode",
            (tool, mode),
        )

    def list_apps(self) -> list[AppRow]:
        rows = self._db.execute(
            "SELECT id, name, transport, config, auth, enabled FROM apps ORDER BY rowid"
        )
        return [AppRow(i, n, t, json.loads(c), a, bool(e)) for i, n, t, c, a, e in rows]

    def add_app(self, row: AppRow) -> None:
        self._db.execute(
            "INSERT INTO apps(id, name, transport, config, auth, enabled) VALUES (?,?,?,?,?,?)",
            (row.id, row.name, row.transport, json.dumps(row.config), row.auth, int(row.enabled)),
        )

    def set_app_enabled(self, app_id: str, enabled: bool) -> None:
        self._db.execute("UPDATE apps SET enabled=? WHERE id=?", (int(enabled), app_id))

    def remove_app(self, app_id: str) -> None:
        self._db.execute("DELETE FROM apps WHERE id=?", (app_id,))

    def _jobs(self, where: str = "", args: tuple = (), limit: int | None = None) -> list[Job]:
        sql = f"SELECT {_JOB_COLUMNS} FROM jobs {where} ORDER BY rowid DESC"
        if limit is not None:
            sql += " LIMIT ?"
            args += (limit,)
        return [
            Job(*r[:10], bool(r[10]), r[11], r[12]) for r in self._db.execute(sql, args).fetchall()
        ]

    def add_job(self, id: str, agent: str, task: str, folder: str, mode: str) -> Job:
        self._db.execute(
            "INSERT INTO jobs(id, agent, task, folder, mode, state, started_at)"
            " VALUES (?,?,?,?,?,'running',?)",
            (id, agent, task, folder, mode, self._now().isoformat()),
        )
        return self._jobs("WHERE id=?", (id,))[0]

    def update_job(self, id: str, **fields) -> None:
        unknown = set(fields) - _JOB_FIELDS
        if unknown:
            raise ValueError(f"Unknown job fields: {', '.join(sorted(unknown))}")
        if not fields:
            return
        if isinstance(fields.get("result"), str):
            fields["result"] = fields["result"][:JOB_RESULT_CAP]
        if isinstance(fields.get("progress"), str):
            fields["progress"] = fields["progress"][-JOB_PROGRESS_CAP:]  # a running tail
        sets = ", ".join(f"{k}=?" for k in fields)
        self._db.execute(f"UPDATE jobs SET {sets} WHERE id=?", (*fields.values(), id))

    def get_job(self, id: str) -> Job | None:
        rows = self._jobs("WHERE id=?", (id,))
        return rows[0] if rows else None

    def list_jobs(self, limit: int = 20) -> list[Job]:
        """Newest first."""
        return self._jobs(limit=limit)

    def running_jobs(self) -> list[Job]:
        return self._jobs("WHERE state='running'")

    def stop_running_on_start(self) -> None:
        """No job survives a brain restart; mark the leftovers stopped."""
        self._db.execute(
            "UPDATE jobs SET state='stopped', reason='brain restarted', ended_at=?"
            " WHERE state='running'",
            (self._now().isoformat(),),
        )

    def unreported_jobs(self) -> list[Job]:
        return self._jobs("WHERE state!='running' AND reported=0")

    def mark_reported(self, id: str) -> None:
        self._db.execute("UPDATE jobs SET reported=1 WHERE id=?", (id,))

    def _timers(self, where: str = "", args: tuple = ()) -> list[Timer]:
        rows = self._db.execute(
            "SELECT id, note, next_at, repeat_s, created_at, fired FROM timers"
            f" {where} ORDER BY next_at, id",
            args,
        ).fetchall()
        return [Timer(i, n, datetime.fromisoformat(a), r, c, bool(f)) for i, n, a, r, c, f in rows]

    def add_timer(self, note: str, next_at: datetime, repeat_s: int | None = None) -> Timer:
        cur = self._db.execute(
            "INSERT INTO timers(note, next_at, repeat_s, created_at) VALUES (?,?,?,?)",
            (note, _utc_text(next_at), repeat_s, self._now().isoformat()),
        )
        return self._timers("WHERE id=?", (cur.lastrowid,))[0]

    def list_timers(self) -> list[Timer]:
        """Soonest first."""
        return self._timers()

    def get_timer(self, id: int) -> Timer | None:
        rows = self._timers("WHERE id=?", (id,))
        return rows[0] if rows else None

    def delete_timer(self, id: int) -> bool:
        return self._db.execute("DELETE FROM timers WHERE id=?", (id,)).rowcount > 0

    def set_timer_next(self, id: int, next_at: datetime) -> None:
        self._db.execute("UPDATE timers SET next_at=? WHERE id=?", (_utc_text(next_at), id))

    def due_timers(self, now: datetime) -> list[Timer]:
        return self._timers("WHERE fired=0 AND next_at<=?", (_utc_text(now),))

    def mark_timer_fired(self, id: int) -> None:
        self._db.execute("UPDATE timers SET fired=1 WHERE id=?", (id,))

    def fired_timers(self) -> list[Timer]:
        return self._timers("WHERE fired=1")

    def add_approval(
        self,
        *,
        source: str,
        tool: str,
        summary: str,
        input: dict,
        job_id: str | None,
        group_key: str,
        outcome: str,
        decided_by: str,
        preference_id: int | None,
        at: str,
    ) -> int:
        cur = self._db.execute(
            "INSERT INTO approvals(source, tool, summary, input, job_id, group_key, outcome,"
            " decided_by, preference_id, at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (source, tool, summary, json.dumps(input), job_id, group_key, outcome, decided_by,
             preference_id, at),
        )  # fmt: skip
        return cur.lastrowid

    def list_approvals(
        self, filter: Literal["all", "scout", "refused"], limit: int, before: int | None
    ) -> list[Approval]:
        where, args = [], []
        if filter == "scout":
            where.append("decided_by='scout'")
        elif filter == "refused":
            where.append("outcome='refused'")
        if before is not None:
            where.append("id<?")
            args.append(before)
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        rows = self._db.execute(
            f"SELECT id, source, tool, summary, input, job_id, group_key, outcome, decided_by,"
            f" preference_id, at FROM approvals {clause} ORDER BY id DESC LIMIT ?",
            (*args, limit),
        ).fetchall()
        return [Approval(r[0], r[1], r[2], r[3], json.loads(r[4]), *r[5:]) for r in rows]

    def approval_counts(self) -> dict[str, int]:
        total, scout, refused = self._db.execute(
            "SELECT COUNT(*), COALESCE(SUM(decided_by='scout'),0),"
            " COALESCE(SUM(outcome='refused'),0) FROM approvals"
        ).fetchone()
        return {"total": total, "scout": scout, "refused": refused}

    def person_approvals_since(self, group_key: str, since_iso: str) -> int:
        return self._db.execute(
            "SELECT COUNT(*) FROM approvals WHERE group_key=? AND outcome='approved'"
            " AND decided_by='person' AND at>=?",
            (group_key, since_iso),
        ).fetchone()[0]

    def _preferences(self, where: str = "", args: tuple = ()) -> list[Preference]:
        rows = self._db.execute(
            "SELECT id, sentence, source, tool, group_key, builtin, created_at, use_count,"
            f" last_used FROM preferences {where} ORDER BY builtin DESC, id",
            args,
        ).fetchall()
        return [Preference(*r[:5], bool(r[5]), *r[6:]) for r in rows]

    def add_preference(
        self, *, sentence: str, source: str | None, tool: str | None, group_key: str | None, at: str
    ) -> Preference:
        cur = self._db.execute(
            "INSERT INTO preferences(sentence, source, tool, group_key, created_at)"
            " VALUES (?,?,?,?,?)",
            (sentence, source, tool, group_key, at),
        )
        return self._preferences("WHERE id=?", (cur.lastrowid,))[0]

    def list_preferences(self) -> list[Preference]:
        return self._preferences()

    def remove_preference(self, id: int) -> bool:
        return self._db.execute("DELETE FROM preferences WHERE id=?", (id,)).rowcount > 0

    def edit_preference(self, id: int, sentence: str) -> bool:
        cur = self._db.execute("UPDATE preferences SET sentence=? WHERE id=?", (sentence, id))
        return cur.rowcount > 0

    def use_preference(self, id: int, at: str) -> None:
        self._db.execute(
            "UPDATE preferences SET use_count=use_count+1, last_used=? WHERE id=?", (at, id)
        )

    def has_user_preferences(self) -> bool:
        return bool(self._db.execute("SELECT 1 FROM preferences WHERE builtin=0").fetchone())

    def has_preference_for(self, group_key: str) -> bool:
        row = self._db.execute("SELECT 1 FROM preferences WHERE group_key=?", (group_key,))
        return bool(row.fetchone())

    def default_preference(self) -> Preference | None:
        rows = self._preferences("WHERE builtin=1")
        return rows[0] if rows else None

    def add_offer(self, group_key: str, at: str, outcome: str) -> None:
        self._db.execute(
            "INSERT INTO offers(group_key, at, outcome) VALUES (?,?,?)", (group_key, at, outcome)
        )

    def offers_for(self, group_key: str) -> list[tuple[str, str]]:
        rows = self._db.execute(
            "SELECT at, outcome FROM offers WHERE group_key=? ORDER BY at DESC, id DESC",
            (group_key,),
        ).fetchall()
        return [(a, o) for a, o in rows]

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
        # A reworded tracking item keeps its cadence unless a new one is given.
        self._db.execute(
            "UPDATE memories SET text=?, cadence=?, updated_at=? WHERE id=?",
            (text, cadence if cadence is not None else old.cadence, now, replaces),
        )
        return self._item(replaces)  # type: ignore[return-value]

    def forget(self, item_id: int) -> Item:
        item = self._item(item_id)
        if item is None:
            raise MemoryRefused(f"no memory with id {item_id}.")
        self._db.execute("DELETE FROM memories WHERE id=?", (item_id,))
        return item

    def list_items(self, limit: int) -> list[Item]:
        """Every kind, newest first (by last change); for Home's memory list."""
        rows = self._db.execute(
            f"SELECT {_COLUMNS} FROM memories ORDER BY updated_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [Item(*r) for r in rows]

    def always_loaded(self) -> dict[str, list[Item]]:
        out: dict[str, list[Item]] = {}
        for spec in KINDS.values():
            if not spec.always_loaded:
                continue
            rows = self._db.execute(
                f"SELECT {_COLUMNS} FROM memories WHERE kind=? ORDER BY id", (spec.name,)
            ).fetchall()
            if rows:
                out[spec.name] = [Item(*r) for r in rows]
        return out

    def add_summary(self, text: str) -> Item:
        """Code-written compaction summary; skips the model-write checks and caps."""
        now = self._now().isoformat()
        cur = self._db.execute(
            "INSERT INTO memories(kind, text, cadence, created_at, updated_at)"
            " VALUES ('summary',?,NULL,?,?)",
            (text.strip(), now, now),
        )
        return self._item(cur.lastrowid)  # type: ignore[arg-type,return-value]

    def save_messages(self, messages: list[dict]) -> None:
        now = self._now().isoformat()
        self._db.execute("BEGIN IMMEDIATE")
        try:
            for m in messages:
                texts: list[str] = []
                content = m["content"]
                if isinstance(content, str):
                    texts.append(content)
                else:
                    content = [_clean_block(b, texts) for b in content]
                self._db.execute(
                    "INSERT INTO messages(at, role, content_json, text) VALUES (?,?,?,?)",
                    (now, m["role"], json.dumps(content), "\n".join(t for t in texts if t)),
                )
        except BaseException:
            self._db.execute("ROLLBACK")
            raise
        self._db.execute("COMMIT")

    def load_messages(self) -> list[dict]:
        rows = self._db.execute("SELECT role, content_json FROM messages ORDER BY id")
        return [{"role": r, "content": json.loads(c)} for r, c in rows]

    def search(self, query: str, kind: str | None = None, limit: int = 10) -> list[Hit]:
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
            hits = [Hit(str(i), k, at, t) for i, k, at, t in self._db.execute(sql, args)]
        if kind is None or kind == "chat":
            rows = self._db.execute(
                "SELECT m.id, m.at, m.text FROM messages_fts"
                " JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ?"
                " ORDER BY bm25(messages_fts) LIMIT ?",
                (match, limit - len(hits)),
            )
            hits += [Hit(f"chat:{i}", "chat", at, t) for i, at, t in rows]
        return hits
