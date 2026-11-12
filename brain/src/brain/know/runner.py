"""The one get-to-know-me run: starts at most one at a time and tells its watchers where it is.

A second start while a run is going joins it. The run lives only in memory (a restart ends it),
and status goes out live, never replayed. This is the shell: K4 fills `_run` with the sources.
"""

import asyncio
from collections.abc import Callable

from brain.know.status import KnowMeStatus, SourceProgress
from brain.protocol import ErrorCode, RpcError


class KnowMeRunner:
    def __init__(self, sources: list, publish: Callable[[str, dict], None]) -> None:
        self._sources = sources
        self._publish = publish  # publish(body_id, params): one live frame
        self._watchers: list[str] = []
        self._task: asyncio.Task | None = None
        self._status = KnowMeStatus()

    def start(self, body_id: str, github: str | None, pdf: bytes | None) -> bool:
        """True when a run was already going and this body joined it."""
        if github is None and pdf is None:
            raise RpcError(ErrorCode.invalid_params, "give a GitHub username, a PDF, or both")
        joined = self._task is not None and not self._task.done()
        if not joined:
            self._watchers = []  # a finished run's watchers do not carry over
            self._status = KnowMeStatus([SourceProgress(s.name) for s in self._sources])
            self._task = asyncio.create_task(self._run(github, pdf))
        if body_id not in self._watchers:
            self._watchers.append(body_id)
        self._publish(body_id, self._status.params())
        return joined

    def status(self) -> KnowMeStatus:
        return self._status

    def drop_watcher(self, body_id: str) -> None:
        if body_id in self._watchers:
            self._watchers.remove(body_id)

    async def _run(self, github: str | None, pdf: bytes | None) -> None:
        for source in self._status.sources:
            source.state = "done"
        self._status.done = True
        self._send()

    def _send(self) -> None:
        params = self._status.params()
        for body_id in list(self._watchers):
            self._publish(body_id, params)
