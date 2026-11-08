"""Tests for the permission engine: the floor table, the deciders, the askers and Engine.decide."""

from brain.permission import ALLOWED, SUMMARY_MAX, Tier, summarise


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
