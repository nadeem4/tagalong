"""The `work` table: every job, step, ask, timer and loop as one row in a tree.

`WorkStore` is the one state machine over it: the allowed moves, the parent rollup, the retry
rule, the due queries and the resume scan. Each move is one transaction that also appends
a `work_events` row, so a second writer holding a stale state is refused, not overwritten.
"""

import json
import re
import sqlite3
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from types import EllipsisType
from typing import Literal

from brain.store import search
from brain.store.db import transaction, utc_text

Kind = Literal["goal", "expert_call", "tool_call", "ask", "question", "timer", "loop", "watch"]
State = Literal["planned", "active", "blocked", "paused", "done", "failed", "cancelled", "expired"]
TERMINAL = frozenset({"done", "failed", "cancelled", "expired"})
OPEN = ("planned", "active", "blocked", "paused")

TITLE_CAP = 200
ERROR_CAP = 300
DROPPED_MARKER = "[older steps dropped]"

_MOVES = {
    "planned": {"active", "cancelled", "expired", "paused"},
    "active": {"done", "failed", "blocked", "planned", "cancelled", "expired"},
    "blocked": {"planned", "cancelled", "expired"},
    "paused": {"planned", "cancelled"},
    "failed": {"cancelled"},  # the person chose to skip a failed step
}

_COLUMNS = (
    "id, parent_id, root_id, seq, kind, state, title, input, summary, detail_id, progress,"
    " checkpoint, attempt, max_attempts, safe_to_retry, error_kind, last_error, due_at,"
    " created_at, updated_at, ended_at, end_reason, reported_at, source_message_id"
)
_W_COLUMNS = ", ".join(f"w.{c.strip()}" for c in _COLUMNS.split(","))


class TransitionRefused(ValueError):
    """The move is not allowed, or the row is no longer in the state the caller expected."""


@dataclass(frozen=True)
class RetrySettings:
    max_attempts: int = 3
    backoff_s: tuple[int, ...] = (30, 120, 600)


_DEFAULT_RETRY = RetrySettings()

# How an ask ended, as the approval log words it, and the state that records it.
_ASK_STATE = {
    "approved": "done",
    "refused": "cancelled",
    "expired": "expired",
    "timed_out": "expired",
    "no_one": "expired",
}


@dataclass(frozen=True)
class WorkRow:
    id: str
    parent_id: str | None
    root_id: str
    seq: int
    kind: str
    state: str
    title: str
    input: dict | None
    summary: str | None
    detail_id: str | None
    progress: str | None
    checkpoint: dict | None
    attempt: int
    max_attempts: int
    safe_to_retry: bool
    error_kind: str | None
    last_error: str | None
    due_at: str | None
    created_at: str
    updated_at: str
    ended_at: str | None
    end_reason: str | None
    reported_at: str | None
    source_message_id: int | None


@dataclass(frozen=True)
class WorkEvent:
    id: int
    work_id: str
    at: str
    kind: str
    data: dict | None


@dataclass(frozen=True)
class AskLogRow:
    """One decided ask as Home's approval log shows it."""

    id: int  # work_ask.id: the approval id and paging cursor
    source: str
    tool: str
    summary: str
    input: dict
    job_id: str | None
    group_key: str
    outcome: str
    decided_by: str
    rule_id: int | None
    at: str
    rule_sentence: str | None


@dataclass(frozen=True)
class ActivityEntry:
    """One row of a job's step log."""

    rev: int
    seq: int
    at: str  # ISO UTC
    kind: str
    text: str
    status: str | None = None
    step: str | None = None
    exit: int | None = None
    part: str = "p1"
    source: str | None = None  # who did it, when not the part's expert


_UNIT_S = {"minute": 60, "hour": 3600, "day": 86400, "week": 604800}
_CADENCE = re.compile(r"every\s+(\d+)\s+(minute|hour|day|week)s?", re.IGNORECASE)
_WORD_CADENCE = {"hourly": 3600, "daily": 86400, "weekly": 604800}


def parse_cadence(text: str) -> int | None:
    """Seconds between runs for a cadence phrase ("daily", "every 2 hours"); None if unreadable."""
    text = text.strip().lower()
    if text in _WORD_CADENCE:
        return _WORD_CADENCE[text]
    match = _CADENCE.fullmatch(text)
    if match is None or int(match[1]) == 0:
        return None
    return int(match[1]) * _UNIT_S[match[2].lower()]


def _loads(text: str | None) -> dict | None:
    return None if text is None else json.loads(text)


def _dumps(value: dict | None) -> str | None:
    return None if value is None else json.dumps(value, ensure_ascii=False)


def _row(r: tuple) -> WorkRow:
    return WorkRow(*r[:7], _loads(r[7]), *r[8:11], _loads(r[11]), *r[12:14], bool(r[14]), *r[15:])


def _allowed(kind: str, frm: str, to: str, via_close: bool) -> bool:
    if kind == "goal" and to in ("done", "failed"):
        return via_close and frm in ("planned", "active", "blocked")
    if kind == "goal" and frm == "failed":
        return False  # a goal Scout closed as failed stays failed
    if to in _MOVES.get(frm, ()):
        return True
    if kind == "goal" and (frm, to) == ("blocked", "active"):
        return True
    if kind != "loop":
        return False
    # A loop is settled from waiting or after going quiet, and reopens by new mail.
    if frm in ("planned", "expired") and to in ("done", "cancelled", "expired"):
        return frm != to
    return frm in ("done", "cancelled", "expired") and to == "planned"


class WorkStore:
    def __init__(
        self,
        db: sqlite3.Connection,
        now: Callable[[], datetime],
        mask: Callable[[str], str] = lambda s: s,
        retry: RetrySettings = _DEFAULT_RETRY,
    ) -> None:
        self.db = db
        self.now = now
        self.mask = mask
        self.retry = retry
        self._listeners: list[Callable[[str, str, str], None]] = []

    def _stamp(self) -> str:
        return utc_text(self.now())

    # ---- reads ----

    def get(self, id: str) -> WorkRow | None:
        r = self.db.execute(f"SELECT {_COLUMNS} FROM work WHERE id = ?", (id,)).fetchone()
        return None if r is None else _row(r)

    def _need(self, id: str) -> WorkRow:
        row = self.get(id)
        if row is None:
            raise KeyError(id)
        return row

    def _select(self, where: str, args: Sequence = (), order: str = "seq, rowid") -> list[WorkRow]:
        sql = f"SELECT {_COLUMNS} FROM work WHERE {where} ORDER BY {order}"
        return [_row(r) for r in self.db.execute(sql, args)]

    def children(self, id: str) -> list[WorkRow]:
        return self._select("parent_id = ?", (id,))

    def tree(self, root_id: str) -> list[WorkRow]:
        # the root first: its seq counts among all roots, the rows under it count from 1
        return self._select("root_id = ?", (root_id,), "parent_id IS NOT NULL, seq, rowid")

    def of_kind(self, kind: str, states: Sequence[str] | None = None) -> list[WorkRow]:
        where, args = "kind = ?", [kind]
        if states is not None:
            where += f" AND state IN ({','.join('?' * len(states))})"
            args += list(states)
        return self._select(where, args, "created_at, rowid")

    def open_roots(self) -> list[WorkRow]:
        return self._select(
            "parent_id IS NULL AND state IN ('planned','active','blocked','paused')"
        )

    def search(self, query: str, limit: int = 10) -> list[WorkRow]:
        match = search.fts_query(query)
        if not match:
            return []
        sql = (
            f"SELECT {_W_COLUMNS} FROM work_fts JOIN work w ON w.rowid = work_fts.rowid"
            " WHERE work_fts MATCH ? ORDER BY bm25(work_fts) LIMIT ?"
        )
        return [_row(r) for r in self.db.execute(sql, (match, limit))]

    def events(self, id: str, limit: int = 50) -> list[WorkEvent]:
        """The newest `limit` events of one row, oldest first."""
        rows = self.db.execute(
            "SELECT id, work_id, at, kind, data FROM work_events WHERE work_id = ?"
            " ORDER BY id DESC LIMIT ?",
            (id, limit),
        ).fetchall()
        return [WorkEvent(i, w, at, k, _loads(d)) for i, w, at, k, d in reversed(rows)]

    def event_of(self, id: str, kind: str) -> WorkEvent | None:
        """The row's oldest event of one kind (`continued` is written once)."""
        r = self.db.execute(
            "SELECT id, work_id, at, kind, data FROM work_events WHERE work_id = ? AND kind = ?"
            " ORDER BY id LIMIT 1",
            (id, kind),
        ).fetchone()
        return None if r is None else WorkEvent(r[0], r[1], r[2], r[3], _loads(r[4]))

    def newest(self, kind: str, limit: int) -> list[WorkRow]:
        """The most recently created rows of one kind, newest first."""
        return self._select("kind = ?", [kind], f"rowid DESC LIMIT {int(limit)}")

    def expert_calls_with_session(self, agent: str, limit: int = 50) -> list[WorkRow]:
        """The expert's newest calls that are not running and saved a session, newest first."""
        sql = (
            f"SELECT {_W_COLUMNS} FROM work w JOIN work_job j ON j.work_id = w.id"
            " WHERE w.kind = 'expert_call' AND j.agent = ? AND w.state != 'active'"
            " AND json_extract(w.checkpoint, '$.session_id') IS NOT NULL"
            " ORDER BY w.rowid DESC LIMIT ?"
        )
        return [_row(r) for r in self.db.execute(sql, (agent, limit))]

    # ---- job_steps: what a job did, step by step (keyed by the goal id) ----

    def save_activity(self, job_id: str, entry: ActivityEntry) -> None:
        self.db.execute(
            "INSERT INTO job_steps(job_id, rev, seq, at, kind, step, status, exit, text,"
            " part, source) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(job_id, seq) DO UPDATE SET rev=excluded.rev, at=excluded.at,"
            " kind=excluded.kind, step=excluded.step, status=excluded.status,"
            " exit=excluded.exit, text=excluded.text, part=excluded.part,"
            " source=excluded.source",
            (
                job_id,
                entry.rev,
                entry.seq,
                entry.at,
                entry.kind,
                entry.step,
                entry.status,
                entry.exit,
                entry.text,
                entry.part,
                entry.source,
            ),
        )

    def activity_after(self, job_id: str, after_rev: int, limit: int) -> list[ActivityEntry]:
        rows = self.db.execute(
            "SELECT rev, seq, at, kind, text, status, step, exit, part, source FROM job_steps"
            " WHERE job_id=? AND rev>? ORDER BY rev LIMIT ?",
            (job_id, after_rev, limit),
        )
        return [ActivityEntry(*r) for r in rows]

    def last_rev(self, job_id: str) -> int:
        row = self.db.execute("SELECT MAX(rev) FROM job_steps WHERE job_id=?", (job_id,))
        return row.fetchone()[0] or 0

    def max_seq(self, job_id: str) -> int:
        """The highest step number the job has used, across all its parts."""
        row = self.db.execute("SELECT MAX(seq) FROM job_steps WHERE job_id=?", (job_id,))
        return row.fetchone()[0] or 0

    def jobs_with_activity(self) -> set[str]:
        return {r[0] for r in self.db.execute("SELECT DISTINCT job_id FROM job_steps")}

    def trim_activity(self, job_id: str, max_entries: int, max_bytes: int) -> None:
        """Keep a job's log inside its caps: blank the oldest output text first, then delete
        the least recently written rows, leaving one marker (seq 0) where they were."""
        total = self.db.execute(
            "SELECT COALESCE(SUM(LENGTH(CAST(text AS BLOB))), 0) FROM job_steps WHERE job_id=?",
            (job_id,),
        ).fetchone()[0]
        if total > max_bytes:
            outputs = self.db.execute(
                "SELECT seq, LENGTH(CAST(text AS BLOB)) FROM job_steps"
                " WHERE job_id=? AND kind='output' AND text!='' ORDER BY seq",
                (job_id,),
            ).fetchall()
            for seq, size in outputs:
                if total <= max_bytes:
                    break
                self.db.execute(
                    "UPDATE job_steps SET text='', rev=? WHERE job_id=? AND seq=?",
                    (self.last_rev(job_id) + 1, job_id, seq),  # a new rev so readers refetch it
                )
                total -= size
        rows = self.db.execute(
            "SELECT seq, LENGTH(CAST(text AS BLOB)) FROM job_steps"
            " WHERE job_id=? AND seq>0 ORDER BY rev",
            (job_id,),
        ).fetchall()
        count, drop = len(rows), []
        for seq, size in rows[:-1]:  # the newest row always stays
            if count <= max_entries and total <= max_bytes:
                break
            drop.append(seq)
            count -= 1
            total -= size
        if not drop:
            return
        self.db.executemany(
            "DELETE FROM job_steps WHERE job_id=? AND seq=?", [(job_id, s) for s in drop]
        )
        self.save_activity(
            job_id,
            ActivityEntry(
                rev=self.last_rev(job_id) + 1,
                seq=0,
                at=self.now().isoformat(),
                kind="other",
                text=DROPPED_MARKER,
            ),
        )

    # ---- work_job: what a goal or expert call needs to run in a folder ----

    def set_job_detail(
        self,
        work_id: str,
        *,
        agent: str | None = None,
        folder: str | None = None,
        mode: str | None = None,
        task: str | None = None,
    ) -> None:
        """Save the detail row; an argument left at None keeps what was saved."""
        self.db.execute(
            "INSERT INTO work_job(work_id, agent, folder, mode, task) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(work_id) DO UPDATE SET agent = COALESCE(excluded.agent, agent),"
            " folder = COALESCE(excluded.folder, folder), mode = COALESCE(excluded.mode, mode),"
            " task = COALESCE(excluded.task, task)",
            (work_id, agent, folder, mode, task),
        )

    def set_text(self, id: str, summary: str | None, detail_id: str | None) -> None:
        """Replace a row's summary and its pointer to the whole text together (None clears)."""
        self.db.execute(
            "UPDATE work SET summary = ?, detail_id = ?, updated_at = ? WHERE id = ?",
            (None if summary is None else self.mask(summary), detail_id, self._stamp(), id),
        )

    def job_detail(self, work_id: str) -> dict | None:
        return self.job_details([work_id]).get(work_id)

    def job_details(self, ids: Sequence[str]) -> dict[str, dict]:
        marks = ",".join("?" * len(ids))
        rows = self.db.execute(
            f"SELECT work_id, agent, folder, mode, task FROM work_job WHERE work_id IN ({marks})",
            list(ids),
        )
        return {w: {"agent": a, "folder": f, "mode": m, "task": t} for w, a, f, m, t in rows}

    def add_event(self, id: str, kind: str, data: dict | None = None) -> None:
        self.db.execute(
            "INSERT INTO work_events(work_id, at, kind, data) VALUES (?, ?, ?, ?)",
            (id, self._stamp(), kind, _dumps(data)),
        )

    # ---- writes that leave the state alone ----

    def create(
        self,
        kind: Kind,
        title: str,
        *,
        parent_id: str | None = None,
        state: State = "planned",
        input: dict | None = None,
        due_at: datetime | None = None,
        safe_to_retry: bool = False,
        source_message_id: int | None = None,
        id: str | None = None,
        max_attempts: int | None = None,
    ) -> WorkRow:
        if state in TERMINAL:
            raise ValueError("a new row cannot start in an ended state")
        id = id or uuid.uuid4().hex[:8]
        now = self._stamp()
        with transaction(self.db):
            root_id = id
            if parent_id is not None:
                parent = self._need(parent_id)
                if parent.state in TERMINAL:
                    raise TransitionRefused(f"{parent_id} has ended; nothing can be added")
                root_id = parent.root_id
            seq = self.db.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM work WHERE parent_id IS ?", (parent_id,)
            ).fetchone()[0]
            self.db.execute(
                "INSERT INTO work(id, parent_id, root_id, seq, kind, state, title, input,"
                " max_attempts, safe_to_retry, due_at, created_at, updated_at, source_message_id)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    id,
                    parent_id,
                    root_id,
                    seq,
                    kind,
                    state,
                    self.mask(title)[:TITLE_CAP],
                    _dumps(input),
                    self.retry.max_attempts if max_attempts is None else max_attempts,
                    int(safe_to_retry),
                    None if due_at is None else utc_text(due_at),
                    now,
                    now,
                    source_message_id,
                ),
            )
            self.add_event(id, "created", {"kind": kind})
        return self._need(id)

    def update(
        self,
        id: str,
        *,
        title: str | None = None,
        summary: str | None = None,
        detail_id: str | None = None,
        progress: str | None = None,
        checkpoint: dict | None = None,
        input: dict | None = None,
        due_at: datetime | None | EllipsisType = ...,
        error_kind: str | None = None,
        last_error: str | None = None,
    ) -> None:
        """Change non-state fields; an argument left at None stays as it was.

        `due_at` is the exception: None clears it, so its "unchanged" value is `...`.
        """
        sets: dict[str, object] = {}
        if title is not None:
            sets["title"] = self.mask(title)[:TITLE_CAP]
        if summary is not None:
            sets["summary"] = self.mask(summary)
        if detail_id is not None:
            sets["detail_id"] = detail_id
        if progress is not None:
            sets["progress"] = self.mask(progress)
        if checkpoint is not None:
            sets["checkpoint"] = _dumps(checkpoint)
        if input is not None:
            sets["input"] = _dumps(input)
        if due_at is not ...:
            sets["due_at"] = None if due_at is None else utc_text(due_at)
        if error_kind is not None:
            sets["error_kind"] = error_kind
        if last_error is not None:
            sets["last_error"] = self.mask(last_error)[:ERROR_CAP]
        sets["updated_at"] = self._stamp()
        self.db.execute(
            f"UPDATE work SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
            (*sets.values(), id),
        )

    # ---- states ----

    def transition(
        self,
        id: str,
        to: State,
        *,
        reason: str | None = None,
        data: dict | None = None,
        expect: State | tuple[State, ...] | None = None,
    ) -> WorkRow:
        with transaction(self.db):
            row = self._need(id)
            if expect is not None and row.state not in (
                (expect,) if isinstance(expect, str) else expect
            ):
                raise TransitionRefused(f"{id} is {row.state}, expected {expect}")
            self._move(row, to, reason, data)
        return self._need(id)

    def _move(
        self,
        row: WorkRow,
        to: str,
        reason: str | None,
        data: dict | None = None,
        *,
        via_close: bool = False,
        force: bool = False,
        extra: dict | None = None,
    ) -> None:
        """One checked move inside the caller's transaction, then rollup and parent end."""
        if not force and not _allowed(row.kind, row.state, to, via_close):
            raise TransitionRefused(f"{row.kind} cannot go from {row.state} to {to}")
        ending = to in TERMINAL
        if ending and not reason:
            raise ValueError("an ended state needs a reason")
        reason = self.mask(reason) if reason else reason
        now = self._stamp()
        sets: dict[str, object] = {"state": to, "updated_at": now}
        if ending:
            sets.update(ended_at=now, end_reason=reason, progress=None)
        elif row.state in TERMINAL:
            sets.update(ended_at=None, end_reason=None)
        if ending or to == "blocked" or row.state in TERMINAL:
            sets["reported_at"] = None  # Scout has not heard about this change yet
        sets.update(extra or {})
        self.db.execute(
            f"UPDATE work SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
            (*sets.values(), row.id),
        )
        self.add_event(
            row.id, "state", {**(data or {}), "from": row.state, "to": to, "reason": reason}
        )
        if row.kind == "loop" and row.state in TERMINAL and to == "planned":
            self.add_event(row.id, "reopened")
        if ending:
            self._end_children(row.id, reason or "")
        self._rollup(row, to)
        if ending and row.kind in ("ask", "question"):
            for listener in self._listeners:
                listener(row.id, row.kind, to)

    def _end_children(self, parent_id: str, reason: str) -> None:
        for child in self.children(parent_id):
            if child.state not in OPEN:
                continue
            if child.kind in ("ask", "question"):
                to, why = "expired", f"parent ended: {reason}"
            else:
                to, why = "cancelled", "goal closed"
            # Scout already knows the parent ended, so these need no report of their own.
            self._move(child, to, why, force=True, extra={"reported_at": self._stamp()})

    def _rollup(self, row: WorkRow, to: str) -> None:
        """The only automatic goal move: a stuck child blocks it, a freed one unblocks it."""
        if row.parent_id is None:
            return
        parent = self._need(row.parent_id)
        if parent.kind != "goal":
            return
        if to in ("blocked", "failed") and parent.state == "active":
            self._move(parent, "blocked", None, {"because": row.id})
        elif to in ("planned", "active", "cancelled") and parent.state == "blocked":
            if not any(c.state in ("blocked", "failed") for c in self.children(parent.id)):
                self._move(parent, "active", None, {"because": row.id})

    def children_ended(self, goal_id: str) -> bool:
        kids = self.children(goal_id)
        return bool(kids) and all(k.state in TERMINAL for k in kids)

    def fail(self, id: str, error_kind: Literal["transient", "permanent"], reason: str) -> WorkRow:
        """A step failed: back off and retry when that is safe, else end it as failed."""
        reason = self.mask(reason)
        record = {"error_kind": error_kind, "last_error": reason[:ERROR_CAP]}
        with transaction(self.db):
            row = self._need(id)
            retry = error_kind == "transient" and row.safe_to_retry
            if retry and row.attempt < row.max_attempts:
                steps = self.retry.backoff_s
                wait = timedelta(seconds=steps[min(row.attempt, len(steps) - 1)])
                extra = {
                    **record,
                    "attempt": row.attempt + 1,
                    "due_at": utc_text(self.now() + wait),
                }
                self._move(row, "planned", None, extra=extra)
                self.add_event(id, "attempt_failed", {"reason": reason})
            else:
                if retry:
                    why = f"gave up after {row.attempt} tries: {reason}"
                else:
                    why = f"not retryable: {reason}"
                self._move(row, "failed", why, extra=record)
        return self._need(id)

    def retry_step(self, id: str) -> WorkRow:
        """The person chose retry: a blocked or failed step goes back to planned, tries reset."""
        with transaction(self.db):
            row = self._need(id)
            if row.state not in ("blocked", "failed"):
                raise TransitionRefused(f"{id} is {row.state}, not blocked or failed")
            if row.parent_id is not None and self._need(row.parent_id).state in TERMINAL:
                raise TransitionRefused(f"{row.parent_id} has ended; {id} cannot restart")
            extra = {"attempt": 0, "due_at": self._stamp()}  # due now, so the runner picks it up
            self._move(row, "planned", None, force=True, extra=extra)
            self.add_event(id, "retried")
        return self._need(id)

    def close_goal(self, goal_id: str, outcome: Literal["done", "failed"], summary: str) -> WorkRow:
        """Scout closes a goal; its open children end with it."""
        with transaction(self.db):
            row = self._need(goal_id)
            if row.kind != "goal":
                raise TransitionRefused(f"{goal_id} is a {row.kind}, not a goal")
            extra = {"summary": self.mask(summary), "reported_at": self._stamp()}
            self._move(row, outcome, "closed by Scout", via_close=True, extra=extra)
        return self._need(goal_id)

    # ---- asks and questions: rows while open, the approval log once decided ----

    def on_transition(self, listener: Callable[[str, str, str], None]) -> None:
        """Call `listener(id, kind, new_state)` whenever an ask or question ends, whoever ended
        it, so a waiter in memory learns that its parent closed."""
        self._listeners.append(listener)

    def open_goal(self, job_id: str | None) -> str | None:
        """The id back when it names a goal that can still take a child, else None."""
        row = None if job_id is None else self.get(job_id)
        return row.id if row is not None and row.kind == "goal" and row.state in OPEN else None

    def settle(self, id: str, to: State, reason: str, data: dict | None = None) -> WorkRow:
        """The owner of an open ask or question ends it: its own end is no news to Scout."""
        with transaction(self.db):
            row = self._need(id)
            if row.state not in OPEN:
                raise TransitionRefused(f"{id} is {row.state}, expected an open row")
            self._move(row, to, reason, data, extra={"reported_at": self._stamp()})
        return self._need(id)

    def add_ask(
        self,
        work_id: str,
        *,
        source: str | None = None,
        tool: str | None = None,
        summary: str | None = None,
        input: dict | None = None,
        group_key: str | None = None,
    ) -> int:
        """Save an ask's facts; a field left at None keeps what was saved. Returns the ask id."""
        self.db.execute(
            "INSERT INTO work_ask(work_id, source, tool, summary, input, group_key)"
            " VALUES (?,?,?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET"
            " source = COALESCE(excluded.source, source), tool = COALESCE(excluded.tool, tool),"
            " summary = COALESCE(excluded.summary, summary),"
            " input = COALESCE(excluded.input, input),"
            " group_key = COALESCE(excluded.group_key, group_key)",
            (
                work_id,
                source,
                tool,
                None if summary is None else self.mask(summary),
                _dumps(input),
                group_key,
            ),
        )
        row = self.db.execute("SELECT id FROM work_ask WHERE work_id = ?", (work_id,))
        return row.fetchone()[0]

    def ask_detail(self, work_id: str) -> dict | None:
        r = self.db.execute(
            "SELECT id, source, tool, summary, input, group_key, decided_by, rule_id, rule_sentence"
            " FROM work_ask WHERE work_id = ?",
            (work_id,),
        ).fetchone()
        if r is None:
            return None
        keys = ("id", "source", "tool", "summary", "input", "group_key", "decided_by")
        return {
            **dict(zip(keys, r, strict=False)),
            "input": _loads(r[4]),
            "rule_id": r[7],
            "rule_sentence": r[8],
        }

    def decide_ask(
        self,
        work_id: str,
        outcome: str,
        decided_by: str,
        rule_id: int | None = None,
        rule_sentence: str | None = None,
        reason: str | None = None,
    ) -> None:
        """Record how an ask ended, once. An ask whose waiter already ended it (answered, timed
        out) is re-ended with the outcome; one still open ends with it."""
        to = _ASK_STATE[outcome]
        with transaction(self.db):
            row = self._need(work_id)
            detail = self.ask_detail(work_id)
            if row.kind != "ask" or detail is None:
                raise TransitionRefused(f"{work_id} is not an ask with facts")
            if detail["decided_by"] is not None:
                raise TransitionRefused(f"{work_id} was already decided")
            extra = {"reported_at": self._stamp()}
            self._move(row, to, outcome, force=row.state in TERMINAL, extra=extra)
            self.db.execute(
                "UPDATE work_ask SET decided_by = ?, rule_id = ?, rule_sentence = ?"
                " WHERE work_id = ?",
                (decided_by, rule_id, rule_sentence, work_id),
            )
            event = {"outcome": outcome, "decided_by": decided_by}
            if reason:
                event["reason"] = reason
            self.add_event(work_id, "decided", event)

    def list_asks(
        self, filter: Literal["all", "scout", "refused"], limit: int, before: int | None
    ) -> list[AskLogRow]:
        """Decided asks, newest first; open and undecided ones are not in the log."""
        where, args = ["a.decided_by IS NOT NULL"], []
        if filter == "scout":
            where.append("a.decided_by = 'scout'")
        elif filter == "refused":
            where.append("w.end_reason = 'refused'")
        if before is not None:
            where.append("a.id < ?")
            args.append(before)
        rows = self.db.execute(
            "SELECT a.id, a.source, a.tool, a.summary, a.input, w.parent_id, a.group_key,"
            " w.end_reason, a.decided_by, a.rule_id, w.ended_at, a.rule_sentence"
            f" FROM work_ask a JOIN work w ON w.id = a.work_id WHERE {' AND '.join(where)}"
            " ORDER BY a.id DESC LIMIT ?",
            (*args, limit),
        ).fetchall()
        return [AskLogRow(*r[:4], json.loads(r[4]), *r[5:]) for r in rows]

    def ask_counts(self) -> dict[str, int]:
        total, scout, refused = self.db.execute(
            "SELECT COUNT(*), COALESCE(SUM(a.decided_by = 'scout'), 0),"
            " COALESCE(SUM(w.end_reason = 'refused'), 0)"
            " FROM work_ask a JOIN work w ON w.id = a.work_id WHERE a.decided_by IS NOT NULL"
        ).fetchone()
        return {"total": total, "scout": scout, "refused": refused}

    def person_asks_since(self, group_key: str, since: str) -> int:
        """How many asks of this group the person approved since `since` (UTC text)."""
        return self.db.execute(
            "SELECT COUNT(*) FROM work_ask a JOIN work w ON w.id = a.work_id"
            " WHERE a.group_key = ? AND w.end_reason = 'approved' AND a.decided_by = 'person'"
            " AND w.ended_at >= ?",
            (group_key, since),
        ).fetchone()[0]

    # ---- work_timer: how often a timer or watch comes back ----

    def set_repeat(self, id: str, repeat_s: int | None) -> None:
        self.db.execute(
            "INSERT INTO work_timer(work_id, repeat_s) VALUES (?, ?)"
            " ON CONFLICT(work_id) DO UPDATE SET repeat_s = excluded.repeat_s",
            (id, repeat_s),
        )

    def repeat_of(self, id: str) -> int | None:
        row = self.db.execute("SELECT repeat_s FROM work_timer WHERE work_id = ?", (id,)).fetchone()
        return None if row is None else row[0]

    # ---- work_loop: what a loop is, beside its row ----

    def set_loop_detail(
        self,
        work_id: str,
        *,
        source: str,
        ref: str,
        direction: str,
        people: list[str],
        anchors: list[str],
        quiet_after: datetime | None,
        asks: str,
    ) -> None:
        """Save the detail row (text masked); the snooze is kept as it was."""
        mask = self.mask
        self.db.execute(
            "INSERT INTO work_loop(work_id, source, ref, direction, people, anchors, quiet_after,"
            " asks) VALUES (?,?,?,?,?,?,?,?)"
            " ON CONFLICT(work_id) DO UPDATE SET direction = excluded.direction,"
            " people = excluded.people, anchors = excluded.anchors,"
            " quiet_after = excluded.quiet_after, asks = excluded.asks",
            (
                work_id,
                source,
                ref,
                direction,
                json.dumps([mask(p) for p in people]),
                json.dumps([mask(a) for a in anchors]),
                None if quiet_after is None else utc_text(quiet_after),
                mask(asks),
            ),
        )

    def set_snooze(self, work_id: str, until: datetime | None) -> None:
        self.db.execute(
            "UPDATE work_loop SET snoozed_until = ? WHERE work_id = ?",
            (None if until is None else utc_text(until), work_id),
        )

    def find_loop(self, source: str, ref: str) -> str | None:
        row = self.db.execute(
            "SELECT work_id FROM work_loop WHERE source = ? AND ref = ?", (source, ref)
        ).fetchone()
        return None if row is None else row[0]

    def loop_details(self, id: str | None = None) -> dict[str, dict]:
        """The detail of every loop, or of one."""
        rows = self.db.execute(
            "SELECT work_id, source, ref, direction, people, anchors, quiet_after, snoozed_until,"
            " asks FROM work_loop" + ("" if id is None else " WHERE work_id = ?"),
            () if id is None else (id,),
        )
        return {
            w: {
                "source": s,
                "ref": r,
                "direction": d,
                "people": json.loads(p),
                "anchors": json.loads(a),
                "quiet_after": q,
                "snoozed_until": z,
                "asks": k,
            }
            for w, s, r, d, p, a, q, z, k in rows
        }

    def events_of_kind(self, id: str, kind: str) -> list[WorkEvent]:
        """All of one row's events of one kind, oldest first."""
        rows = self.db.execute(
            "SELECT id, work_id, at, kind, data FROM work_events WHERE work_id = ? AND kind = ?"
            " ORDER BY id",
            (id, kind),
        )
        return [WorkEvent(i, w, at, k, _loads(d)) for i, w, at, k, d in rows]

    def delete_loops(self, id: str | None = None) -> None:
        """Remove one loop, or every loop, with its events and detail. The caller holds the
        transaction, so a wipe can take the cursors in the same one."""
        where = "kind = 'loop'" + ("" if id is None else " AND id = ?")
        args = () if id is None else (id,)
        ids = f"SELECT id FROM work WHERE {where}"
        self.db.execute(f"DELETE FROM work_events WHERE work_id IN ({ids})", args)
        self.db.execute(f"DELETE FROM work_loop WHERE work_id IN ({ids})", args)
        self.db.execute(f"DELETE FROM work WHERE {where}", args)

    # ---- cleanup ----

    def sweep(self, keep_days: int) -> int:
        """Remove whole trees that ended more than `keep_days` ago; returns the roots removed.

        A tree goes only when its root and every row under it has ended, so an open watch, a
        repeating timer or a goal with a running child is never touched. One transaction per
        root: a crash leaves whole trees, never half of one.
        """
        cutoff = utc_text(self.now() - timedelta(days=keep_days))
        ended = "('done','failed','cancelled','expired')"
        roots = self.db.execute(
            f"SELECT id FROM work r WHERE r.parent_id IS NULL AND r.state IN {ended}"
            " AND r.ended_at < ? AND NOT EXISTS ("
            f"SELECT 1 FROM work c WHERE c.root_id = r.id AND c.state NOT IN {ended})",
            (cutoff,),
        ).fetchall()
        for (root_id,) in roots:
            with transaction(self.db):
                ids = "SELECT id FROM work WHERE root_id = ?"
                outputs = "SELECT detail_id FROM work WHERE root_id = ? AND detail_id IS NOT NULL"
                self.db.execute(f"DELETE FROM tool_outputs WHERE id IN ({outputs})", (root_id,))
                for table, column in (
                    ("work_events", "work_id"),
                    ("job_steps", "job_id"),
                    ("work_job", "work_id"),
                    ("work_timer", "work_id"),
                    ("work_loop", "work_id"),
                    ("work_ask", "work_id"),
                ):
                    self.db.execute(f"DELETE FROM {table} WHERE {column} IN ({ids})", (root_id,))
                self.db.execute("DELETE FROM work WHERE root_id = ?", (root_id,))
        return len(roots)

    # ---- what is waiting ----

    def unreported(self, kinds: Sequence[str] | None = None) -> list[WorkRow]:
        where = "reported_at IS NULL AND state IN ('done','failed','cancelled','expired','blocked')"
        args: list = []
        if kinds is not None:
            where += f" AND kind IN ({','.join('?' * len(kinds))})"
            args += list(kinds)
        return self._select(where, args, "updated_at, rowid")

    def mark_reported(self, id: str) -> None:
        self.db.execute("UPDATE work SET reported_at = ? WHERE id = ?", (self._stamp(), id))

    def due(self, kinds: Sequence[str]) -> list[WorkRow]:
        marks = ",".join("?" * len(kinds))
        return self._select(
            f"state = 'planned' AND due_at IS NOT NULL AND due_at <= ? AND kind IN ({marks})",
            [self._stamp(), *kinds],
            "due_at, rowid",
        )

    def next_due(self, kinds: Sequence[str]) -> datetime | None:
        marks = ",".join("?" * len(kinds))
        text = self.db.execute(
            f"SELECT MIN(due_at) FROM work WHERE state = 'planned' AND kind IN ({marks})",
            list(kinds),
        ).fetchone()[0]
        return None if text is None else datetime.fromisoformat(text)

    # ---- restart ----

    def resume_scan(self, can_resume: Callable[[WorkRow], bool | None]) -> list[tuple[str, str]]:
        """Settle every unfinished row once, at start; returns (work_id, outcome) pairs.

        Idempotent: each row it touches ends or moves to a state the scan leaves alone, so a
        second start changes nothing and Scout is woken once per row (reported_at stays null).
        `can_resume(row)` says whether an expert call's saved session can be reopened.
        """
        done: list[tuple[str, str]] = []
        with transaction(self.db):
            for seen in self._select("state IN ('planned','active','blocked')", (), "rowid"):
                row = self._need(seen.id)  # an earlier move may have ended it
                outcome = self._settle(row, can_resume)
                if outcome is not None:
                    done.append((row.id, outcome))
        return done

    def _settle(self, row: WorkRow, can_resume: Callable[[WorkRow], bool | None]) -> str | None:
        unreported = {"reported_at": None}
        if row.kind in ("ask", "question") and row.state in ("planned", "active", "blocked"):
            self._move(row, "expired", "brain restarted", extra=unreported)
            return "expired"
        if row.state != "active":
            return None
        if row.kind == "expert_call":
            session = (row.checkpoint or {}).get("session_id")
            if session and can_resume(row) is not False:
                self._move(row, "blocked", "brain restarted", extra=unreported)
                self.add_event(row.id, "resumed", {"session_id": session})
                return "blocked"
            reason = "brain restarted, session cannot reload"
            self._move(row, "failed", reason, extra=unreported)
            self.add_event(row.id, "failed on restart", {"reason": reason})
            return "failed"
        if row.kind == "tool_call" and row.safe_to_retry:
            extra = {**unreported, "due_at": self._stamp()}
            self._move(row, "planned", None, extra=extra)
            self.add_event(row.id, "resumed")
            return "rerun"
        if row.kind == "tool_call":
            self._move(row, "failed", "brain restarted, unsure if it ran", extra=unreported)
            self.add_event(row.id, "failed on restart")
            return "failed"
        return None
