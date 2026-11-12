"""The web source: searches for the person and keeps only pages that are provably theirs.

A name alone is not a match (namesakes are everywhere). A page is kept when it holds the
person's handle, one of their listed URLs, or both their name and their employer. Other
sources supply those keys, so the web runs last and is skipped when there are none.
"""

import re

from brain.guardrails import Budget
from brain.know.extract import prompt, stop_reason
from brain.know.facts import Known, Material
from brain.know.source import SourceGap
from brain.mind.turn import Final, Model
from brain.store.memory import normalise
from brain.web_tools import SPECS

PAGE_MAX = 20_000  # characters kept of one page


def matches(text: str, known: Known) -> bool:
    body = normalise(text)
    # A handle counts only in handle form (@h, github.com/h): "amy" as a plain word is a first name.
    if known.handle:
        h = re.escape(known.handle.casefold())
        if re.search(rf"(?<![\w@])@{h}(?![\w-])|github\.com/{h}(?![\w-])", body):
            return True
    for u in known.urls:
        u = u.strip().rstrip("/").casefold()
        if u and re.search(re.escape(u) + r"(?![\w-]|\.\w)", body):
            return True
    return bool(
        known.name
        and known.employer
        and normalise(known.name) in body
        and normalise(known.employer) in body
    )


def _pages(content: list[dict]) -> list[tuple[str, str]]:
    """(url, text) for every page a web_fetch result carries."""
    pages = []
    for block in content:
        if block.get("type") != "web_fetch_tool_result":
            continue
        result = block.get("content")
        if not isinstance(result, dict) or result.get("type") != "web_fetch_result":
            continue
        doc = result.get("content") or {}
        source = doc.get("source") if isinstance(doc, dict) else None
        if not isinstance(source, dict) or source.get("type") != "text":
            continue  # a PDF or other file comes base64: not readable text
        text = source.get("data")
        if isinstance(text, str) and text.strip():
            pages.append((str(result.get("url", "")), text[:PAGE_MAX]))
    return pages


class WebSource:
    name = "web"
    needs = "none"
    label = "The web"

    def __init__(self, model: Model, budget: Budget) -> None:
        self._model = model
        self._budget = budget

    async def read(self, given: str | bytes | None, known: Known) -> list[Material]:
        has_keys = known.handle or known.urls or (known.name and known.employer)
        if not has_keys:
            raise SourceGap("No GitHub name or employer to search with, so the web was skipped.")
        if (stop := stop_reason(self._model, self._budget)) is not None:
            raise stop
        details = [
            f"{k}: {v}"
            for k, v in (
                ("Name", known.name),
                ("Handle", known.handle),
                ("Employer", known.employer),
            )
            if v
        ]
        details += [f"Link: {u}" for u in known.urls]
        messages = [{"role": "user", "content": "\n".join(details)}]
        tools = [s.server_tool for s in SPECS]
        last: Final | None = None
        async for part in self._model.stream(prompt("know_web.md"), messages, tools, 4000):
            if isinstance(part, Final):
                last = part
        if last is None:
            raise SourceGap("No web pages matched you.")
        self._budget.spend(last.usage, last.model or self._model.model_id)
        kept = [
            Material(text, ref=url) for url, text in _pages(last.content) if matches(text, known)
        ]
        if not kept:
            raise SourceGap("No web pages matched you.")
        return kept
