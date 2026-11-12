"""Scout's get-to-know-me tools: start a run, the offer rules in code, rewrite the portrait and
Home's source list. Fakes only, a real Memory."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from know_fakes import FakeModel, FakeSource, budget, final

from brain.know import offer
from brain.know.runner import KnowMeRunner
from brain.know.tools import know_me_tools
from brain.memory import Memory
from brain.store.memory import MemoryRefused, NewFact

NOW = datetime(2026, 11, 12, 9, 0, tzinfo=UTC)


class Github(FakeSource):
    needs = "username"


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


def build(mem, tmp_path, model=None, now=NOW):
    notes = []
    model = model or FakeModel()
    runner = KnowMeRunner([Github("github")], mem, model, budget(tmp_path), lambda b, p: None)
    tools = know_me_tools(runner, mem, lambda: now, lambda m, p: notes.append((m, p)))
    return runner, {spec.name: (spec, h) for spec, h in tools}, notes


async def test_start_with_github_starts_run(mem, tmp_path):
    runner, tools, _ = build(mem, tmp_path)
    out = await tools["get_to_know_me"][1]({"action": "start", "github": "octocat"})
    assert runner._task is not None and "Home" in out and "LinkedIn" in out
    await runner._task


async def test_start_without_github_points_to_home_for_pdf(mem, tmp_path):
    runner, tools, _ = build(mem, tmp_path)
    out = await tools["get_to_know_me"][1]({"action": "start"})
    assert runner._task is None
    assert "Home" in out and "GitHub" in out


async def test_offered_refused_when_not_allowed(mem, tmp_path):
    _, tools, _ = build(mem, tmp_path)
    offer.mark_ran(mem.db, NOW)
    with pytest.raises(MemoryRefused):
        await tools["get_to_know_me"][1]({"action": "offered"})


async def test_offered_marks_time(mem, tmp_path):
    _, tools, _ = build(mem, tmp_path)
    await tools["get_to_know_me"][1]({"action": "offered"})
    assert offer.load(mem.db).offered_at == NOW.isoformat()
    with pytest.raises(MemoryRefused):  # not again within a week
        await tools["get_to_know_me"][1]({"action": "offered"})


async def test_declined_stops_future_offers_until_start(mem, tmp_path):
    runner, tools, _ = build(mem, tmp_path)
    handler = tools["get_to_know_me"][1]
    await handler({"action": "declined"})
    later = NOW + timedelta(days=30)
    assert offer.allowed(offer.load(mem.db), later) is False
    await handler({"action": "start", "github": "octocat"})
    assert offer.load(mem.db).declined is False
    await runner._task


async def test_unknown_action_is_refused(mem, tmp_path):
    _, tools, _ = build(mem, tmp_path)
    with pytest.raises(MemoryRefused):
        await tools["get_to_know_me"][1]({"action": "dance"})


async def test_rewrite_portrait_tool_notifies_memory_changed(mem, tmp_path):
    mem.save_source_facts("github", [NewFact("work", "Builds compilers", "compilers", "r")])
    _, tools, notes = build(mem, tmp_path, FakeModel(final("Alice builds compilers.")))
    out = await tools["rewrite_portrait"][1]({})
    assert mem.portrait().text == "Alice builds compilers."
    assert notes == [("changed", {"what": "memory"})] and "portrait" in out.lower()


async def test_rewrite_portrait_without_facts_says_so(mem, tmp_path):
    _, tools, notes = build(mem, tmp_path)
    out = await tools["rewrite_portrait"][1]({})
    assert notes == [] and "nothing" in out.lower()


async def test_know_me_sources_lists_name_needs_label(mem, tmp_path):
    _, tools, _ = build(mem, tmp_path)
    spec, handler = tools["know_me_sources"]
    assert spec.audience == frozenset({"home"}) and spec.effect == "read"
    assert json.loads(await handler({})) == [
        {"name": "github", "needs": "username", "label": "Github"}
    ]


def test_scout_tools_are_auto_scout_changes(mem, tmp_path):
    _, tools, _ = build(mem, tmp_path)
    for name in ("get_to_know_me", "rewrite_portrait"):
        spec = tools[name][0]
        assert spec.audience == frozenset({"scout"})
        assert (spec.effect, spec.default_mode) == ("change", "auto")


async def test_rewrite_portrait_without_key_says_so(mem, tmp_path):
    mem.save_source_facts("github", [NewFact("work", "Builds compilers", "compilers", "r")])
    _, tools, _ = build(mem, tmp_path, FakeModel(ready=False))
    with pytest.raises(MemoryRefused, match="key"):
        await tools["rewrite_portrait"][1]({})


async def test_start_that_joins_a_run_says_the_username_was_not_used(mem, tmp_path):
    runner, tools, _ = build(mem, tmp_path)
    handler = tools["get_to_know_me"][1]
    await handler({"action": "start", "github": "octocat"})
    out = await handler({"action": "start", "github": "someone"})
    assert "already" in out and "someone" in out
    await runner._task
