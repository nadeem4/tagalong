"""SideCheck: before an approval ask reaches the person, Scout may approve it under one of
their preferences or pass. Code decides when to look and enforces the guard rails; the model
only decides whether a preference clearly covers the ask. Any doubt, error or delay is a pass.
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from functools import cache
from importlib.resources import files

from brain.builtin_guards import spend_guards
from brain.config import DEFAULT_STEP_CAP
from brain.guards import Guards, Hook, ModelCallCtx
from brain.memory import Memory, Preference
from brain.mind.turn import Final, Model

log = logging.getLogger(__name__)

HISTORY_ROWS = 10
HISTORY_SCAN = 200
INPUT_MAX = 4000  # characters of the ask's input shown to the model

TOOLS = [
    {
        "name": "approve_under_preference",
        "description": "Approve this one action because a preference clearly covers it.",
        "input_schema": {
            "type": "object",
            "properties": {
                "preference": {"type": "integer", "description": "id of the covering preference"},
                "reason": {"type": "string"},
            },
            "required": ["preference", "reason"],
        },
    },
    {
        "name": "pass_to_person",
        "description": "Leave this ask for the owner to answer.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


@dataclass(frozen=True)
class AskFacts:
    source: str
    tool: str
    summary: str
    input: dict
    group_key: str
    locked: bool  # a tool that always confirms with the person


@cache
def prompt_section(name: str) -> str:
    """One `## name` section of mind/approvals.md; the wording lives there, not in code."""
    text = files("brain.mind").joinpath("approvals.md").read_text(encoding="utf-8")
    for part in ("\n" + text).split("\n## ")[1:]:
        head, _, body = part.partition("\n")
        if head.strip() == name:
            return body.strip()
    raise RuntimeError(f"mind/approvals.md has no ## {name} section")


class SideCheck:
    def __init__(
        self,
        model: Model,
        budget,
        memory: Memory,
        timeout: float = 20.0,
        guards: Guards | None = None,
    ) -> None:
        self._guards = guards or spend_guards(budget, DEFAULT_STEP_CAP)
        self._model = model
        self._budget = budget
        self._memory = memory
        self._timeout = timeout

    async def decide(self, facts: AskFacts) -> Preference | None:
        # Order matters: the cheap checks run first so a person with no preferences pays nothing.
        if not self._memory.has_user_preferences():
            return None
        candidates = self._candidates(facts)
        if not candidates:
            return None
        verdict = await self._guards.run(Hook.model_call, ModelCallCtx("side_check", None, 0))
        if verdict.kind != "allow":
            return None
        try:
            async with asyncio.timeout(self._timeout):
                final = await self._ask(facts, candidates)
        except Exception:  # TimeoutError included: every failure leaves the ask to the person
            log.exception("side-check failed")
            return None
        if final is None:
            return None
        self._budget.spend(final.usage, final.model or self._model.model_id)
        call = next((b for b in final.content if b.get("type") == "tool_use"), None)
        if call is None or call.get("name") != "approve_under_preference":
            return None
        wanted = (call.get("input") or {}).get("preference")
        # Re-read now: the person may have removed the preference while the model thought.
        for p in self._candidates(facts):
            if p.id == wanted:
                return p
        return None

    def _candidates(self, facts: AskFacts) -> list[Preference]:
        """Preferences Scout may approve under. A locked tool needs one that names it: a
        general preference never unlocks it, so the person's explicit word is required."""
        prefs = [p for p in self._memory.list_preferences() if not p.builtin]
        if facts.locked:
            prefs = [p for p in prefs if p.tool == facts.tool]
        return prefs

    async def _ask(self, facts: AskFacts, candidates: list[Preference]) -> Final | None:
        message = self._message(facts, candidates)
        final = None
        async for item in self._model.stream(prompt_section("decide"), message, TOOLS):
            if isinstance(item, Final):
                final = item
        return final

    def _message(self, facts: AskFacts, candidates: list[Preference]) -> list[dict]:
        shown = candidates
        if not facts.locked:  # the default shows as context, never as a choice
            shown = self._memory.list_preferences()
        prefs = [f"{p.id}{' (default)' if p.builtin else ''}: {p.sentence}" for p in shown]
        history = [
            f"{a.outcome} by {a.decided_by}: {a.summary}"
            for a in self._memory.list_approvals("all", HISTORY_SCAN, None)
            if a.tool == facts.tool or a.group_key == facts.group_key
        ][:HISTORY_ROWS]
        text = "\n".join(
            [
                "Preferences:",
                *prefs,
                "",
                f"Ask from {facts.source}, tool {facts.tool}: {facts.summary}",
                f"Input: {json.dumps(facts.input)[:INPUT_MAX]}",
                "",
                "Recent history for this tool or group:",
                *(history or ["none"]),
            ]
        )
        return [{"role": "user", "content": text}]
