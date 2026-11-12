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
EVIDENCE_MIN_WORDS = 3  # a short quote ("Acme") proves nothing; this or EVIDENCE_MIN_CHARS
EVIDENCE_MIN_CHARS = 12


LIMIT_GAP = "Stopped: daily limit reached"
NO_KEY_GAP = "Add your Anthropic key first."


class BudgetStop(Exception):
    """Nothing more may be asked of the model; str(e) is the plain line to show why."""

    def __init__(self, gap: str = LIMIT_GAP) -> None:
        super().__init__(gap)


def stop_reason(model: Model, budget: Budget) -> BudgetStop | None:
    """Why the model may not be asked now: no key is not the same as a spent day."""
    if not model.ready:
        return BudgetStop(NO_KEY_GAP)
    if not budget.allows():
        return BudgetStop()
    return None


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
    if (stop := stop_reason(model, budget)) is not None:
        raise stop
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


_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"(?<!\w)\+?\d[\d ().-]{7,}\d(?!\w)")


def has_contact_details(text: str) -> bool:
    """A phone number or an email address: Scout has no use for them and Home would show them."""
    return bool(_EMAIL.search(text) or _PHONE.search(text))


def check(candidates: list[Candidate], material: Material) -> list[Candidate]:
    """Keep a candidate only if its evidence is in the material (whitespace and case aside),
    and neither it nor its evidence holds contact details."""
    haystack = normalise(material.text)
    kept = []
    for c in candidates:
        evidence = normalise(c.evidence)
        text = c.text.strip()
        # The model sees the material with "<" escaped as "&lt;", so evidence quoted from that
        # view never matches the raw text: it is dropped, which is the safe side.
        thin = len(evidence.split()) < EVIDENCE_MIN_WORDS and len(evidence) < EVIDENCE_MIN_CHARS
        if not text or len(text) > TEXT_MAX or thin or evidence not in haystack:
            continue
        if has_contact_details(text) or has_contact_details(c.evidence):
            continue
        kept.append(Candidate(normalise_tag(c.tag), text, c.evidence.strip(), c.ref))
    return kept


def _quoted(value: object, material: Material) -> str | None:
    if isinstance(value, str) and value.strip() and normalise(value) in normalise(material.text):
        return value.strip()
    return None


def _ref(given: object, material: Material, source: str) -> str:
    """Where a fact came from. The model may only narrow the material's own ref (a PDF page);
    a page's URL is never taken from it, so a fenced page cannot point a fact elsewhere."""
    if source != "web" and isinstance(given, str) and given.startswith(material.ref):
        return given
    return material.ref


async def extract(model: Model, budget: Budget, material: Material, source: str) -> Extraction:
    content: list[dict] = []
    if material.document is not None:
        content.append(material.document)
    content.append({"type": "text", "text": f"Source: {source}\n{fenced(material)}"})
    reply = await complete(model, budget, prompt("know_extract.md"), content)
    data = _json(reply)
    facts = data.get("facts")
    raw = [
        Candidate(
            str(f.get("tag", "")),
            str(f.get("text", "")),
            str(f.get("evidence", "")),
            _ref(f.get("ref"), material, source),
        )
        for f in (facts if isinstance(facts, list) else [])
        if isinstance(f, dict)
    ]
    return Extraction(
        check(raw, material),
        _quoted(data.get("name"), material),
        _quoted(data.get("employer"), material),
    )
