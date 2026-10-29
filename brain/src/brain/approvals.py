"""Approvals: the log of every permission ask and how it ended.

The tool gate (and later expert jobs) call `record`; it stores one row and tells open panels
the log changed. `summarise` makes the one line shown in that log.
"""

import json
from collections.abc import Callable
from datetime import datetime

from brain.memory import Memory, _utc_text

SUMMARY_MAX = 200


class Approvals:
    def __init__(
        self,
        memory: Memory,
        notify: Callable[[str, dict], None],
        now: Callable[[], datetime],
    ) -> None:
        self._memory = memory
        self._notify = notify
        self._now = now

    def summarise(self, text: str, tool: str, input: dict) -> str:
        line = text or f"{tool} {json.dumps(input, sort_keys=True, separators=(',', ':'))}"
        return line[:SUMMARY_MAX]

    def record(
        self,
        *,
        source: str,
        tool: str,
        summary: str,
        input: dict,
        group_key: str,
        outcome: str,
        job_id: str | None = None,
        decided_by: str = "person",
        preference_id: int | None = None,
    ) -> None:
        self._memory.add_approval(
            source=source,
            tool=tool,
            summary=summary,
            input=input,
            job_id=job_id,
            group_key=group_key,
            outcome=outcome,
            decided_by=decided_by,
            preference_id=preference_id,
            at=_utc_text(self._now()),
        )
        self._notify("changed", {"what": "approvals"})
