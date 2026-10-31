"""SideCheck: Scout looks at an approval ask and either approves it under one of the person's
preferences or passes it on. Fake models script the Final, so no network runs here.
"""

import asyncio
from types import SimpleNamespace

import pytest

from brain.guards import Hook, stop
from brain.memory import Memory
from brain.mind.turn import Final
from brain.side_check import AskFacts, SideCheck

AT = "2026-10-28T09:00:00Z"


class Model:
    model_id = "claude-sonnet-5-5"

    def __init__(self, content=None, error=None, delay=0.0):
        self.content = content
        self.error = error
        self.delay = delay
        self.calls = 0
        self.seen = []

    async def stream(self, system, messages, tools):
        self.calls += 1
        self.seen.append((system, messages, tools))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        yield Final(self.content, "tool_use", SimpleNamespace(input_tokens=10, output_tokens=5))


class Budget:
    def __init__(self, allows=True):
        self._allows = allows
        self.spent = []

    def allows(self):
        return self._allows

    def spend(self, usage, model):
        self.spent.append((usage, model))


def approve(pref_id, reason="covered"):
    block = {"type": "tool_use", "id": "t", "name": "approve_under_preference"}
    return [{**block, "input": {"preference": pref_id, "reason": reason}}]


PASS = [{"type": "tool_use", "id": "t", "name": "pass_to_person", "input": {}}]


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


def pref(mem, sentence="Fine to read files in the repo"):
    return mem.add_preference(sentence=sentence, source=None, tool=None, group_key=None, at=AT)


def facts(locked=False, tool="Read"):
    return AskFacts("claude_code", tool, "Read a file", {"path": "a"}, "/repo", locked)


def check(mem, model, budget=None, timeout=20.0):
    return SideCheck(model, budget or Budget(), mem, timeout)


async def test_no_user_preference_means_no_model_call(mem):
    model = Model(approve(1))
    assert await check(mem, model).decide(facts()) is None
    assert model.calls == 0


async def test_approve_returns_the_named_preference(mem):
    p = pref(mem)
    model = Model(approve(p.id))
    assert await check(mem, model).decide(facts()) == p
    system, messages, tools = model.seen[0]
    assert {t["name"] for t in tools} == {"approve_under_preference", "pass_to_person"}
    prompt = system + str(messages)
    assert p.sentence in prompt and "Read a file" in prompt


async def test_pass_returns_none(mem):
    pref(mem)
    assert await check(mem, Model(PASS)).decide(facts()) is None


async def test_unknown_preference_id_is_a_pass(mem):
    pref(mem)
    assert await check(mem, Model(approve(999))).decide(facts()) is None


async def test_builtin_default_cannot_be_approved_under(mem):
    other = pref(mem)
    default = mem.list_preferences()[0]
    assert await check(mem, Model(approve(default.id))).decide(facts()) is None
    assert await check(mem, Model(approve(other.id))).decide(facts()) == other


def named(mem, tool="Read", sentence="Fine to read files in the repo"):
    return mem.add_preference(sentence=sentence, source=None, tool=tool, group_key=None, at=AT)


async def test_side_check_locked_without_a_naming_preference_makes_no_model_call(mem):
    p = pref(mem)  # general: names no tool
    mem.remove_preference(mem.list_preferences()[0].id)
    model = Model(approve(p.id))
    assert await check(mem, model).decide(facts(locked=True)) is None
    assert model.calls == 0


async def test_side_check_locked_with_general_preference_and_default_present_is_none(mem):
    p = pref(mem)
    assert any(p.builtin for p in mem.list_preferences())
    model = Model(approve(p.id))
    assert await check(mem, model).decide(facts(locked=True)) is None
    assert model.calls == 0


async def test_side_check_locked_approves_under_a_preference_naming_the_tool(mem):
    p = named(mem, tool="Read")
    assert await check(mem, Model(approve(p.id))).decide(facts(locked=True)) == p


async def test_side_check_locked_candidates_exclude_other_tools_preferences(mem):
    mine = named(mem, tool="Read")
    other = named(mem, tool="Write", sentence="Fine to write files")
    general = pref(mem, "Anything in the repo is fine")
    model = Model(approve(mine.id))
    await check(mem, model).decide(facts(locked=True))
    text = str(model.seen[0][1])
    assert mine.sentence in text
    assert other.sentence not in text and general.sentence not in text
    assert await check(mem, Model(approve(other.id))).decide(facts(locked=True)) is None


async def test_side_check_locked_unknown_preference_id_is_none(mem):
    named(mem, tool="Read")
    assert await check(mem, Model(approve(999))).decide(facts(locked=True)) is None


async def test_preference_removed_while_thinking_is_a_pass(mem):
    p = pref(mem)

    class Removes(Model):
        async def stream(self, system, messages, tools):
            mem.remove_preference(p.id)
            async for item in super().stream(system, messages, tools):
                yield item

    assert await check(mem, Removes(approve(p.id))).decide(facts()) is None


async def test_model_error_is_a_pass(mem):
    pref(mem)
    assert await check(mem, Model(error=RuntimeError("boom"))).decide(facts()) is None


async def test_timeout_is_a_pass(mem):
    p = pref(mem)
    model = Model(approve(p.id), delay=1.0)
    assert await check(mem, model, timeout=0.05).decide(facts()) is None


async def test_over_budget_skips_the_model(mem):
    p = pref(mem)
    model = Model(approve(p.id))
    assert await check(mem, model, Budget(allows=False)).decide(facts()) is None
    assert model.calls == 0


async def test_usage_is_spent_on_the_budget(mem):
    p = pref(mem)
    budget = Budget()
    await check(mem, Model(approve(p.id)), budget).decide(facts())
    assert len(budget.spent) == 1 and budget.spent[0][1] == "claude-sonnet-5-5"


async def test_no_tool_use_block_is_a_pass(mem):
    pref(mem)
    model = Model([{"type": "text", "text": "sure"}])
    assert await check(mem, model).decide(facts()) is None


async def test_history_for_the_same_tool_is_shown(mem):
    pref(mem)
    mem.add_approval(
        source="claude_code", tool="Read", summary="Read old.txt", input={}, job_id=None,
        group_key="/repo", outcome="approved", decided_by="person", preference_id=None, at=AT,
    )  # fmt: skip
    model = Model(PASS)
    await check(mem, model).decide(facts())
    assert "Read old.txt" in str(model.seen[0][1])


async def test_a_huge_input_is_truncated_in_the_prompt(mem):
    pref(mem)
    model = Model(PASS)
    big = AskFacts("claude_code", "Write", "Write a file", {"text": "x" * 50_000}, "/repo", False)
    await check(mem, model).decide(big)
    text = model.seen[0][1][0]["content"]
    assert "x" * 100 in text and len(text) < 8_000


class StopGuards:
    """A Guards stand-in whose every hook stops, so nothing here depends on the budget."""

    def __init__(self):
        self.hooks = []

    async def run(self, hook, ctx):
        self.hooks.append(hook)
        return stop("no", "over_budget")


async def test_decide_stops_when_the_guards_stop(mem):
    pref(mem)
    model = Model(approve(1))
    guards = StopGuards()
    side = SideCheck(model, Budget(), mem, guards=guards)
    assert await side.decide(facts()) is None
    assert model.calls == 0 and guards.hooks == [Hook.model_call]
