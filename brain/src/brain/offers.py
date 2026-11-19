"""Offers: after the person has allowed one kind of ask by hand several times, Scout may offer
to approve that kind from now on. Code decides when to look and caps how often; the model only
writes the sentence. Nothing is saved unless the person answers "Yes, auto-approve".
An offer is an `offer` open item with a card: nothing waits on it and no timer drops it. The
answer is a card answer this code takes (`answered`), and one not answered when the brain stops is
shown again when a body comes online (`resume`, which a connect calls).
An offer is also an Own task (Scout's own idea): done on Yes, declined on Keep asking, stopped
with reason `no answer` when it lapsed or the answer was not one of the two.
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
from brain.memory import Memory
from brain.mind.turn import Final, Model
from brain.open_items import OpenItem, OpenItemRefused, OpenItems
from brain.side_check import prompt_section
from brain.store import rules
from brain.store.db import utc_text
from brain.tasks import Tasks

log = logging.getLogger(__name__)

YES = "Yes, auto-approve"
KEEP = "Keep asking"
LOOK_TIMEOUT_S = 20.0
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
        items: OpenItems,
        tasks: Tasks,
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
        self._items = items
        self._task_rows = tasks  # `_tasks` below is the look futures
        self._approvals = approvals  # saves the preference, so Home hears about it
        self._settings = settings
        self._now = now
        self._tasks: set[asyncio.Task] = set()  # a bare task can be collected mid-flight
        self._busy: set[str] = set()  # groups with a look in flight
        asks.register("offer", self.answered)

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
        if not self._asks.anyone_online() or rules.has_preference_for(self._memory.db, group_key):
            return
        if any(i.saved_call["group"] == group_key for i in self._items.list_open(kind="offer")):
            return  # its offer is still waiting on the person
        now = self._now()
        offers = rules.offers_for(self._memory.db, group_key)
        if offers and offers[0][0] > utc_text(now - LOOK_GAP):
            return
        quiet_since = utc_text(now - timedelta(days=self._settings.keep_asking_days))
        if any(o == "keep_asking" and at > quiet_since for at, o in offers):
            return
        since = utc_text(now - timedelta(days=self._settings.window_days))
        count = self._approvals.work.person_asks_since(group_key, since)
        if count < self._settings.min_approvals:
            return
        verdict = await self._guards.run(Hook.model_call, ModelCallCtx("offer", None, 0))
        if verdict.kind != "allow":
            return
        sentence = await self._look(group_key, count)
        if sentence is None:
            rules.add_offer(self._memory.db, group_key, utc_text(self._now()), "none")
            return
        task = self._task_rows.open("own", "scout", title=sentence)
        item = self._items.open(
            "offer",
            task_id=task,
            saved_call={
                "group": group_key,
                "source": source,
                "tool": tool,
                "sentence": sentence,
            },
        )
        self._present(item)

    def resume(self) -> None:
        """Show again the offers the last run left unanswered. Called when a body connects, since
        at start nobody is there to see a card; with nobody online the items just stay open."""
        for item in self._items.expire_due(self._now(), "offer"):
            self._asks.expire(item.id, "timeout")  # the card of a lapsed offer leaves the screen
            self._end_task(item, "stopped", "no answer")
        if not self._asks.anyone_online():
            return
        for item in self._items.list_open(kind="offer"):
            if not self._asks.is_open(item.id):
                self._present(item)

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
            for a in self._approvals.work.list_asks("all", HISTORY_SCAN, None)
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

    def _present(self, item: OpenItem) -> None:
        """Put the card on screen and go on. The card is the model's sentence alone: the code adds
        no words."""
        call = item.saved_call
        self._asks.card(
            item.id,
            kind="offer",
            text=call["sentence"],
            options=[YES, KEEP],
            tool="approval_offer",
            input={"sentence": call["sentence"], "group": call["group"]},
        )

    def answered(
        self, ask_id: str, option: str, _body: str, _text: str | None, _at: str | None
    ) -> None:
        """The person answered the card: the preference is saved only on an explicit yes."""
        item = self._items.get(ask_id)
        if item is None:
            return
        if item.state != "open":  # it ended first: the tap still counts as a look with no answer
            self._end_task(item, "stopped", "no answer")
            rules.add_offer(
                self._memory.db, item.saved_call["group"], utc_text(self._now()), "no_answer"
            )
            return
        call = item.saved_call
        group_key = call["group"]
        outcome = "no_answer"
        if option in (YES, KEEP):
            try:
                self._items.answer(item.id, option, "person")
                outcome = "yes" if option == YES else "keep_asking"
            except OpenItemRefused:  # the click came after the deadline: it cannot count
                pass
        if outcome == "no_answer":
            self._items.finish(item.id, "no_answer")
        state, reason = {"yes": ("done", None), "keep_asking": ("declined", None)}.get(
            outcome, ("stopped", "no answer")
        )
        self._end_task(item, state, reason)
        if outcome == "yes":
            self._approvals.add_preference(
                sentence=call["sentence"],
                source=call["source"],
                tool=call["tool"],
                group_key=group_key,
            )
        rules.add_offer(self._memory.db, group_key, utc_text(self._now()), outcome)

    def _end_task(self, item: OpenItem, state: str, reason: str | None) -> None:
        if item.task_id is not None:
            self._task_rows.end(item.task_id, state, reason=reason)  # the first end stands
