"""Writes the portrait: a few plain paragraphs about the owner, from saved free facts only.

Facts the person keeps for being asked (`asked`) never reach the model here. The facts came
from strangers' text, so they are fenced as data. The old portrait is kept whenever a new one
cannot be written (nothing to write from, an empty reply, the daily limit).
"""

from brain.guardrails import Budget
from brain.know.extract import complete, prompt
from brain.memory import Memory
from brain.mind.turn import Model

PORTRAIT_MAX = 1500
_ENDS = (". ", "! ", "? ")


def trim(text: str) -> str:
    """At most PORTRAIT_MAX characters, cut at the last sentence end when there is one."""
    text = text.strip()
    if len(text) <= PORTRAIT_MAX:
        return text
    head = text[:PORTRAIT_MAX]
    cut = max(head.rfind(e) for e in _ENDS)
    if cut > 0:
        return head[: cut + 1]
    return head


async def write_portrait(model: Model, budget: Budget, memory: Memory) -> str | None:
    """Returns the saved portrait, or None when there was nothing to write. BudgetStop passes."""
    facts = memory.profile_facts(include_asked=False)
    if not facts:
        return None
    lines = "\n".join(f"- [{f.tag}] {f.text}".replace("<", "&lt;") for f in facts)
    content = [{"type": "text", "text": f'<facts untrusted="true">\n{lines}\n</facts>'}]
    reply = await complete(model, budget, prompt("know_portrait.md"), content, 1200)
    text = trim(reply)
    if not text:
        return None
    memory.set_portrait(text)
    return text
