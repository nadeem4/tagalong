"""The one get-to-know-me run: starts at most one at a time and tells its watchers where it is.

A second start joins the run going. It reads the sources in order, saves each one's facts as it
finishes, then writes the portrait. The run lives only in memory (a restart ends it); status
goes out live, never replayed. The portrait gets its own last row so its gap is shown too.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime

from brain.guardrails import Budget
from brain.know import offer
from brain.know.extract import BudgetStop, extract
from brain.know.facts import Known
from brain.know.portrait import write_portrait
from brain.know.source import KnowSource, SourceGap
from brain.know.status import KnowMeStatus, SourceProgress
from brain.memory import Memory
from brain.mind.turn import Model
from brain.protocol import ErrorCode, RpcError
from brain.store.memory import NewFact

log = logging.getLogger("brain.know")

PORTRAIT = "portrait"
NOT_ENOUGH = "Not enough found to write a portrait."


class KnowMeRunner:
    def __init__(
        self,
        sources: list[KnowSource],
        memory: Memory,
        model: Model,
        budget: Budget,
        publish: Callable[[str, dict], None],
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        on_finish: Callable[[], None] = lambda: None,
    ) -> None:
        self._sources = sources
        self._memory = memory
        self._model = model
        self._budget = budget
        self._publish = publish  # publish(body_id, params): one live frame
        self._now = now
        self._on_finish = on_finish
        self._watchers: list[str] = []
        self._task: asyncio.Task | None = None
        self._status = KnowMeStatus()

    @property
    def sources(self) -> list[KnowSource]:
        return self._sources

    def start(self, body_id: str | None, github: str | None, pdf: bytes | None) -> bool:
        """True when a run was already going and this one joined it. A start by Scout (no body)
        has no watcher: nobody is waiting on a screen."""
        if github is None and pdf is None:
            raise RpcError(ErrorCode.invalid_params, "give a GitHub username, a PDF, or both")
        joined = self._task is not None and not self._task.done()
        if not joined:
            self._watchers = []  # a finished run's watchers do not carry over
            rows = [SourceProgress(s.name) for s in self._sources] + [SourceProgress(PORTRAIT)]
            self._status = KnowMeStatus(rows)
            self._task = asyncio.create_task(self._run(github, pdf))
        if body_id is not None:
            if body_id not in self._watchers:
                self._watchers.append(body_id)
            self._publish(body_id, self._status.params())
        return joined

    async def rewrite_portrait(self) -> str | None:
        """Write the portrait again from the saved facts (the owner corrected something)."""
        return await write_portrait(self._model, self._budget, self._memory)

    def status(self) -> KnowMeStatus:
        return self._status

    def drop_watcher(self, body_id: str) -> None:
        if body_id in self._watchers:
            self._watchers.remove(body_id)

    async def _run(self, github: str | None, pdf: bytes | None) -> None:
        try:
            await self._work(github, pdf)
        except Exception:
            # Without this a bug in the task would vanish and leave a body waiting forever.
            log.exception("know-me run failed")
            for row in self._status.sources:
                if row.state in ("waiting", "reading"):
                    row.state, row.gap = "failed", "Something went wrong."
        finally:
            self._status.done = True
            self._send()
            try:
                offer.mark_ran(self._memory.db, self._now())
            except Exception:
                log.exception("know-me: could not note the run")
            self._on_finish()

    async def _work(self, github: str | None, pdf: bytes | None) -> None:
        known = Known()
        stopped: str | None = None  # why the model may not be asked any more
        rows = {r.name: r for r in self._status.sources}
        for source in self._sources:
            row = rows[source.name]
            given = (
                github if source.needs == "username" else pdf if source.needs == "file" else None
            )
            if source.needs != "none" and given is None:
                row.state = "done"  # not offered, so nothing to read and nothing to report
                self._send()
                continue
            if stopped:
                row.state, row.gap = "failed", stopped
                self._send()
                continue
            row.state = "reading"
            self._send()
            try:
                known = await self._read(source, given, known)
                row.state = "done"
            except SourceGap as gap:
                row.state, row.gap = "failed", str(gap)[:200]
            except BudgetStop as stop:
                row.state, row.gap = "failed", str(stop)
                stopped = str(stop)
            except Exception:
                log.exception("know-me source failed: %s", source.name)
                row.state, row.gap = "failed", f"Something went wrong reading {source.label}."
            self._send()
        await self._portrait(rows[PORTRAIT], stopped)

    async def _read(self, source: KnowSource, given, known: Known) -> Known:
        """Read, extract and save one source; returns what the later sources can search with."""
        materials = await source.read(given, known)
        categories = self._memory.categories_in_use()
        # What other sources hold (earlier ones in this run included), so this one
        # does not say it again; this source's own old facts are about to be replaced.
        saved = [i.text for i in self._memory.profile_facts() if i.source != source.name]
        facts: list[NewFact] = []
        handle, urls = known.handle, list(known.urls)
        name, employer = known.name, known.employer
        for m in materials:
            handle = handle or m.keys.handle
            urls += [u for u in m.keys.urls if u not in urls]
            name, employer = name or m.keys.name, employer or m.keys.employer
            got = await extract(self._model, self._budget, m, source.label, categories, saved)
            name, employer = name or got.name, employer or got.employer
            facts += [
                NewFact(c.tag, c.text, c.evidence, c.ref, c.category or None, c.start, c.end)
                for c in got.facts
            ]
        self._memory.save_source_facts(source.name, facts)
        return Known(handle, tuple(urls), name, employer)

    async def _portrait(self, row: SourceProgress, stopped: str | None) -> None:
        if stopped:
            row.state, row.gap = "failed", stopped
        else:
            row.state = "reading"
            self._send()
            try:
                text = await write_portrait(self._model, self._budget, self._memory)
                row.state = "done"
                if text is None:
                    row.gap = NOT_ENOUGH
            except BudgetStop as stop:
                row.state, row.gap = "failed", str(stop)
            except Exception:
                log.exception("know-me portrait failed")
                row.state, row.gap = "failed", "Something went wrong writing the portrait."
        kept = self._memory.portrait()
        self._status.portrait = kept.text if kept else None

    def _send(self) -> None:
        params = self._status.params()
        for body_id in list(self._watchers):
            self._publish(body_id, params)
