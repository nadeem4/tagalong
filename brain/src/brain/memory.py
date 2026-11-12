"""Scout's long-term memory: one SQLite file in the data folder.

`Memory` is the one object the rest of the brain holds. Chat, memory items, apps and tool
outputs delegate to `brain.store`; the other areas keep their SQL here until their own slice.
"""

import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from brain.apps import AppRow
from brain.masking import WITHHELD
from brain.protocol import BODY_DESKTOP
from brain.store import connections, conversation, outputs
from brain.store import memory as memory_store
from brain.store import search as search_store
from brain.store.db import open_db
from brain.store.memory import Item, MemoryRefused, NewFact
from brain.store.search import Hit


class Memory:
    def __init__(
        self,
        path: Path | str,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        mask: Callable[[str], str] = lambda text: text,
    ):
        self._now = now
        # Memory text reaches disk masked. The brain builds Memory before the secrets it must
        # hide are known, so the session sets this to the save guard's mask once it has one.
        self.mask = mask
        self._db = open_db(path)

    @property
    def db(self) -> sqlite3.Connection:
        """The open connection, shared with stores that own their own tables (loops)."""
        return self._db

    def close(self) -> None:
        self._db.close()

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

    def set_app_package(self, app_id: str, config: dict, version: str) -> None:
        connections.set_app_package(self._db, app_id, config, version)

    def remove_app(self, app_id: str) -> None:
        connections.remove_app(self._db, app_id)

    def remember(
        self,
        kind: str,
        text: str,
        replaces: int | None = None,
        tag: str = "",
        evidence: str | None = None,
    ) -> Item:
        at = self._now().isoformat()
        masked = self.mask(text)
        if masked == WITHHELD:
            # A blocking save guard: saving "[withheld]" would store noise.
            raise MemoryRefused("A save guard withheld this text, so it was not remembered.")
        masked_evidence = self.mask(evidence) if evidence else None
        if masked_evidence == WITHHELD:
            masked_evidence = None
        return memory_store.remember(self._db, kind, masked, replaces, at, tag, masked_evidence)

    def forget(self, item_id: int) -> Item:
        return memory_store.forget(self._db, item_id)

    def list_items(self, limit: int) -> list[Item]:
        return memory_store.list_items(self._db, limit)

    def always_loaded(self) -> dict[str, list[Item]]:
        return memory_store.always_loaded(self._db)

    def save_source_facts(self, source: str, facts: list[NewFact]) -> list[Item]:
        masked = []
        for f in facts:
            text, evidence = self.mask(f.text), self.mask(f.evidence)
            if WITHHELD in (text, evidence):
                continue  # a blocking save guard: skip the fact rather than store noise
            masked.append(NewFact(f.tag, text, evidence, f.source_ref))
        return memory_store.save_source_facts(self._db, source, masked, self._now().isoformat())

    def profile_facts(self, include_asked: bool = True) -> list[Item]:
        return memory_store.profile_facts(self._db, include_asked)

    def chat_facts(self) -> list[Item]:
        return memory_store.chat_facts(self._db)

    def set_portrait(self, text: str) -> Item:
        masked = self.mask(text)
        if masked == WITHHELD:
            raise MemoryRefused("A save guard withheld this text, so it was not saved.")
        return memory_store.set_portrait(self._db, masked, self._now().isoformat())

    def portrait(self) -> Item | None:
        return memory_store.get_portrait(self._db)

    def add_summary(self, text: str) -> Item:
        return memory_store.add_summary(self._db, self.mask(text), self._now().isoformat())

    def save_messages(self, messages: list[dict], body: str = BODY_DESKTOP) -> None:
        conversation.save_messages(self._db, messages, self._now().isoformat(), body)

    def replace_last_message(self, message: dict) -> None:
        conversation.replace_last_message(self._db, message)

    def set_last_cut(self, cut: bool) -> None:
        conversation.set_last_cut(self._db, cut)

    def load_messages(self, include_cut: bool = False) -> list[dict]:
        return conversation.load_messages(self._db, include_cut)

    def search(
        self,
        query: str,
        kind: str | None = None,
        limit: int = 10,
        include_personal: bool = False,
    ) -> list[Hit]:
        return search_store.search(self._db, query, kind, limit, include_personal)
