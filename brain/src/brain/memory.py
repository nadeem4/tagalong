"""Scout's long-term memory: one SQLite file in the data folder.

`Memory` is the one object the rest of the brain holds. Chat, memory items, apps and tool
outputs delegate to `brain.store`; the other areas keep their SQL here until their own slice.
"""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from brain.apps import AppRow
from brain.store import connections, conversation, outputs
from brain.store import memory as memory_store
from brain.store import search as search_store
from brain.store.db import open_db
from brain.store.memory import Item
from brain.store.search import Hit


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
    preference_sentence: str | None = None


class Memory:
    def __init__(
        self,
        path: Path | str,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ):
        self._now = now
        self._db = open_db(path)

    @property
    def db(self) -> sqlite3.Connection:
        """The open connection, shared with stores that own their own tables (loops)."""
        return self._db

    def close(self) -> None:
        self._db.close()

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
        preference_sentence: str | None = None,
    ) -> int:
        cur = self._db.execute(
            "INSERT INTO approvals(source, tool, summary, input, job_id, group_key, outcome,"
            " decided_by, preference_id, at, preference_sentence) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (source, tool, summary, json.dumps(input), job_id, group_key, outcome, decided_by,
             preference_id, at, preference_sentence),
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
            f" preference_id, at, preference_sentence FROM approvals {clause}"
            " ORDER BY id DESC LIMIT ?",
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

    # Chat, memory items, apps and tool outputs keep their SQL in brain.store.

    def put_output(self, output_id: str, tool: str, text: str) -> None:
        outputs.put_output(self._db, output_id, tool, text, self._now().isoformat())

    def get_output(self, output_id: str) -> str | None:
        return outputs.get_output(self._db, output_id)

    def prune_outputs(self, keep: int) -> None:
        outputs.prune_outputs(self._db, keep)

    def list_apps(self) -> list[AppRow]:
        return connections.list_apps(self._db)

    def add_app(self, row: AppRow) -> None:
        connections.add_app(self._db, row)

    def set_app_enabled(self, app_id: str, enabled: bool) -> None:
        connections.set_app_enabled(self._db, app_id, enabled)

    def remove_app(self, app_id: str) -> None:
        connections.remove_app(self._db, app_id)

    def remember(self, kind: str, text: str, replaces: int | None = None) -> Item:
        return memory_store.remember(self._db, kind, text, replaces, self._now().isoformat())

    def forget(self, item_id: int) -> Item:
        return memory_store.forget(self._db, item_id)

    def list_items(self, limit: int) -> list[Item]:
        return memory_store.list_items(self._db, limit)

    def always_loaded(self) -> dict[str, list[Item]]:
        return memory_store.always_loaded(self._db)

    def add_summary(self, text: str) -> Item:
        return memory_store.add_summary(self._db, text, self._now().isoformat())

    def save_messages(self, messages: list[dict]) -> None:
        conversation.save_messages(self._db, messages, self._now().isoformat())

    def replace_last_message(self, message: dict) -> None:
        conversation.replace_last_message(self._db, message)

    def load_messages(self) -> list[dict]:
        return conversation.load_messages(self._db)

    def search(self, query: str, kind: str | None = None, limit: int = 10) -> list[Hit]:
        return search_store.search(self._db, query, kind, limit)
