"""Fakes for the get-to-know-me tests: a scripted model and a source that returns fixed material.

Shared by the extraction, web and runner tests so none of them calls a real provider.
"""

import datetime
from types import SimpleNamespace

from brain.guardrails import Budget
from brain.know.facts import Known, Material
from brain.know.source import SourceGap
from brain.mind.turn import Final

MODEL = "claude-haiku-5-5"
USAGE = SimpleNamespace(
    input_tokens=1000, output_tokens=100, cache_creation_input_tokens=0, cache_read_input_tokens=0
)


def budget(tmp_path, limit=1.0):
    return Budget(tmp_path / "b.json", limit, lambda: datetime.date(2026, 11, 12))


def final(text="", content=None):
    blocks = content if content is not None else [{"type": "text", "text": text}]
    return Final(blocks, "end_turn", USAGE, MODEL)


class FakeModel:
    model_id = MODEL

    def __init__(self, *steps, ready=True):
        self.ready = ready
        self.steps = list(steps)
        self.calls = []  # (system, messages, tools, max_tokens)

    async def stream(self, system, messages, tools, max_tokens=None):
        self.calls.append((system, messages, tools, max_tokens))
        yield self.steps.pop(0)


class FakeSource:
    needs = "none"

    def __init__(self, name="fake", materials=None, gap=None):
        self.name = name
        self.label = name.title()
        self._materials = (
            materials if materials is not None else [Material("text", "ref", keys=Known())]
        )
        self._gap = gap

    async def read(self, given, known):
        if self._gap:
            raise SourceGap(self._gap)
        return list(self._materials)
