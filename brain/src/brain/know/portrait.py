"""Writes the portrait: a few plain paragraphs about the owner, from saved free facts only.

Free profile facts and free chat memories (what the person told Scout; those win a conflict)
go in. Facts the person keeps for being asked (`asked`) never reach the model here. The
facts are fenced as data. The old portrait is kept whenever a new one
cannot be written (nothing to write from, an empty reply, the daily limit).
"""

from brain.guardrails import Budget
from brain.know.extract import complete, prompt
from brain.memory import Memory
from brain.mind.turn import Model
from brain.store.memory import Item

PORTRAIT_MAX = 600
_ENDS = (". ", "! ", "? ")


def _label(f: Item) -> str:
    """`work, 2019–now`: the tag, then the years when the fact is dated (open-ended means now)."""
    if not f.span_start:
        return f.tag
    start, end = f.span_start[:4], f.span_end[:4] if f.span_end else "now"
    return f"{f.tag}, {start if end == start else f'{start}–{end}'}"


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
    told = memory.chat_facts()
    if not facts and not told:
        return None
    rows = [f"- [{_label(f)}] {f.text}" for f in facts] + [f"- [chat] {f.text}" for f in told]
    lines = "\n".join(r.replace("<", "&lt;") for r in rows)
    content = [{"type": "text", "text": f'<facts untrusted="true">\n{lines}\n</facts>'}]
    reply = await complete(model, budget, prompt("know_portrait.md"), content, 1200)
    text = trim(reply)
    if not text:
        return None
    memory.set_portrait(text)
    return text
