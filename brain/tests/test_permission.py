"""Tests for the permission engine: the floor table, the deciders, the askers and Engine.decide."""

import asyncio
from datetime import UTC, datetime

import pytest
from ask_log import approvals_on, list_approvals

from brain.asks import Answer
from brain.experts import PermissionOption
from brain.memory import Memory
from brain.mind.turn import Call
from brain.permission import (
    ALLOWED,
    SUMMARY_MAX,
    AskRequest,
    Decision,
    Engine,
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
from brain.store import rules as rules_store
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


# --- Engine.decide -------------------------------------------------------------

NOW = datetime(2026, 11, 7, 9, 0, 0, tzinfo=UTC)


class Fake:
    """A decider that returns a set result and counts its calls."""

    def __init__(self, name, result=None, raises=None):
        self.name = name
        self.result = result
        self.raises = raises
        self.calls = 0

    async def decide(self, req):
        self.calls += 1
        if self.raises is not None:
            raise self.raises
        return self.result


class FakeOffers:
    def __init__(self):
        self.seen = []

    def consider(self, group_key, source, tool):
        self.seen.append((group_key, source, tool))


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


class Rig:
    def __init__(self, mem, deciders):
        self.sent = []
        self.auto = []
        self.offers = FakeOffers()
        self.approvals = approvals_on(mem, lambda m, p: self.sent.append((m, p)), lambda: NOW)
        self.engine = Engine(deciders, self.approvals, self.offers, self.auto.append)
        self.mem = mem

    def rows(self):
        return list_approvals(self.mem, "all", 50, None)


def granting():
    return [
        Fake("standing_rule", Grant("rule")),
        Fake("side_check", Grant("scout")),
        Fake("person", Grant("person")),
    ]


@pytest.mark.parametrize(
    ("tier", "called", "kind", "code"),
    [
        (Tier.off, [], "deny", "off"),
        (Tier.person_only, ["person"], "allow_once", ""),
        (Tier.locked, ["standing_rule"], "allow_once", ""),
        (Tier.ask, ["standing_rule"], "allow_once", ""),
        (Tier.auto, [], "allow_once", ""),
    ],
)
async def test_floor_table(mem, tier, called, kind, code):
    deciders = granting()
    d = await Rig(mem, deciders).engine.decide(req(tier=tier))
    assert (d.kind, d.code) == (kind, code)
    assert [x.name for x in deciders if x.calls] == called


@pytest.mark.parametrize("tier", list(Tier))
async def test_floor_table_when_every_decider_passes(mem, tier):
    deciders = [Fake(n) for n in ("standing_rule", "side_check", "person")]
    d = await Rig(mem, deciders).engine.decide(req(tier=tier))
    assert {x.name for x in deciders if x.calls} == ALLOWED[tier]
    if tier is Tier.off:
        assert (d.kind, d.code) == ("deny", "off")
    elif tier is Tier.auto:
        assert d.allowed
    else:
        assert (d.kind, d.code) == ("deny", "no_decider")


async def test_a_side_check_grant_never_opens_person_only(mem):
    side = Fake("side_check", Grant("scout"))
    d = await Rig(mem, [side]).engine.decide(req(tier=Tier.person_only))
    assert (d.kind, d.code, side.calls) == ("deny", "no_decider", 0)


async def test_a_grant_from_the_wrong_decider_is_a_pass(mem):
    rig = Rig(mem, [Fake("side_check", Grant("person"))])
    assert (await rig.engine.decide(req())).code == "no_decider"
    assert rig.rows() == []


async def test_a_raising_decider_is_a_pass(mem):
    deciders = [Fake("standing_rule", raises=RuntimeError("boom")), Fake("person", Grant("person"))]
    d = await Rig(mem, deciders).engine.decide(req())
    assert (d.kind, d.decided_by) == ("allow_once", "person")


async def test_a_garbage_result_is_a_pass(mem):
    deciders = [Fake("standing_rule", "yes please"), Fake("side_check", True)]
    assert (await Rig(mem, deciders).engine.decide(req())).code == "no_decider"


async def test_all_pass_is_deny_with_no_row(mem):
    rig = Rig(mem, [Fake("person")])
    d = await rig.engine.decide(req())
    assert (d.kind, d.code, d.decided_by) == ("deny", "no_decider", "none")
    assert rig.rows() == []


async def test_always_widens_only_from_the_person_on_ask_or_locked(mem):
    rig = Rig(mem, [Fake("person", Grant("person", always=True))])
    d = await rig.engine.decide(req("t", tier=Tier.ask))
    assert d.kind == "allow_always"
    assert rig.auto == ["t"]
    assert rig.offers.seen == []  # now Auto: an offer would be noise

    rig = Rig(mem, [Fake("person", Grant("person", always=True))])
    assert (await rig.engine.decide(req("t", tier=Tier.locked))).kind == "allow_always"

    rig = Rig(mem, [Fake("person", Grant("person", always=True))])
    assert (await rig.engine.decide(req("t", tier=Tier.person_only))).kind == "allow_once"
    assert rig.auto == []

    rig = Rig(mem, [Fake("side_check", Grant("scout", always=True))])
    assert (await rig.engine.decide(req("t"))).kind == "allow_once"
    assert rig.auto == []

    rig = Rig(mem, [Fake("person", Grant("person", always=True))])
    assert (await rig.engine.decide(req("t", kind="expert_request"))).kind == "allow_once"
    assert rig.auto == []


async def test_cannot_allow_once_skips_rule_and_side_check(mem):
    deciders = granting()
    d = await Rig(mem, deciders).engine.decide(req(can_allow_once=False))
    assert [x.name for x in deciders if x.calls] == ["person"]
    assert d.decided_by == "person"


async def test_each_outcome_writes_one_row(mem):
    p = Preference(7, "files are fine", None, None, None, False, "2026-11-07", 0, None)
    cases = [
        (Grant("rule"), "standing_rule", ("approved", "rule")),
        (Grant("scout", preference=p), "side_check", ("approved", "scout")),
        (Grant("person"), "person", ("approved", "person")),
        (Refusal("denied", "no"), "person", ("refused", "person")),
        (Refusal("timeout", "late"), "person", ("timed_out", "none")),
        (Refusal("no_one", "alone"), "person", ("no_one", "none")),
    ]
    seen = []
    for result, name, expected in cases:
        rig = Rig(mem, [Fake(name, result)])
        before = len(rig.rows())
        await rig.engine.decide(req())
        rows = rig.rows()
        assert len(rows) == before + 1
        seen.append((rows[0].outcome, rows[0].decided_by))
        assert seen[-1] == expected
    scout_row = next(r for r in rig.rows() if r.decided_by == "scout")
    assert (scout_row.rule_id, scout_row.rule_sentence) == (7, "files are fine")


async def test_cancelled_writes_no_row(mem):
    rig = Rig(mem, [Fake("person", Refusal("cancelled", "stopped"))])
    d = await rig.engine.decide(req())
    assert (d.kind, d.code) == ("deny", "cancelled")
    assert rig.rows() == []


async def test_a_denial_carries_the_option_id(mem):
    rig = Rig(mem, [Fake("person", Refusal("denied", "no", "o2"))])
    d = await rig.engine.decide(req())
    assert d == Decision("deny", "denied", "person", "o2", d.ask_id)


@pytest.mark.parametrize(
    ("decider", "result", "extra", "tier", "offered"),
    [
        ("person", Grant("person"), {}, Tier.ask, True),
        ("standing_rule", Grant("rule"), {}, Tier.ask, False),
        ("side_check", Grant("scout"), {}, Tier.ask, False),
        ("person", Grant("person", always=True), {}, Tier.ask, False),
        ("person", Grant("person"), {}, Tier.person_only, False),
        ("person", Grant("person"), {"offer": False}, Tier.ask, False),
    ],
)
async def test_offer_follows_only_a_persons_once_allow(mem, decider, result, extra, tier, offered):
    rig = Rig(mem, [Fake(decider, result)])
    await rig.engine.decide(req("t", tier=tier, **extra))
    assert rig.offers.seen == ([("t", "scout_tool", "t")] if offered else [])


async def test_scout_grant_marks_the_preference_used_and_notifies_approved(mem):
    p = rules_store.add_preference(
        mem.db, sentence="files are fine", source=None, tool=None, group_key=None, at="2026-11-07"
    )
    rig = Rig(mem, [Fake("side_check", Grant("scout", preference=p))])
    await rig.engine.decide(req())
    [used] = [x for x in rules_store.list_preferences(mem.db) if x.id == p.id]
    assert used.use_count == 1
    assert ("approved", {"tool": "t", "text": "s", "preference": "files are fine"}) in rig.sent


async def test_a_standing_rule_grant_never_uses_a_preference(mem):
    p = rules_store.add_preference(
        mem.db, sentence="files are fine", source=None, tool=None, group_key=None, at="2026-11-07"
    )
    rig = Rig(mem, [Fake("standing_rule", Grant("rule", preference=p))])
    await rig.engine.decide(req())
    [seen] = [x for x in rules_store.list_preferences(mem.db) if x.id == p.id]
    assert seen.use_count == 0
    assert not any(kind == "approved" for kind, _ in rig.sent)
    [row] = rig.rows()
    assert (row.decided_by, row.rule_id, row.rule_sentence) == ("rule", None, None)
