"""The one-line "why pick it" for a community app, written by Haiku and cached per version.

The registry description is a stranger's text: it goes to the model fenced as untrusted, and
whatever comes back is stripped of markup and cut short. Any trouble (model not ready, over
the allowance, an error) falls back to the shortened description, so a search never fails here.
"""

import json
import logging
import os
import re
from functools import cache
from importlib.resources import files
from pathlib import Path

from brain.mind.turn import Final, Model
from brain.setup.paths import cache_file
from brain.setup.registry import RegistryEntry

log = logging.getLogger(__name__)

SHORT_MAX = 100


def _clean(text: str) -> str:
    return " ".join(re.sub(r"<[^>]*>|[<>`*_#]", "", text).split())


def _cut(text: str) -> str:
    return text if len(text) <= SHORT_MAX else text[: SHORT_MAX - 1].rstrip() + "…"


def shorten(description: str) -> str:
    """The first sentence of a registry description, without markup, at most SHORT_MAX long."""
    text = _clean(description)
    sentence = re.match(r".*?[.!?](?=\s|$)", text)
    return _cut(sentence.group(0) if sentence else text)


@cache
def _system() -> str:
    return files("brain.mind").joinpath("why_pick.md").read_text(encoding="utf-8")


def _prompt(entry: RegistryEntry) -> str:
    # No angle brackets in the text, so the description cannot close its own fence.
    description = entry.description.replace("<", "&lt;")
    return f'<app untrusted="true">\nName: {entry.name.replace("<", "&lt;")}\n{description}\n</app>'


class WhyPick:
    def __init__(self, model: Model, budget, home: Path) -> None:
        self._model = model
        self._budget = budget
        self._path = cache_file(home, "why")
        self._lines: dict[str, str] | None = None

    async def line(self, entry: RegistryEntry) -> str:
        key = f"{entry.id}@{entry.version}"
        cached = self._load().get(key)
        if cached:
            return cached
        fallback = shorten(entry.description)
        if not self._model.ready or not self._budget.allows():
            return fallback
        try:
            final = None
            messages = [{"role": "user", "content": _prompt(entry)}]
            async for part in self._model.stream(_system(), messages, []):
                if isinstance(part, Final):
                    final = part
        except Exception:  # a failed line never fails the search
            log.exception("why-pick call failed")
            return fallback
        if final is None:
            return fallback
        self._budget.spend(final.usage, final.model or self._model.model_id)
        text = _cut(_clean("".join(b.get("text", "") for b in final.content)))
        if not text:
            return fallback
        self._load()[key] = text
        self._save()
        return text

    def _load(self) -> dict[str, str]:
        if self._lines is None:
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                self._lines = {k: v for k, v in data.items() if isinstance(v, str)}
            except (OSError, ValueError, AttributeError):
                self._lines = {}
        return self._lines

    def _save(self) -> None:
        # Atomic: a crash leaves the old cache, never half a file.
        part = self._path.with_name(self._path.name + ".part")
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            part.write_text(json.dumps(self._lines), encoding="utf-8")
            os.replace(part, self._path)
        except OSError:
            part.unlink(missing_ok=True)  # the line is still returned; the cache is a speed-up
