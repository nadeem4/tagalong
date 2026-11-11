"""Tests for the permission engine: the floor table, the deciders, the askers and Engine.decide."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from ask_log import approvals_on, list_approvals

from brain.asks import Answer, AskExpired
from brain.experts import PermissionOption
from brain.memory import Memory
from brain.mind.turn import Call
from brain.permission import (
    ALLOWED,
    ASK_WAIT_DEFAULT,
    ASK_WAIT_MAX,
    ASK_WAIT_MIN,
    SUMMARY_MAX,
    AskOpen,
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
    ask_wait,
    expert_asker,
    gate_tier,
    resolve_mode,
    stored_auto_rules,
    summarise,
    tier,
    tool_asker,
)
from brain.protocol import ErrorCode, RpcError
from brain.store import rules as rules_store
from brain.store.rules import Preference
from brain.toolbox import BodySource, ToolSpec


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
    assert (f.source, f.tool, f.summary, f.input, f.group_key) == (
        "scout_tool",
        "t",
        "s",
        {"a": 1},
        "t",
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
            answering("allow", raises=AskExpired("job ended: done")),
            Refusal("expired", "job ended: done"),
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


async def test_tool_asker_asks_even_when_nobody_displays():
    asks = FakeAsks(online=False)
    assert await tool_asker(asks, CALL, "t", Tier.ask, "a1", None)() == PersonAnswer("allow")


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
        (Refusal("expired", "no answer"), "person", ("expired", "none")),
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
    assert d == Decision("deny", "denied", "person", "o2", d.ask_id, "no")


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


# --- one tier per tool -----------------------------------------------------------------------


def spec(**kw) -> ToolSpec:
    return ToolSpec("t", "d", {"type": "object"}, **kw)


@pytest.mark.parametrize(
    ("kw", "stored", "expected"),
    [
        # stored off beats everything: every flag, self-asking and person-only too
        ({}, "off", "off"),
        ({"tier": Tier.auto}, "off", "off"),
        ({"tier": Tier.person_only}, "off", "off"),
        ({"tier": Tier.locked}, "off", "off"),
        # a self-asking tool is auto
        ({"tier": Tier.auto}, None, "auto"),
        ({"tier": Tier.auto}, "ask", "auto"),
        # person-only is ask even with a stored auto
        ({"tier": Tier.person_only}, None, "ask"),
        ({"tier": Tier.person_only}, "auto", "ask"),
        ({"tier": Tier.person_only}, "ask", "ask"),
        # a locked tool: the stored choice is its unlock; otherwise ask, ignoring default and read
        ({"tier": Tier.locked}, "auto", "auto"),
        ({"tier": Tier.locked}, "ask", "ask"),
        ({"tier": Tier.locked}, None, "ask"),
        ({"tier": Tier.locked, "default_mode": "auto"}, None, "ask"),
        ({"tier": Tier.locked, "effect": "read"}, None, "ask"),
        # default_mode beats effect
        ({"effect": "read", "default_mode": "ask"}, None, "ask"),
        ({"effect": "change", "default_mode": "auto"}, None, "auto"),
        # a read is auto, a change is ask; a stored choice wins
        ({"effect": "read"}, None, "auto"),
        ({"effect": "change"}, None, "ask"),
        ({}, None, "ask"),  # unknown effect is a change
        ({"effect": "read"}, "ask", "ask"),
        ({"effect": "change"}, "auto", "auto"),
    ],
)
def test_resolve_mode_keeps_every_old_answer(kw, stored, expected):
    assert resolve_mode(spec(**kw), stored) == expected


def test_tier_from_spec():
    assert tier(spec(tier=Tier.locked, default_mode="auto")) is Tier.locked
    assert tier(spec(default_mode="auto", effect="change")) is Tier.auto
    assert tier(spec(default_mode="ask", effect="read")) is Tier.ask
    assert tier(spec(effect="read")) is Tier.auto
    assert tier(spec(effect="change")) is Tier.ask
    assert tier(spec()) is Tier.ask


def test_gate_tier_turns_a_read_set_to_ask_into_ask():
    assert gate_tier(spec(effect="read"), "ask") is Tier.ask
    assert gate_tier(spec(effect="read"), None) is Tier.auto
    assert gate_tier(spec(effect="read"), "auto") is Tier.auto
    assert gate_tier(spec(effect="change"), "ask") is Tier.ask
    assert gate_tier(spec(effect="change"), "off") is Tier.off
    assert gate_tier(spec(tier=Tier.auto), "ask") is Tier.auto
    assert gate_tier(spec(tier=Tier.locked), "ask") is Tier.locked
    assert gate_tier(spec(tier=Tier.person_only), "auto") is Tier.person_only
    # A stored Auto stays a standing rule at the gate: the engine grants it and logs it.
    assert gate_tier(spec(effect="change"), "auto") is Tier.ask
    assert gate_tier(spec(tier=Tier.locked), "auto") is Tier.locked


def test_body_confirm_maps_to_tier():
    from brain.protocol import Tool

    def specs(confirm):
        extra = {} if confirm is None else {"confirm": confirm}
        tool = Tool(name="x", description="d", input_schema={"type": "object"}, **extra)
        return BodySource._specs_of({"b": [tool]})[0]

    assert specs(None).tier is None
    assert specs(True).tier is Tier.locked
    assert specs("always").tier is Tier.person_only


async def test_side_check_grant_whose_preference_use_raises_is_a_pass(mem, monkeypatch):
    pref = Preference(1, "ok", None, None, None, False, "", 0, None)
    rig = Rig(
        mem, [Fake("side_check", Grant("scout", preference=pref)), Fake("person", Grant("person"))]
    )

    def boom(*a):
        raise RuntimeError("db")

    monkeypatch.setattr("brain.approvals.rules.use_preference", boom)
    d = await rig.engine.decide(req())
    assert (d.kind, d.decided_by) == ("allow_once", "person")
    assert [r.decided_by for r in rig.rows()] == ["person"]


def test_ask_wait_default_and_bounds():
    assert ask_wait(None) == ASK_WAIT_DEFAULT == timedelta(days=3)
    assert (ASK_WAIT_MIN, ASK_WAIT_MAX) == (timedelta(hours=1), timedelta(days=7))


async def test_an_expired_ask_logs_its_reason(mem):
    rig = Rig(mem, [Fake("person", Refusal("expired", "no answer"))])
    d = await rig.engine.decide(req())
    assert (d.kind, d.code, d.reason) == ("deny", "expired", "no answer")
    work = rig.approvals.work
    [event] = [e for e in work.events(d.ask_id) if e.kind == "decided"]
    assert event.data == {"outcome": "expired", "decided_by": "none", "reason": "no answer"}


# --- the card does not wait for the side-check ----------------------------------


class Slow:
    """A decider that waits on an event, then returns its result."""

    def __init__(self, name, result, gate):
        self.name = name
        self.result = result
        self.gate = gate
        self.cancelled = False

    async def decide(self, req):
        try:
            await self.gate.wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        return self.result


async def test_card_shows_before_side_check_returns(mem):
    gate = asyncio.Event()
    shown = []
    side = Slow("side_check", None, gate)
    rig = Rig(mem, [side, Fake("person")])
    task = asyncio.create_task(rig.engine.decide(req(show_card=lambda: shown.append(1))))
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert shown == [1]  # up while the side-check is still thinking
    assert not task.done()
    gate.set()
    assert (await task).kind == "deny"  # nobody grants: no asker, no decider left


async def test_card_shows_before_side_check_on_a_live_ask(mem):
    side_gate, person_gate = asyncio.Event(), asyncio.Event()
    started = []

    async def ask():
        started.append(1)
        await person_gate.wait()
        return PersonAnswer("allow")

    rig = Rig(mem, [Slow("side_check", None, side_gate), Person()])
    task = asyncio.create_task(rig.engine.decide(req(how_to_ask=ask)))
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert started == [1]  # the card was asked for before the side-check returned
    person_gate.set()
    d = await task
    assert (d.kind, d.decided_by) == ("allow_once", "person")


async def test_side_check_decision_first_closes_card(mem):
    gate, never = asyncio.Event(), asyncio.Event()
    closed = []
    stopped = []

    async def ask():
        try:
            await never.wait()
        except asyncio.CancelledError:
            stopped.append(1)
            raise

    rig = Rig(mem, [Slow("side_check", Grant("scout"), gate), Person()])
    task = asyncio.create_task(rig.engine.decide(req(how_to_ask=ask, settled=closed.append)))
    await asyncio.sleep(0)
    gate.set()
    d = await task
    assert (d.kind, d.decided_by) == ("allow_once", "scout")
    assert closed == ["side_check"]
    assert stopped == [1]  # the person's card was withdrawn


async def test_side_check_grant_closes_a_card_shown_for_a_later_answer(mem):
    closed = []
    rig = Rig(mem, [Fake("side_check", Grant("scout"))])
    d = await rig.engine.decide(req(show_card=lambda: None, settled=closed.append))
    assert d.decided_by == "scout"
    assert closed == ["side_check"]


async def test_person_answer_first_stops_the_side_check(mem):
    gate = asyncio.Event()
    side = Slow("side_check", Grant("scout"), gate)

    async def ask():
        return PersonAnswer("deny")

    rig = Rig(mem, [side, Person()])
    d = await rig.engine.decide(req(how_to_ask=ask))
    assert (d.kind, d.code) == ("deny", "denied")
    await asyncio.sleep(0)
    assert side.cancelled


async def test_a_failed_side_check_grant_leaves_the_card_to_the_person(mem):
    gate, person_gate = asyncio.Event(), asyncio.Event()
    closed = []

    async def ask():
        await person_gate.wait()
        return PersonAnswer("allow")

    rig = Rig(mem, [Slow("side_check", Grant("scout"), gate), Person()])

    real = rig.approvals.record

    def broken(**kw):
        if kw["decided_by"] == "scout":
            raise RuntimeError("log write failed")
        return real(**kw)

    rig.approvals.record = broken
    task = asyncio.create_task(rig.engine.decide(req(how_to_ask=ask, settled=closed.append)))
    await asyncio.sleep(0)
    gate.set()
    await asyncio.sleep(0.05)
    assert not task.done()  # Scout's yes did not count; the card is still up for the person
    person_gate.set()
    d = await task
    assert d.decided_by == "person"


async def test_settled_refusal_leaves_the_outcome_to_the_person(mem):
    def refused(_by):
        raise AskOpen("item1")

    rig = Rig(mem, [Fake("side_check", Grant("scout"))])
    with pytest.raises(AskOpen):
        await rig.engine.decide(req(show_card=lambda: None, settled=refused))
    assert rig.rows() == []  # no approval row for a yes the person beat
