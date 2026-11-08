"""Approvals: the log of every permission ask and how it ended.

The log is the decided `ask` work rows. The tool gate and expert jobs call `record`; it decides
the ask's row (or makes one when no ask was ever opened) and tells open panels the log changed.
"""

import json
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import TYPE_CHECKING

from brain.guards import Guards
from brain.masking import mask_json
from brain.memory import Memory
from brain.protocol import ErrorCode, RpcError
from brain.store import rules
from brain.store.db import utc_text
from brain.store.rules import Preference
from brain.store.work import WorkStore

if TYPE_CHECKING:
    from brain.toolbox import Handler, ToolSpec


class Approvals:
    def __init__(
        self,
        memory: Memory,
        work: WorkStore,
        notify: Callable[[str, dict], None],
        now: Callable[[], datetime],
        guards: Guards | None = None,
    ) -> None:
        self._memory = memory
        self.work = work
        self._notify = notify
        self._now = now
        self._guards = guards  # None: rows are stored as given

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
        preference: Preference | None = None,
        ask_id: str | None = None,
    ) -> None:
        """`ask_id` names the open ask this decides; without one the ask row is made here.
        `preference` is the one Scout answered under: it is counted as used and the person is
        told what Scout did, but only after the use is saved, so a failure writes no row."""
        if preference is not None:
            rules.use_preference(self._memory.db, preference.id, utc_text(self._now()))
        if self._guards is not None:  # the table is read by Home and Scout, so it holds no secret
            summary = mask_json(self._guards, "approval", summary)
            input = mask_json(self._guards, "approval", input)
        row = self.work.get(ask_id) if ask_id else None
        if row is None:
            ask_id = self.work.create(
                "ask",
                summary,
                id=ask_id or uuid.uuid4().hex,
                state="active",
                parent_id=self.work.open_goal(job_id),
            ).id
        elif not row.title:  # an expert's ask opens with no text
            self.work.update(ask_id, title=summary)
        self.work.add_ask(
            ask_id, source=source, tool=tool, summary=summary, input=input, group_key=group_key
        )
        self.work.decide_ask(
            ask_id,
            outcome,
            decided_by,
            preference.id if preference else None,
            preference.sentence if preference else None,
        )
        self._notify("changed", {"what": "approvals"})
        if preference is not None:
            self._notify(
                "approved", {"tool": tool, "text": summary, "preference": preference.sentence}
            )

    # Preference writes live here so every writer (Home, the offer) notifies the same way.
    def add_preference(
        self, *, sentence: str, source: str | None, tool: str | None, group_key: str | None
    ) -> Preference:
        pref = rules.add_preference(
            self._memory.db,
            sentence=sentence,
            source=source,
            tool=tool,
            group_key=group_key,
            at=utc_text(self._now()),
        )
        self._notify("changed", {"what": "approvals"})
        return pref

    def edit_preference(self, id: int, sentence: str) -> bool:
        changed = rules.edit_preference(self._memory.db, id, sentence)
        if changed:
            self._notify("changed", {"what": "approvals"})
        return changed

    def remove_preference(self, id: int) -> bool:
        removed = rules.remove_preference(self._memory.db, id)
        if removed:
            self._notify("changed", {"what": "approvals"})
        return removed


PAGE = 50
SENTENCE_MAX = 300
FILTERS = ("all", "scout", "refused")


def approval_home_tools(approvals: Approvals) -> "list[tuple[ToolSpec, Handler]]":
    """Home-only calls for the approvals history and the preferences list.

    ToolSpec is imported here because toolbox imports this module."""
    from brain.toolbox import ToolSpec

    memory = approvals._memory
    work = approvals.work

    def refuse(message: str) -> RpcError:
        return RpcError(ErrorCode.invalid_params, message)

    def known_id(args: dict) -> int:
        pid = args.get("id")
        if type(pid) is not int or all(p.id != pid for p in rules.list_preferences(memory.db)):
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
        rows = work.list_asks(filter, PAGE + 1, before)
        more = len(rows) > PAGE
        rows = rows[:PAGE]
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
                        "preference_id": r.rule_id,
                        "preference": r.rule_sentence,
                        "at": r.at,
                    }
                    for r in rows
                ],
                "counts": work.ask_counts(),
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
                    for p in rules.list_preferences(memory.db)
                ]
            }
        )

    async def remove_preference(args: dict) -> str:
        pid = known_id(args)
        approvals.remove_preference(pid)
        return json.dumps({"id": pid, "removed": True})

    async def edit_preference(args: dict) -> str:
        pid = known_id(args)
        sentence = args.get("sentence")
        sentence = sentence.strip() if isinstance(sentence, str) else ""
        if not 1 <= len(sentence) <= SENTENCE_MAX:
            raise refuse(f"A preference is 1 to {SENTENCE_MAX} characters.")
        approvals.edit_preference(pid, sentence)
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
