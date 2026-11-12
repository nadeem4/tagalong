"""The interjection: one short model call that decides what happens to speech already queued.

When news that may speak at the next pause arrives while Scout is talking, the queue holds at the
sentence break and this call sees the news and the sentences not yet said. Scout answers with one
of two tools: `speech_continue` (say the rest as planned) or `speech_replace` (say these words
instead). No tool means continue. The wording lives in mind/interjection.md; code only decides
when and keeps the call cheap. These are not toolbox tools: only this call ever sees them.
"""

import logging
from functools import cache
from importlib.resources import files

from brain.guards import Guards, Hook, ModelCallCtx
from brain.mind.turn import Final, Model
from brain.tools import _fence_safe

log = logging.getLogger("brain")

MAX_TOKENS = 300  # a short word, not a reply: this is one extra call on top of a running turn

TOOLS = [
    {
        "name": "speech_continue",
        "description": "Say the rest of what you were saying, as planned.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "speech_replace",
        "description": "Drop what you had left to say and say these words instead.",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string", "description": "What to say now."}},
            "required": ["text"],
        },
    },
]


@cache
def system() -> str:
    return files("brain.mind").joinpath("interjection.md").read_text(encoding="utf-8").strip()


def message(news: list[dict], unsaid: list[str]) -> list[dict]:
    """The one user message: the news (already fenced as data) and what is left to say."""
    left = (
        "\n".join(f"- {s}" for s in unsaid)
        or "(nothing is queued; the rest is still being written)"
    )
    text = "\n".join(b["text"] for b in news if b.get("type") == "text")
    text += f'\n\n<data kind="unsaid">\n{_fence_safe(left)}\n</data>'
    return [{"role": "user", "content": [{"type": "text", "text": text}]}]


def replacement(final: Final) -> str | None:
    """The words to say instead, or None to carry on (a continue, no tool, or an empty text)."""
    for block in final.content:
        if block.get("type") == "tool_use" and block.get("name") == "speech_replace":
            text = (block.get("input") or {}).get("text")
            return text.strip() if isinstance(text, str) and text.strip() else None
    return None


async def interject(model: Model, budget, guards: Guards, news: list[dict], unsaid: list[str]):
    """Ask once. Returns (ran, words): `ran` is False when a guard (the budget) said no, and
    `words` is what replaces the rest of the speech, or None to continue."""
    verdict = await guards.run(Hook.model_call, ModelCallCtx("interjection", None, 0))
    if verdict.kind != "allow":
        return False, None
    final = None
    async for item in model.stream(system(), message(news, unsaid), TOOLS, max_tokens=MAX_TOKENS):
        if isinstance(item, Final):
            final = item
    if final is None:
        return True, None
    budget.spend(final.usage, final.model or model.model_id)
    return True, replacement(final)
