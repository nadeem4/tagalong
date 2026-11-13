"""Which fact tags Scout may use freely and which it only raises when asked.

Work, skills, projects and interests are free; personal and any tag not listed are asked.
Pure rules, no storage: the memory store and the portrait writer both read them.
"""

import re
from dataclasses import dataclass, field
from typing import Literal

Visibility = Literal["free", "asked"]

TAG_VISIBILITY: dict[str, Visibility] = {
    "work": "free",
    "skills": "free",
    "projects": "free",
    "interests": "free",
    "personal": "asked",
}


def visibility_for(tag: str) -> Visibility:
    return TAG_VISIBILITY.get(tag, "asked")


def normalise_tag(tag: str) -> str:
    """Lowercase, trimmed, at most 20 characters, spaces as underscores; empty is "other"."""
    cleaned = "_".join(tag.strip().lower().split())[:20]
    return cleaned or "other"


_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
# Phone shape: optional +, then 9 or more digits with at most two separators between digits,
# so year ranges, dotted dates and version numbers (8 digits or fewer) pass.
_PHONE = re.compile(r"(?<!\w)\+?\d(?:[ ().-]{0,2}\d){8,}(?!\w)")
_YEAR = re.compile(r"(?:19|20)\d{2}")
_YEAR_IN_TEXT = re.compile(r"\b(?:19|20)\d{2}\b")

# Category names that point at a personal topic are dropped whatever the fact's tag, so a
# model-made category can never carry such a topic into the prompt.
PERSONAL_WORDS = frozenset(
    {
        "personal",
        "location",
        "family",
        "health",
        "home",
        "relationship",
        "relationships",
        "finance",
        "finances",
    }
)
CATEGORY_MAX = 30


def has_contact_details(text: str) -> bool:
    """A phone number or an email address: Scout has no use for them and Home would show them."""
    return bool(_EMAIL.search(text) or _PHONE.search(text))


def evidenced_span(start: object, end: object, evidence: str) -> tuple[str | None, str | None]:
    """The years a fact was true, kept only when the evidence says them in four digits.

    "now" as the end means still true: stored as no end, and only with an evidenced start.
    Anything else that fails (a year the source never states, an end before the start, an end
    with no start) saves the fact undated rather than with half a span."""
    said = set(_YEAR_IN_TEXT.findall(evidence))
    if not (isinstance(start, str) and _YEAR.fullmatch(start) and start in said):
        return None, None
    if end is None or (isinstance(end, str) and end.strip().casefold() == "now"):
        return start, None
    if not (isinstance(end, str) and _YEAR.fullmatch(end) and end in said) or end < start:
        return None, None
    return start, end


def normalise_category(name: object) -> str | None:
    """Trimmed, title case, at most 30 characters; None when empty or not safe to show."""
    if not isinstance(name, str):
        return None
    cleaned = " ".join(name.split()).title()[:CATEGORY_MAX].strip()
    if not cleaned or has_contact_details(cleaned):
        return None
    if any(w in PERSONAL_WORDS for w in re.findall(r"[a-z]+", cleaned.casefold())):
        return None
    return cleaned


@dataclass(frozen=True)
class Known:
    """What one source has learned about the person; the web search matches pages against it."""

    handle: str | None = None
    urls: tuple[str, ...] = ()
    name: str | None = None
    employer: str | None = None


@dataclass(frozen=True)
class Candidate:
    """A fact the model proposed: it counts only after its evidence is found in the material."""

    tag: str
    text: str
    evidence: str
    ref: str
    category: str = ""
    start: str | None = None
    end: str | None = None


@dataclass
class Material:
    """One page or file to read. `document` is a Claude document block when the source has one."""

    text: str
    ref: str
    document: dict | None = None
    keys: Known = field(default_factory=Known)
