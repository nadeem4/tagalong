"""Offers: after enough person approvals of one kind of ask, Scout may offer to auto-approve it.
Fake model and fake asks script every answer, so no network runs here.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from brain.approvals import Approvals
from brain.asks import Answer
from brain.guards import stop
from brain.memory import Memory, _utc_text
from brain.mind.turn import Final
from brain.offers import Offers, OfferSettings
from brain.protocol import ErrorCode, RpcError

NOW = datetime(2026, 10, 28, 9, 0, 0, tzinfo=UTC)
YES, KEEP = "Yes, auto-approve", "Keep asking"
GROUP = "Read"
SETTINGS = OfferSettings(min_approvals=3, window_days=14, keep_asking_days=7)


def offer_call(sentence="Fine to read files"):
    return [{"type": "tool_use", "id": "t", "name": "offer", "input": {"sentence": sentence}}]


NO_OFFER = [{"type": "tool_use", "id": "t", "name": "no_offer", "input": {}}]


class Model:
    model_id = "claude-sonnet-5-5"

    def __init__(self, content=None, error=None, gate=None):
        self.content = content if content is not None else offer_call()
        self.error = error
        self.gate = gate
        self.calls = 0
        self.seen = []

    async def stream(self, system, messages, tools):
        self.calls += 1
        self.seen.append((system, messages, tools))
        if self.gate is not None:
            await self.gate.wait()
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


class FakeAsks:
    def __init__(self, answer=None, online=True):
        self.answer = answer if answer is not None else Answer(YES)
        self.online = online
        self.opened = []

    def anyone_online(self):
        return self.online

    async def open(self, **kw):
        self.opened.append(kw)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


class Rig:
    def __init__(self, mem, model=None, budget=None, asks=None, settings=SETTINGS):
        self.mem = mem
        self.model = model or Model()
        self.budget = budget or Budget()
        self.asks = asks or FakeAsks()
        self.sent = []
        self.clock = NOW
        approvals = Approvals(mem, lambda m, p: self.sent.append((m, p)), lambda: self.clock)
        self.offers = Offers(
            self.model, self.budget, mem, self.asks, approvals, settings, lambda: self.clock
        )

    def approve(self, days_ago=1, by="person", group=GROUP, tool="Read", n=1, summary="read a"):
        at = _utc_text(NOW - timedelta(days=days_ago))
        for _ in range(n):
            self.mem.add_approval(
                source="scout_tool", tool=tool, summary=summary, input={}, job_id=None,
                group_key=group, outcome="approved", decided_by=by, preference_id=None, at=at,
            )  # fmt: skip

    async def consider(self, group=GROUP, source="scout_tool", tool="Read"):
        self.offers.consider(group, source, tool)
        while self.offers._tasks:
            await asyncio.gather(*list(self.offers._tasks))


@pytest.fixture
def rig(mem):
    return Rig(mem)


async def test_three_person_approvals_in_window_trigger_one_look(rig):
    rig.approve(n=3)
    await rig.consider()
    assert rig.model.calls == 1
    assert len(rig.asks.opened) == 1
    assert len(rig.budget.spent) == 1


async def test_two_approvals_do_not(rig):
    rig.approve(n=2)
    await rig.consider()
    assert rig.model.calls == 0 and rig.asks.opened == []


async def test_scout_approvals_do_not_count(rig):
    rig.approve(n=2)
    rig.approve(n=5, by="scout")
    await rig.consider()
    assert rig.model.calls == 0


async def test_approvals_older_than_window_do_not_count(rig):
    rig.approve(n=2)
    rig.approve(n=5, days_ago=20)
    await rig.consider()
    assert rig.model.calls == 0


async def test_claude_code_group_counts_across_different_titles(rig):
    folder = "claude_code:/repo"
    for title in ("ls", "cat x", "grep y"):
        rig.approve(group=folder, tool=f"claude_code:{title}")
    await rig.consider(folder, "claude_code", "claude_code:ls")
    assert rig.model.calls == 1
    [ask] = rig.asks.opened
    assert ask["input"]["group"] == folder


async def test_no_offer_still_caps_looks_to_one_per_day(mem):
    rig = Rig(mem, Model(NO_OFFER))
    rig.approve(n=3)
    await rig.consider()
    assert rig.model.calls == 1 and rig.asks.opened == []
    assert [o for _, o in mem.offers_for(GROUP)] == ["none"]
    await rig.consider()
    assert rig.model.calls == 1  # a second approval the same day looks no more
    rig.clock = NOW + timedelta(days=1, minutes=1)
    rig.approve(days_ago=0, n=1)
    await rig.consider()
    assert rig.model.calls == 2


async def test_model_error_still_counts_as_a_look(mem):
    rig = Rig(mem, Model(error=RuntimeError("boom")))
    rig.approve(n=3)
    await rig.consider()  # must not raise
    assert rig.asks.opened == []
    assert [o for _, o in mem.offers_for(GROUP)] == ["none"]


async def test_keep_asking_blocks_for_seven_days_then_allows(mem):
    rig = Rig(mem, asks=FakeAsks(Answer(KEEP)))
    rig.approve(n=3)
    await rig.consider()
    assert [o for _, o in mem.offers_for(GROUP)] == ["keep_asking"]
    rig.clock = NOW + timedelta(days=3)
    rig.approve(days_ago=-3, n=1)
    await rig.consider()
    assert rig.model.calls == 1
    rig.clock = NOW + timedelta(days=8)
    rig.approve(days_ago=-8, n=1)
    await rig.consider()
    assert rig.model.calls == 2


async def test_group_with_a_preference_is_never_offered(rig):
    rig.approve(n=3)
    rig.mem.add_preference(
        sentence="read away", source=None, tool=None, group_key=GROUP, at=_utc_text(NOW)
    )
    await rig.consider()
    assert rig.model.calls == 0


async def test_yes_saves_the_preference_with_source_tool_group(rig):
    rig.approve(n=3)
    await rig.consider()
    [pref] = [p for p in rig.mem.list_preferences() if not p.builtin]
    assert (pref.sentence, pref.source, pref.tool, pref.group_key) == (
        "Fine to read files", "scout_tool", "Read", GROUP,
    )  # fmt: skip
    assert ("changed", {"what": "approvals"}) in rig.sent
    assert [o for _, o in rig.mem.offers_for(GROUP)] == ["yes"]


async def test_keep_asking_saves_nothing(mem):
    rig = Rig(mem, asks=FakeAsks(Answer(KEEP)))
    rig.approve(n=3)
    await rig.consider()
    assert not any(not p.builtin for p in mem.list_preferences())


@pytest.mark.parametrize(
    "answer",
    [
        RpcError(ErrorCode.timeout, "nobody answered"),
        RpcError(ErrorCode.cancelled, "cancelled"),
        RuntimeError("boom"),
        Answer(None),
        Answer("something else"),
    ],
)
async def test_ask_failure_saves_nothing_and_records_no_answer(mem, answer):
    rig = Rig(mem, asks=FakeAsks(answer))
    rig.approve(n=3)
    await rig.consider()
    assert not any(not p.builtin for p in mem.list_preferences())
    assert [o for _, o in mem.offers_for(GROUP)] == ["no_answer"]


async def test_nobody_online_or_over_budget_skips(mem):
    offline = Rig(mem, asks=FakeAsks(online=False))
    offline.approve(n=3)
    await offline.consider()
    assert offline.model.calls == 0
    broke = Rig(mem, budget=Budget(allows=False))
    await broke.consider()
    assert broke.model.calls == 0 and mem.offers_for(GROUP) == []


async def test_offer_text_names_the_sentence(rig):
    rig.approve(n=3)
    await rig.consider()
    [ask] = rig.asks.opened
    assert ask["options"] == [YES, KEEP]
    assert ask["tool"] == "approval_offer"
    assert ask["input"] == {"sentence": "Fine to read files", "group": GROUP}
    assert ask["timeout"] == 600
    assert "Fine to read files" in ask["text"] and GROUP in ask["text"] and "3" in ask["text"]


async def test_the_look_gets_the_offer_wording_and_the_recent_approvals(rig):
    rig.approve(n=3, summary="read the config")
    await rig.consider()
    system, messages, tools = rig.model.seen[0]
    assert "preference" in system.lower()
    assert "read the config" in messages[0]["content"]
    assert {t["name"] for t in tools} == {"offer", "no_offer"}


async def test_blank_sentence_is_no_offer(mem):
    rig = Rig(mem, Model(offer_call("   ")))
    rig.approve(n=3)
    await rig.consider()
    assert rig.asks.opened == []
    assert [o for _, o in mem.offers_for(GROUP)] == ["none"]


async def test_two_concurrent_considers_make_one_offer(mem):
    gate = asyncio.Event()
    rig = Rig(mem, Model(gate=gate))
    rig.approve(n=3)
    rig.offers.consider(GROUP, "scout_tool", "Read")
    rig.offers.consider(GROUP, "scout_tool", "Read")
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    gate.set()
    while rig.offers._tasks:
        await asyncio.gather(*list(rig.offers._tasks))
    assert rig.model.calls == 1 and len(rig.asks.opened) == 1


async def test_exceptions_in_consider_never_escape(mem):
    rig = Rig(mem)
    rig.approve(n=3)
    mem.close()  # every read now fails
    await rig.consider()  # must not raise


async def test_consider_skips_look_when_the_guards_stop(mem):
    class StopGuards:
        async def run(self, hook, ctx):
            return stop("no", "over_budget")

    r = Rig(mem)
    r.offers = Offers(
        r.model, r.budget, mem, r.asks, Approvals(mem, lambda m, p: None, lambda: NOW),
        SETTINGS, lambda: NOW, guards=StopGuards(),
    )  # fmt: skip
    r.approve(n=3)
    await r.consider()
    assert r.model.calls == 0 and mem.offers_for(GROUP) == []
