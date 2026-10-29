"""Tests for the Approvals service: summaries and recording with a change notification."""

from datetime import UTC, datetime

import pytest

from brain.approvals import Approvals
from brain.memory import Memory


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


def make(mem, sent):
    return Approvals(mem, lambda method, params: sent.append((method, params)), lambda: NOW)


NOW = datetime(2026, 10, 28, 9, 0, 0, tzinfo=UTC)


def test_summarise_prefers_ask_text_and_cuts_at_200(mem):
    a = make(mem, [])
    assert a.summarise("Open the file", "t", {"x": 1}) == "Open the file"
    assert a.summarise("", "t", {"x": 1}) == 't {"x":1}'
    assert len(a.summarise("y" * 500, "t", {})) == 200
    assert len(a.summarise("", "t", {"x": "z" * 500})) == 200


def test_record_notifies_changed_approvals(mem):
    sent = []
    make(mem, sent).record(
        source="scout_tool",
        tool="t",
        summary="s",
        input={"a": 1},
        group_key="t",
        outcome="approved",
    )
    assert sent == [("changed", {"what": "approvals"})]
    [row] = mem.list_approvals("all", 10, None)
    assert (row.tool, row.outcome, row.decided_by, row.source) == (
        "t",
        "approved",
        "person",
        "scout_tool",
    )
    assert row.at == "2026-10-28T09:00:00+00:00"
