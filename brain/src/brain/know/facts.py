"""Which fact tags Scout may use freely and which it only raises when asked.

Work, skills, projects and interests are free; personal and any tag not listed are asked.
Pure rules, no storage: the memory store and the portrait writer both read them.
"""

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


@dataclass
class Material:
    """One page or file to read. `document` is a Claude document block when the source has one."""

    text: str
    ref: str
    document: dict | None = None
    keys: Known = field(default_factory=Known)
