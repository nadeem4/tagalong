"""Turns material into facts, and keeps only the ones whose quoted evidence is really there.

The model proposes; code decides. A fact survives `check` only when its evidence, compared
without regard to whitespace or case, appears in the material. Material is a stranger's text,
so it is fenced as untrusted data and the system prompt says to ignore instructions in it.
"""

import json
import re
from dataclasses import dataclass
from functools import cache
from importlib.resources import files

from brain.guardrails import Budget
from brain.know.facts import Candidate, Material, normalise_tag
from brain.mind.turn import Final, Model
from brain.store.memory import normalise

TEXT_MAX = 500


class BudgetStop(Exception):
    """The daily limit is spent or there is no key: nothing more may be asked of the model."""


@dataclass
class Extraction:
    facts: list[Candidate]
    name: str | None
    employer: str | None


@cache
def prompt(name: str) -> str:
    return files("brain.mind").joinpath(name).read_text(encoding="utf-8")


async def complete(
    model: Model, budget: Budget, system: str, content: list[dict], max_tokens: int = 4000
) -> str:
    """One model call whose cost counts against the day; returns the reply's text."""
    if not model.ready or not budget.allows():
        raise BudgetStop
    last: Final | None = None
    messages = [{"role": "user", "content": content}]
    async for part in model.stream(system, messages, [], max_tokens):
        if isinstance(part, Final):
            last = part
    if last is None:
        return ""
    budget.spend(last.usage, last.model or model.model_id)
    return "".join(b.get("text", "") for b in last.content if b.get("type") == "text")


def fenced(material: Material) -> str:
    # No angle bracket in the text, so it cannot close its own fence.
    body = material.text.replace("<", "&lt;")
    ref = material.ref.replace('"', "")
    return f'<material untrusted="true" ref="{ref}">\n{body}\n</material>'


def _json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    try:
        data = json.loads(match.group(0)) if match else {}
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def check(candidates: list[Candidate], material: Material) -> list[Candidate]:
    """Keep a candidate only if its evidence is in the material (whitespace and case aside)."""
    haystack = normalise(material.text)
    kept = []
    for c in candidates:
        evidence = normalise(c.evidence)
        text = c.text.strip()
        if not text or len(text) > TEXT_MAX or not evidence or evidence not in haystack:
            continue
        kept.append(Candidate(normalise_tag(c.tag), text, c.evidence.strip(), c.ref))
    return kept


def _quoted(value: object, material: Material) -> str | None:
    if isinstance(value, str) and value.strip() and normalise(value) in normalise(material.text):
        return value.strip()
    return None


async def extract(model: Model, budget: Budget, material: Material, source: str) -> Extraction:
    content: list[dict] = []
    if material.document is not None:
        content.append(material.document)
    content.append({"type": "text", "text": f"Source: {source}\n{fenced(material)}"})
    reply = await complete(model, budget, prompt("know_extract.md"), content)
    data = _json(reply)
    raw = [
        Candidate(
            str(f.get("tag", "")),
            str(f.get("text", "")),
            str(f.get("evidence", "")),
            str(f.get("ref") or material.ref),
        )
        for f in data.get("facts", [])
        if isinstance(f, dict)
    ]
    return Extraction(
        check(raw, material),
        _quoted(data.get("name"), material),
        _quoted(data.get("employer"), material),
    )
