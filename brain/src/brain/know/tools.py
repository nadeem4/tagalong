"""Scout's get-to-know-me tools, and Home's list of what can be read.

`get_to_know_me` runs on the person's say-so (the yes or the button is the consent). The offer
rules are code: `offered` is refused unless `offer.allowed`, so Scout cannot nag. The tools are
always registered; only the offer path is gated.
"""

import json
from collections.abc import Callable
from datetime import datetime

from brain.know import offer
from brain.know.extract import BudgetStop
from brain.know.runner import KnowMeRunner
from brain.memory import Memory
from brain.store.memory import MemoryRefused
from brain.toolbox import Handler, ToolSpec

Notify = Callable[[str, dict], None]

_STARTED = (
    "Started reading their public GitHub profile, then the web; the portrait is written when "
    "it finishes. For the LinkedIn PDF, open Home and press Get to know me."
)
_NEEDS_GITHUB = (
    "A run needs a GitHub username. Ask for it, or send them to Home and press Get to know me "
    "(that also takes a LinkedIn PDF)."
)


def know_me_tools(
    runner: KnowMeRunner, memory: Memory, now: Callable[[], datetime], notify: Notify
) -> list[tuple[ToolSpec, Handler]]:
    async def get_to_know_me(args: dict) -> str:
        action = args.get("action")
        if action == "start":
            github = (args.get("github") or "").strip().lstrip("@")
            if not github:
                return _NEEDS_GITHUB
            state = offer.load(memory.db)
            state.declined = False  # they asked, so an earlier no no longer stands
            offer.save(memory.db, state)
            if runner.start(None, github, None):
                return (
                    f"A run was already going, so '{github}' was not used; it will finish "
                    "with what it was given."
                )
            return _STARTED
        if action == "offered":
            if not offer.allowed(offer.load(memory.db), now()):
                raise MemoryRefused(
                    "Do not offer: they already did this, said no, or were asked recently."
                )
            offer.mark_offered(memory.db, now())
            return "Noted. Make the offer in your own words, once."
        if action == "declined":
            offer.mark_declined(memory.db)
            return "Noted. Do not offer again unless they ask."
        raise MemoryRefused("action must be start, offered or declined.")

    async def rewrite_portrait(args: dict) -> str:
        try:
            text = await runner.rewrite_portrait()
        except BudgetStop as stop:
            raise MemoryRefused(f"{stop} The portrait was not rewritten.") from None
        if text is None:
            return "There is nothing to write a portrait from yet."
        notify("changed", {"what": "memory"})
        return "Rewrote the portrait from the saved facts."

    async def know_me_sources(args: dict) -> str:
        return json.dumps(
            [{"name": s.name, "needs": s.needs, "label": s.label} for s in runner.sources]
        )

    scout = frozenset({"scout"})
    return [
        (
            ToolSpec(
                "get_to_know_me",
                "Read the owner's public profiles so you know who they are. action start (with "
                "their GitHub username) runs it once they said yes; the LinkedIn PDF goes in "
                "through Home. action offered: call before you offer, it refuses when an offer "
                "is not due. action declined: they said no.",
                {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": ["start", "offered", "declined"]},
                        "github": {"type": "string", "description": "GitHub username, for start."},
                    },
                    "required": ["action"],
                },
                scout,
                effect="change",
                default_mode="auto",  # pressing the button or saying yes is the consent
            ),
            get_to_know_me,
        ),
        (
            ToolSpec(
                "rewrite_portrait",
                "Write the portrait of the owner again from the saved facts, for example after "
                "you corrected or forgot a fact.",
                {"type": "object", "properties": {}},
                scout,
                effect="change",
                default_mode="auto",
            ),
            rewrite_portrait,
        ),
        (
            ToolSpec(
                "know_me_sources",
                "Which sources get to know me can read and what each needs.",
                {"type": "object", "properties": {}},
                frozenset({"home"}),
                effect="read",
            ),
            know_me_sources,
        ),
    ]
