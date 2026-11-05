"""Context trigger: does the window or tab the person is in mean "you are working on this loop"?

Pure rules, no model. A false match makes Scout interrupt for nothing, so the rules lean
strict: an anchor needs two real words (or a file name), common window titles never match,
and a URL matches on host and path only (the query is ignored).
"""

import re
from urllib.parse import urlparse

from brain.loops.loop import Loop

# Titles that say nothing about the work, and app names every window of that app carries.
_STOP = frozenset(
    "untitled document document1 new tab inbox home desktop google chrome edge firefox microsoft"
    " word excel powerpoint notepad file page search start".split()
)
_EXT = re.compile(r"\.[a-z0-9]{2,5}$")
_MAIL_WORDS = ("gmail", "outlook", "thunderbird")
_MAIL_HOSTS = ("mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com")


def _words(text: str) -> list[str]:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).split()


def _host_path(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    return (parsed.hostname or "").removeprefix("www."), parsed.path.rstrip("/")


def _url_matches(anchor: str, url: str) -> bool:
    host, path = _host_path(anchor)
    if not path or not url:  # a bare host would match a whole site
        return False
    seen_host, seen_path = _host_path(url)
    return host == seen_host and (seen_path == path or seen_path.startswith(path + "/"))


def matches(anchor: str, title: str, url: str = "") -> bool:
    anchor = anchor.strip()
    if anchor.startswith(("http://", "https://")):
        return _url_matches(anchor, url)
    seen = _words(title)
    ext = _EXT.search(anchor.lower())
    name = [w for w in _words(anchor[: ext.start()] if ext else anchor) if w not in _STOP]
    if ext and name:  # a file name: the whole name and its extension in the title
        padded = " " + " ".join(seen) + " "
        if f" {' '.join(name)} " in padded and ext.group()[1:] in seen:
            return True
    meaningful = [w for w in _words(anchor) if w not in _STOP]
    if len(meaningful) < 2:
        return False
    shared = set(meaningful) & set(seen)
    # Two shared words, and at least half the anchor, so a long anchor needs more than a topic.
    return len(shared) >= 2 and 2 * len(shared) >= len(meaningful)


def find(loop: Loop, title: str, url: str = "") -> str | None:
    """The first anchor of the loop that this window or tab matches."""
    return next((a for a in loop.anchors if matches(a, title, url)), None)


def mail_in_front(app: str, title: str, url: str) -> bool:
    """Opening the mail itself must not surface the loops made from it."""
    host = _host_path(url)[0] if url else ""
    if host in _MAIL_HOSTS:
        return True
    seen = f"{app} {title}".lower()
    return any(word in seen for word in _MAIL_WORDS)
