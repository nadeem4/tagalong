"""Approvals: the log of every permission ask and how it ended.

The tool gate (and later expert jobs) call `record`; it stores one row and tells open panels
the log changed. `summarise` makes the one line shown in that log.
"""

import json
from collections.abc import Callable
from datetime import datetime
from typing import TYPE_CHECKING

from brain.memory import Memory, _utc_text
from brain.protocol import ErrorCode, RpcError

if TYPE_CHECKING:
    from brain.toolbox import Handler, ToolSpec

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


PAGE = 50
SENTENCE_MAX = 300
FILTERS = ("all", "scout", "refused")


def approval_home_tools(approvals: Approvals) -> "list[tuple[ToolSpec, Handler]]":
    """Home-only calls for the approvals history and the preferences list.

    ToolSpec is imported here because toolbox imports this module."""
    from brain.toolbox import ToolSpec

    memory = approvals._memory

    def refuse(message: str) -> RpcError:
        return RpcError(ErrorCode.invalid_params, message)

    def known_id(args: dict) -> int:
        pid = args.get("id")
        if type(pid) is not int or all(p.id != pid for p in memory.list_preferences()):
            raise refuse(f"There is no preference {pid}.")
        return pid

    async def list_approvals(args: dict) -> str:
        filter = args.get("filter", "all")
        before = args.get("before")
        if filter not in FILTERS:
            raise refuse("filter is all, scout or refused.")
        if before is not None and type(before) is not int:
            raise refuse("before is an approval id.")
        # One extra row tells whether another page exists.
        rows = memory.list_approvals(filter, PAGE + 1, before)
        more = len(rows) > PAGE
        rows = rows[:PAGE]
        sentences = {p.id: p.sentence for p in memory.list_preferences()}
        return json.dumps(
            {
                "approvals": [
                    {
                        "id": r.id,
                        "source": r.source,
                        "tool": r.tool,
                        "summary": r.summary,
                        "input": r.input,
                        "job_id": r.job_id,
                        "outcome": r.outcome,
                        "decided_by": r.decided_by,
                        "preference_id": r.preference_id,
                        "preference": sentences.get(r.preference_id),
                        "at": r.at,
                    }
                    for r in rows
                ],
                "counts": memory.approval_counts(),
                "next": rows[-1].id if more else None,
            }
        )

    async def list_preferences(args: dict) -> str:
        return json.dumps(
            {
                "preferences": [
                    {
                        "id": p.id,
                        "sentence": p.sentence,
                        "source": p.source,
                        "tool": p.tool,
                        "builtin": p.builtin,
                        "created_at": p.created_at,
                        "use_count": p.use_count,
                        "last_used": p.last_used,
                    }
                    for p in memory.list_preferences()
                ]
            }
        )

    async def remove_preference(args: dict) -> str:
        pid = known_id(args)
        memory.remove_preference(pid)
        approvals._notify("changed", {"what": "approvals"})
        return json.dumps({"id": pid, "removed": True})

    async def edit_preference(args: dict) -> str:
        pid = known_id(args)
        sentence = args.get("sentence")
        sentence = sentence.strip() if isinstance(sentence, str) else ""
        if not 1 <= len(sentence) <= SENTENCE_MAX:
            raise refuse(f"A preference is 1 to {SENTENCE_MAX} characters.")
        memory.edit_preference(pid, sentence)
        approvals._notify("changed", {"what": "approvals"})
        return json.dumps({"id": pid, "sentence": sentence})

    home = frozenset({"home"})
    empty = {"type": "object", "properties": {}}
    by_id = {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}
    list_schema = {
        "type": "object",
        "properties": {
            "filter": {"type": "string", "enum": list(FILTERS)},
            "before": {"type": "integer"},
        },
    }
    edit_schema = {
        "type": "object",
        "properties": {"id": {"type": "integer"}, "sentence": {"type": "string"}},
        "required": ["id", "sentence"],
    }
    return [
        (
            ToolSpec(
                "list_approvals",
                "Recent permission decisions, newest first, with counts.",
                list_schema,
                home,
                effect="read",
            ),
            list_approvals,
        ),
        (
            ToolSpec(
                "list_preferences",
                "The approval preferences Scout follows.",
                empty,
                home,
                effect="read",
            ),
            list_preferences,
        ),
        (
            ToolSpec("remove_preference", "Remove a preference.", by_id, home, effect="change"),
            remove_preference,
        ),
        (
            ToolSpec(
                "edit_preference", "Rewrite a preference.", edit_schema, home, effect="change"
            ),
            edit_preference,
        ),
    ]
