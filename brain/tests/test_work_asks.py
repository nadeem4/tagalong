"""The ask log on work rows: Home's filters, counts and paging, and the offer's person count.

Seeded through the same path production uses (an ask row, its facts, its decision).
"""

import pytest
from ask_log import add_approval, approval_counts, list_approvals, work_on

from brain.memory import Memory


@pytest.fixture
def mem():
    m = Memory(":memory:")
    yield m
    m.close()


def _ap(mem, outcome="approved", by="person", group="g1", at="2026-01-01T00:00:00+00:00", **kw):
    return add_approval(
        mem,
        source="scout_tool",
        tool="run",
        summary="s",
        input={"a": 1},
        group_key=group,
        outcome=outcome,
        decided_by=by,
        at=at,
        **kw,
    )


def test_list_filters_and_pages(mem):
    a = _ap(mem)
    b = _ap(mem, by="scout")
    c = _ap(mem, outcome="refused", by="person")
    assert [x.id for x in list_approvals(mem, "all", 10, None)] == [c, b, a]
    assert [x.id for x in list_approvals(mem, "scout", 10, None)] == [b]
    assert [x.id for x in list_approvals(mem, "refused", 10, None)] == [c]
    assert [x.id for x in list_approvals(mem, "all", 1, None)] == [c]
    assert [x.id for x in list_approvals(mem, "all", 10, b)] == [a]
    assert list_approvals(mem, "all", 10, None)[0].input == {"a": 1}


def test_open_asks_are_not_in_the_log(mem):
    work = work_on(mem)
    work.create("ask", "waiting", id="open1", state="active")
    work.add_ask("open1", tool="t")
    assert list_approvals(mem) == []
    assert approval_counts(mem) == {"total": 0, "scout": 0, "refused": 0}


def test_counts(mem):
    _ap(mem)
    _ap(mem, by="scout")
    _ap(mem, outcome="refused")
    assert approval_counts(mem) == {"total": 3, "scout": 1, "refused": 1}


def test_person_asks_since_counts_only_person_approved_in_group(mem):
    _ap(mem, at="2026-01-02T00:00:00+00:00")
    _ap(mem, at="2026-01-03T00:00:00+00:00")
    _ap(mem, by="scout", at="2026-01-03T00:00:00+00:00")
    _ap(mem, outcome="refused", at="2026-01-03T00:00:00+00:00")
    _ap(mem, group="g2", at="2026-01-03T00:00:00+00:00")
    _ap(mem, at="2025-12-01T00:00:00+00:00")
    work = work_on(mem)
    assert work.person_asks_since("g1", "2026-01-01T00:00:00+00:00") == 2


def test_a_row_keeps_the_sentence_it_was_approved_under(mem):
    _ap(mem, by="scout", preference_id=7, preference_sentence="Allow reads")
    _ap(mem)
    newest, older = list_approvals(mem, "all", 10, None)
    assert (older.rule_id, older.rule_sentence) == (7, "Allow reads")
    assert (newest.rule_id, newest.rule_sentence) == (None, None)
