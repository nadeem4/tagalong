"""Offers: after the person has allowed one kind of ask by hand several times, Scout may offer
to approve that kind from now on. Code decides when to look and caps how often; the model only
writes the sentence. Nothing is saved unless the person answers "Yes, auto-approve".
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from brain.approvals import SENTENCE_MAX, Approvals
from brain.asks import Asks
from brain.builtin_guards import spend_guards
from brain.config import DEFAULT_STEP_CAP
from brain.guards import Guards, Hook, ModelCallCtx
from brain.memory import Memory, _utc_text
from brain.mind.turn import Final, Model
from brain.side_check import prompt_section

log = logging.getLogger(__name__)

YES = "Yes, auto-approve"
KEEP = "Keep asking"
LOOK_TIMEOUT_S = 20.0
ASK_TIMEOUT_S = 600
LOOK_GAP = timedelta(days=1)
HISTORY_ROWS = 10
HISTORY_SCAN = 200

TOOLS = [
    {
        "name": "offer",
        "description": "Offer to approve this kind of action from now on.",
        "input_schema": {
            "type": "object",
            "properties": {"sentence": {"type": "string", "description": "the preference"}},
            "required": ["sentence"],
        },
    },
    {
        "name": "no_offer",
        "description": "Do not offer this time.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


@dataclass(frozen=True)
class OfferSettings:
    min_approvals: int
    window_days: int
    keep_asking_days: int


class Offers:
    def __init__(
        self,
        model: Model,
        budget,
        memory: Memory,
        asks: Asks,
        approvals: Approvals,
        settings: OfferSettings,
        now: Callable[[], datetime],
        guards: Guards | None = None,
    ) -> None:
        self._model = model
        self._budget = budget
        self._guards = guards or spend_guards(budget, DEFAULT_STEP_CAP)
        self._memory = memory
        self._asks = asks
        self._approvals = approvals  # saves the preference, so Home hears about it
        self._settings = settings
        self._now = now
        self._tasks: set[asyncio.Task] = set()  # a bare task can be collected mid-flight
        self._busy: set[str] = set()  # groups with a look or an offer in flight

    def consider(self, group_key: str, source: str, tool: str) -> None:
        """Called after a person's approval. Returns at once; the look runs in the background."""
        if group_key in self._busy:
            return
        self._busy.add(group_key)
        task = asyncio.get_running_loop().create_task(self._run(group_key, source, tool))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, group_key: str, source: str, tool: str) -> None:
        try:
            await self._consider(group_key, source, tool)
        except Exception:  # never reaches the ask path that spawned it
            log.exception("offer failed")
        finally:
            self._busy.discard(group_key)

    async def _consider(self, group_key: str, source: str, tool: str) -> None:
        # Cheap checks first: most approvals end here without a model call.
        if not self._asks.anyone_online() or self._memory.has_preference_for(group_key):
            return
        now = self._now()
        offers = self._memory.offers_for(group_key)
        if offers and offers[0][0] > _utc_text(now - LOOK_GAP):
            return
        quiet_since = _utc_text(now - timedelta(days=self._settings.keep_asking_days))
        if any(o == "keep_asking" and at > quiet_since for at, o in offers):
            return
        since = _utc_text(now - timedelta(days=self._settings.window_days))
        count = self._memory.person_approvals_since(group_key, since)
        if count < self._settings.min_approvals:
            return
        verdict = await self._guards.run(Hook.model_call, ModelCallCtx("offer", None, 0))
        if verdict.kind != "allow":
            return
        sentence = await self._look(group_key, count)
        if sentence is None:
            self._memory.add_offer(group_key, _utc_text(self._now()), "none")
            return
        outcome = await self._offer(group_key, source, tool, count, sentence)
        self._memory.add_offer(group_key, _utc_text(self._now()), outcome)

    async def _look(self, group_key: str, count: int) -> str | None:
        """The model's one-sentence offer, or None for no offer (errors included)."""
        try:
            async with asyncio.timeout(LOOK_TIMEOUT_S):
                final = await self._stream(group_key, count)
        except Exception:  # a failed look still counts, so it cannot repeat every approval
            log.exception("offer look failed")
            return None
        if final is None:
            return None
        self._budget.spend(final.usage, final.model or self._model.model_id)
        call = next((b for b in final.content if b.get("type") == "tool_use"), None)
        if call is None or call.get("name") != "offer":
            return None
        sentence = (call.get("input") or {}).get("sentence")
        sentence = sentence.strip() if isinstance(sentence, str) else ""
        return sentence[:SENTENCE_MAX] or None

    async def _stream(self, group_key: str, count: int) -> Final | None:
        recent = [
            a.summary
            for a in self._memory.list_approvals("all", HISTORY_SCAN, None)
            if a.group_key == group_key and a.outcome == "approved" and a.decided_by == "person"
        ][:HISTORY_ROWS]
        text = "\n".join(
            [
                f"Group: {group_key}",
                f"Approved by the owner {count} times in the last "
                f"{self._settings.window_days} days.",
                "",
                "Recent approvals:",
                *recent,
            ]
        )
        final = None
        async for item in self._model.stream(
            prompt_section("offer"), [{"role": "user", "content": text}], TOOLS
        ):
            if isinstance(item, Final):
                final = item
        return final

    async def _offer(
        self, group_key: str, source: str, tool: str, count: int, sentence: str
    ) -> str:
        """Ask the person; the preference is saved only on an explicit yes."""
        lead = f"You've allowed {group_key} {count} times lately. Approve it from now on? "
        try:
            answer = await self._asks.open(
                text=f"{lead}“{sentence}”",
                options=[YES, KEEP],
                tool="approval_offer",
                input={"sentence": sentence, "group": group_key},
                timeout=ASK_TIMEOUT_S,
            )
        except Exception:  # timeout, cancel or a broken transport: no answer
            return "no_answer"
        if answer.option == KEEP:
            return "keep_asking"
        if answer.option != YES:
            return "no_answer"
        self._approvals.add_preference(
            sentence=sentence, source=source, tool=tool, group_key=group_key
        )
        return "yes"
