"""Tests for the permission engine: the floor table, the deciders, the askers and Engine.decide."""

import asyncio

import pytest

from brain.asks import Answer
from brain.experts import PermissionOption
from brain.mind.turn import Call
from brain.permission import (
    ALLOWED,
    SUMMARY_MAX,
    AskRequest,
    Grant,
    NoOneThere,
    Person,
    PersonAnswer,
    Refusal,
    Rule,
    SideCheckDecider,
    StandingRule,
    Tier,
    expert_asker,
    stored_auto_rules,
    summarise,
    tool_asker,
)
from brain.protocol import ErrorCode, RpcError
from brain.store.rules import Preference


def test_allowed_table_is_the_floor():
    assert ALLOWED == {
        Tier.off: frozenset(),
        Tier.person_only: frozenset({"person"}),
        Tier.locked: frozenset({"standing_rule", "person"}),
        Tier.ask: frozenset({"standing_rule", "side_check", "person"}),
        Tier.auto: frozenset(),
    }
    assert [t.value for t in Tier] == ["off", "person_only", "locked", "ask", "auto"]


def test_summarise_prefers_ask_text_and_cuts_at_200():
    assert SUMMARY_MAX == 200
    assert summarise("Open the file", "t", {"x": 1}) == "Open the file"
    assert summarise("", "t", {"x": 1}) == 't {"x":1}'
    assert len(summarise("y" * 500, "t", {})) == 200
    assert len(summarise("", "t", {"x": "z" * 500})) == 200


# --- the deciders and the askers ----------------------------------------------


def req(tool="t", how_to_ask=None, tier=Tier.ask, **kw):
    return AskRequest(
        kind=kw.pop("kind", "tool"),
        source="scout_tool",
        tool=tool,
        group_key=tool,
        summary="s",
        input={"a": 1},
        tier=tier,
        how_to_ask=how_to_ask,
        **kw,
    )


def pref():
    return Preference(1, "files are fine", None, None, None, False, "2026-11-07", 0, None)


async def test_standing_rule_allows_only_an_unscoped_rule_for_the_tool():
    rules = [
        Rule("other", None, "allow", None),
        Rule("t", "folder X", "allow", None),
    ]
    rule = StandingRule(lambda: rules)
    assert rule.name == "standing_rule"
    assert await rule.decide(req("t")) is None
    rules.append(Rule("t", None, "allow", None))
    assert await rule.decide(req("t")) == Grant("rule")


def test_stored_auto_rules_reads_auto_modes_only():
    read = stored_auto_rules(lambda: {"a": "auto", "b": "off", "c": "ask", "d": "auto"})
    assert read() == [Rule("a", None, "allow", None), Rule("d", None, "allow", None)]


class FakeSideCheck:
    def __init__(self, result):
        self.result = result
        self.facts = None

    async def decide(self, facts):
        self.facts = facts
        return self.result


async def test_side_check_decider_grants_under_the_preference():
    check = FakeSideCheck(pref())
    decider = SideCheckDecider(check)
    assert decider.name == "side_check"
    grant = await decider.decide(req())
    assert grant == Grant("scout", preference=pref())
    f = check.facts
    assert (f.source, f.tool, f.summary, f.input, f.group_key, f.locked) == (
        "scout_tool",
        "t",
        "s",
        {"a": 1},
        "t",
        False,
    )


async def test_side_check_decider_passes_on_none():
    assert await SideCheckDecider(FakeSideCheck(None)).decide(req()) is None


def answering(choice, option_id=None, raises=None):
    async def how():
        if raises is not None:
            raise raises
        return PersonAnswer(choice, option_id)

    return how


@pytest.mark.parametrize(
    ("how", "expected"),
    [
        (answering("allow", "o1"), Grant("person", option_id="o1")),
        (answering("always"), Grant("person", always=True)),
        (answering("deny", "o2"), Refusal("denied", "the person said no", "o2")),
        (answering("allow", raises=NoOneThere()), Refusal("no_one", "nobody online")),
        (
            answering("allow", raises=RpcError(ErrorCode.timeout, "late")),
            Refusal("timeout", "no answer in time"),
        ),
        (
            answering("allow", raises=RpcError(ErrorCode.cancelled, "stopped")),
            Refusal("cancelled", "the ask was cancelled"),
        ),
    ],
)
async def test_person_maps_each_answer(how, expected):
    assert await Person().decide(req(how_to_ask=how)) == expected


async def test_person_without_a_channel_passes():
    assert await Person().decide(req(how_to_ask=None)) is None


async def test_person_lets_cancelled_error_through():
    how = answering("allow", raises=asyncio.CancelledError())
    with pytest.raises(asyncio.CancelledError):
        await Person().decide(req(how_to_ask=how))


class FakeAsks:
    def __init__(self, online=True, option="allow"):
        self.online = online
        self.option = option
        self.locked = None
        self.seen = None

    def anyone_online(self):
        return self.online

    async def permission(self, call, spec_name, locked, *, ask_id, parent_id):
        self.locked = locked
        self.seen = (call, spec_name, ask_id, parent_id)
        return self.option


CALL = Call("c1", "t", {"a": 1}, "turn1", "text")


async def test_tool_asker_raises_no_one_there_when_nobody_displays():
    how = tool_asker(FakeAsks(online=False), CALL, "t", Tier.ask, "a1", None)
    with pytest.raises(NoOneThere):
        await how()


@pytest.mark.parametrize(
    ("tier", "locked"),
    [(Tier.ask, False), (Tier.locked, True), (Tier.person_only, True)],
)
async def test_tool_asker_offers_no_always_unless_tier_ask(tier, locked):
    asks = FakeAsks(option="always")
    answer = await tool_asker(asks, CALL, "t", tier, "a1", "job1")()
    assert answer == PersonAnswer("always")
    assert asks.locked is locked
    assert asks.seen == (CALL, "t", "a1", "job1")


OPTIONS = [
    PermissionOption("o_once", "Allow once", "allow_once"),
    PermissionOption("o_always", "Allow always", "allow_always"),
    PermissionOption("o_no", "Reject", "reject_once"),
]


async def test_expert_asker_maps_option_kinds():
    chosen: dict = {}

    async def open_ask(**kw):
        chosen["kw"] = kw
        return Answer(chosen["pick"])

    how = expert_asker(open_ask, "edit", {"f": 1}, OPTIONS, "a1")
    for pick, expected in [
        ("Allow once", PersonAnswer("allow", "o_once")),
        ("Allow always", PersonAnswer("allow", "o_always")),
        ("Reject", PersonAnswer("deny", "o_no")),
    ]:
        chosen["pick"] = pick
        assert await how() == expected
    assert chosen["kw"] == {
        "ask_id": "a1",
        "text": "",
        "tool": "edit",
        "input": {"f": 1},
        "options": ["Allow once", "Allow always", "Reject"],
    }
    chosen["pick"] = "Something else"
    with pytest.raises(RpcError) as e:
        await how()
    assert e.value.code is ErrorCode.cancelled
    chosen["pick"] = None
    with pytest.raises(NoOneThere):
        await how()
