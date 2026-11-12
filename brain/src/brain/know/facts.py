"""Which fact tags Scout may use freely and which it only raises when asked.

Work, skills, projects and interests are free; personal and any tag not listed are asked.
Pure rules, no storage: the memory store and the portrait writer both read them.
"""

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
