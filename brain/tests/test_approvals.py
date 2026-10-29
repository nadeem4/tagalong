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


# --- Home tools ---------------------------------------------------------------------------

import json  # noqa: E402

from brain.approvals import approval_home_tools  # noqa: E402
from brain.protocol import ErrorCode, RpcError  # noqa: E402


def tools(mem, sent):
    return {s.name: (s, h) for s, h in approval_home_tools(make(mem, sent))}


def add_row(
    mem,
    *,
    decided_by="person",
    outcome="approved",
    preference_id=None,
    tool="t",
    preference_sentence=None,
):
    return mem.add_approval(
        source="scout_tool",
        tool=tool,
        summary="s",
        input={"a": 1},
        job_id=None,
        group_key=tool,
        outcome=outcome,
        decided_by=decided_by,
        preference_id=preference_id,
        at="2026-10-28T09:00:00+00:00",
        preference_sentence=preference_sentence,
    )


async def test_list_approvals_returns_counts_and_cursor(mem):
    for _ in range(51):
        add_row(mem)
    add_row(mem, decided_by="scout")
    _, h = tools(mem, [])["list_approvals"]

    first = json.loads(await h({}))
    assert len(first["approvals"]) == 50
    assert first["counts"] == {"total": 52, "scout": 1, "refused": 0}
    assert first["next"] == first["approvals"][-1]["id"]
    assert set(first["approvals"][0]) == {
        "id", "source", "tool", "summary", "input", "job_id", "outcome",
        "decided_by", "preference_id", "preference", "at",
    }  # fmt: skip

    second = json.loads(await h({"before": first["next"]}))
    assert len(second["approvals"]) == 2
    assert second["next"] is None


async def test_list_approvals_scout_filter_includes_stored_preference_sentence(mem):
    pref = mem.add_preference(
        sentence="Allow reads", source=None, tool=None, group_key=None, at="t"
    )
    add_row(mem)
    add_row(mem, decided_by="scout", preference_id=pref.id, preference_sentence=pref.sentence)
    _, h = tools(mem, [])["list_approvals"]

    out = json.loads(await h({"filter": "scout"}))

    assert [r["preference"] for r in out["approvals"]] == ["Allow reads"]
    assert out["counts"]["total"] == 2  # counts ignore the filter

    # The row keeps the sentence it was approved under, whatever happens to the preference.
    mem.edit_preference(pref.id, "Allow nothing")
    out = json.loads(await h({"filter": "scout"}))
    assert out["approvals"][0]["preference"] == "Allow reads"
    mem.remove_preference(pref.id)
    out = json.loads(await h({"filter": "scout"}))
    assert out["approvals"][0]["preference"] == "Allow reads"


async def test_person_row_has_no_preference_sentence(mem):
    add_row(mem)
    _, h = tools(mem, [])["list_approvals"]
    assert json.loads(await h({}))["approvals"][0]["preference"] is None


async def test_list_approvals_rejects_bad_args(mem):
    _, h = tools(mem, [])["list_approvals"]
    for bad in ({"filter": "x"}, {"before": "1"}, {"before": True}):
        with pytest.raises(RpcError) as e:
            await h(bad)
        assert e.value.code == ErrorCode.invalid_params


async def test_remove_preference_changes_and_notifies(mem):
    pref = mem.add_preference(sentence="x", source=None, tool=None, group_key=None, at="t")
    sent = []
    t = tools(mem, sent)

    await t["remove_preference"][1]({"id": pref.id})

    assert pref.id not in [p.id for p in mem.list_preferences()]
    assert sent == [("changed", {"what": "approvals"})]
    listed = json.loads(await t["list_preferences"][1]({}))["preferences"]
    assert all(p["id"] != pref.id for p in listed)


async def test_list_preferences_shape(mem):
    pref = mem.add_preference(sentence="x", source="app", tool="t", group_key="g", at="t0")
    listed = json.loads(await tools(mem, [])["list_preferences"][1]({}))["preferences"]
    row = next(p for p in listed if p["id"] == pref.id)
    assert row == {
        "id": pref.id, "sentence": "x", "source": "app", "tool": "t", "builtin": False,
        "created_at": "t0", "use_count": 0, "last_used": None,
    }  # fmt: skip


async def test_remove_default_is_allowed(mem):
    default = mem.default_preference()
    await tools(mem, [])["remove_preference"][1]({"id": default.id})
    assert mem.default_preference() is None


async def test_edit_preference_rewrites_and_notifies(mem):
    pref = mem.add_preference(sentence="x", source=None, tool=None, group_key=None, at="t")
    sent = []
    await tools(mem, sent)["edit_preference"][1]({"id": pref.id, "sentence": "  new  "})
    assert [p.sentence for p in mem.list_preferences() if p.id == pref.id] == ["new"]
    assert sent == [("changed", {"what": "approvals"})]


@pytest.mark.parametrize("sentence", ["", "   ", "x" * 301, 5, None])
async def test_edit_preference_rejects_empty_and_overlong(mem, sentence):
    pref = mem.add_preference(sentence="x", source=None, tool=None, group_key=None, at="t")
    sent = []
    with pytest.raises(RpcError) as e:
        await tools(mem, sent)["edit_preference"][1]({"id": pref.id, "sentence": sentence})
    assert e.value.code == ErrorCode.invalid_params
    assert sent == []


async def test_unknown_preference_id_is_invalid_params(mem):
    t = tools(mem, [])
    for name, args in (
        ("remove_preference", {"id": 999}),
        ("edit_preference", {"id": 999, "sentence": "x"}),
    ):
        with pytest.raises(RpcError) as e:
            await t[name][1](args)
        assert e.value.code == ErrorCode.invalid_params


def test_home_tools_not_offered_to_the_model(mem):
    specs = [s for s, _ in approval_home_tools(make(mem, []))]
    assert [s.name for s in specs] == [
        "list_approvals", "list_preferences", "remove_preference", "edit_preference",
    ]  # fmt: skip
    assert all(s.audience == frozenset({"home"}) for s in specs)


# --- scout_approved ----------------------------------------------------------------------


def test_scout_approved_records_uses_and_notifies(mem):
    from brain.side_check import AskFacts

    pref = mem.add_preference(
        sentence="Allow reads", source=None, tool=None, group_key=None, at="t"
    )
    sent = []
    facts = AskFacts("claude_code", "claude_code:ls", "ls", {"c": 1}, "claude_code:/repo", False)

    make(mem, sent).scout_approved(facts, pref, "ls -la", job_id="j1")

    [row] = mem.list_approvals("all", 10, None)
    assert (row.outcome, row.decided_by, row.preference_id) == ("approved", "scout", pref.id)
    assert (row.source, row.tool, row.group_key, row.job_id, row.input) == (
        "claude_code", "claude_code:ls", "claude_code:/repo", "j1", {"c": 1},
    )  # fmt: skip
    assert (row.summary, row.preference_sentence) == ("ls -la", "Allow reads")
    used = next(p for p in mem.list_preferences() if p.id == pref.id)
    assert used.use_count == 1 and used.last_used == "2026-10-28T09:00:00+00:00"
    assert (
        "approved",
        {"tool": "claude_code:ls", "text": "ls -la", "preference": "Allow reads"},
    ) in sent
    assert ("changed", {"what": "approvals"}) in sent


# --- Preference writes live in the service so every writer notifies the same way ----------


def test_add_preference_saves_and_notifies(mem):
    sent = []
    pref = make(mem, sent).add_preference(sentence="ok", source="app", tool="t", group_key="g")
    assert (pref.sentence, pref.source, pref.tool, pref.group_key) == ("ok", "app", "t", "g")
    assert pref.created_at == "2026-10-28T09:00:00+00:00"
    assert sent == [("changed", {"what": "approvals"})]


def test_edit_and_remove_preference_notify_only_when_something_changed(mem):
    sent = []
    service = make(mem, sent)
    pref = service.add_preference(sentence="a", source=None, tool=None, group_key=None)
    sent.clear()
    assert service.edit_preference(pref.id, "b") is True
    assert [p.sentence for p in mem.list_preferences() if p.id == pref.id] == ["b"]
    assert service.remove_preference(pref.id) is True
    assert service.remove_preference(pref.id) is False
    assert service.edit_preference(pref.id, "c") is False
    assert sent == [("changed", {"what": "approvals"})] * 2
