"""Tests for the Approvals service: recording with a change notification."""

from datetime import UTC, datetime

import pytest
from ask_log import add_approval, approvals_on, list_approvals

from brain.guards import Guards
from brain.masking import Masker, mask_secrets
from brain.memory import Memory
from brain.store import rules


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


def make(mem, sent):
    return approvals_on(mem, lambda method, params: sent.append((method, params)), lambda: NOW)


NOW = datetime(2026, 10, 28, 9, 0, 0, tzinfo=UTC)


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
    [row] = list_approvals(mem, "all", 10, None)
    assert (row.tool, row.outcome, row.decided_by, row.source) == (
        "t",
        "approved",
        "person",
        "scout_tool",
    )
    assert row.at == "2026-10-28T09:00:00+00:00"


def _record(a, **kw):
    a.record(
        **{
            "source": "scout_tool",
            "tool": "t",
            "summary": "s",
            "input": {},
            "group_key": "t",
            "outcome": "approved",
            **kw,
        }
    )


def test_record_makes_an_ended_ask_row_under_its_job(mem):
    a = make(mem, [])
    a.work.create("goal", "a job", id="j1", state="active")
    _record(a, job_id="j1", outcome="refused")
    [ask] = a.work.children("j1")
    assert (ask.kind, ask.state, ask.parent_id, ask.end_reason) == (
        "ask", "cancelled", "j1", "refused",
    )  # fmt: skip


def test_record_decides_the_open_ask_row_it_is_given(mem):
    a = make(mem, [])
    row = a.work.create("ask", "open ask", id="ask1", state="active")
    a.work.add_ask("ask1", tool="t")
    _record(a, ask_id="ask1", summary="the line", outcome="approved")
    [logged] = list_approvals(mem)
    assert (logged.summary, logged.outcome, logged.decided_by) == ("the line", "approved", "person")
    assert a.work.get(row.id).state == "done"


def test_record_decides_an_ask_its_waiter_already_ended(mem):
    a = make(mem, [])
    a.work.create("ask", "open ask", id="ask1", state="active")
    a.work.settle("ask1", "expired", "timed out")
    _record(a, ask_id="ask1", outcome="timed_out", decided_by="none")
    [logged] = list_approvals(mem)
    assert (logged.outcome, logged.decided_by) == ("timed_out", "none")


def test_record_titles_an_untitled_ask_row_with_its_summary(mem):
    a = make(mem, [])
    a.work.create("ask", "", id="ask1", state="active")
    _record(a, ask_id="ask1", summary="create issue", outcome="approved")
    assert a.work.get("ask1").title == "create issue"


def test_a_refused_ask_leaves_its_job_running(mem):
    a = make(mem, [])
    a.work.create("goal", "a job", id="j1", state="active")
    _record(a, job_id="j1", outcome="refused")
    assert a.work.get("j1").state == "active"


def test_record_masks_summary_and_input(mem):
    guards = Guards()
    guards.add(mask_secrets(Masker(lambda: ["fake-token-12345678"])))
    approvals_on(mem, lambda m, p: None, lambda: NOW, guards=guards).record(
        source="scout_tool",
        tool="t",
        summary="call with fake-token-12345678",
        input={"url": "https://x/y?token=abcdef123", "h": "Bearer " + "A1b2C3d4E5f6G7h8i9"},
        group_key="t",
        outcome="approved",
    )
    [row] = list_approvals(mem, "all", 10, None)
    assert row.summary == "call with [secret]"
    assert row.input == {"url": "https://x/y?token=[secret]", "h": "Bearer [secret]"}


def test_record_masks_an_api_key_value(mem):
    guards = Guards()
    guards.add(mask_secrets(Masker(lambda: [])))
    key = "sk-ant-" + "a1B2" * 6
    approvals_on(mem, lambda m, p: None, lambda: NOW, guards=guards).record(
        source="scout_tool",
        tool="t",
        summary=f"uses {key}",
        input={"k": key, "name": key},
        group_key="t",
        outcome="approved",
    )
    [row] = list_approvals(mem, "all", 10, None)
    assert row.summary == "uses [secret]" and row.input == {"k": "[secret]", "name": "[secret]"}


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
    return add_approval(
        mem,
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


async def test_list_approvals_shape_unchanged(mem):
    a = make(mem, [])
    a.work.create("goal", "a job", id="j1", state="active")
    pref = rules.add_preference(
        mem.db, sentence="Allow reads", source=None, tool=None, group_key=None, at="t"
    )
    a.record(
        source="claude_code",
        tool="claude_code:ls",
        summary="ls -la",
        input={"c": 1},
        group_key="claude_code:/repo",
        outcome="approved",
        job_id="j1",
        decided_by="scout",
        preference_id=pref.id,
        preference_sentence=pref.sentence,
    )
    _, h = tools(mem, [])["list_approvals"]
    out = json.loads(await h({}))
    [row] = out["approvals"]
    assert isinstance(row.pop("id"), int)
    assert row == {
        "source": "claude_code",
        "tool": "claude_code:ls",
        "summary": "ls -la",
        "input": {"c": 1},
        "job_id": "j1",
        "outcome": "approved",
        "decided_by": "scout",
        "preference_id": pref.id,
        "preference": "Allow reads",
        "at": "2026-10-28T09:00:00+00:00",
    }
    assert out["counts"] == {"total": 1, "scout": 1, "refused": 0}
    assert out["next"] is None


async def test_list_approvals_scout_filter_includes_stored_preference_sentence(mem):
    pref = rules.add_preference(
        mem.db, sentence="Allow reads", source=None, tool=None, group_key=None, at="t"
    )
    add_row(mem)
    add_row(mem, decided_by="scout", preference_id=pref.id, preference_sentence=pref.sentence)
    _, h = tools(mem, [])["list_approvals"]

    out = json.loads(await h({"filter": "scout"}))

    assert [r["preference"] for r in out["approvals"]] == ["Allow reads"]
    assert out["counts"]["total"] == 2  # counts ignore the filter

    # The row keeps the sentence it was approved under, whatever happens to the preference.
    rules.edit_preference(mem.db, pref.id, "Allow nothing")
    out = json.loads(await h({"filter": "scout"}))
    assert out["approvals"][0]["preference"] == "Allow reads"
    rules.remove_preference(mem.db, pref.id)
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
    pref = rules.add_preference(
        mem.db, sentence="x", source=None, tool=None, group_key=None, at="t"
    )
    sent = []
    t = tools(mem, sent)

    await t["remove_preference"][1]({"id": pref.id})

    assert pref.id not in [p.id for p in rules.list_preferences(mem.db)]
    assert sent == [("changed", {"what": "approvals"})]
    listed = json.loads(await t["list_preferences"][1]({}))["preferences"]
    assert all(p["id"] != pref.id for p in listed)


async def test_list_preferences_shape_unchanged(mem):
    pref = rules.add_preference(
        mem.db, sentence="x", source="app", tool="t", group_key="g", at="t0"
    )
    listed = json.loads(await tools(mem, [])["list_preferences"][1]({}))["preferences"]
    row = next(p for p in listed if p["id"] == pref.id)
    assert row == {
        "id": pref.id, "sentence": "x", "source": "app", "tool": "t", "builtin": False,
        "created_at": "t0", "use_count": 0, "last_used": None,
    }  # fmt: skip


async def test_remove_default_is_allowed(mem):
    default = rules.list_preferences(mem.db)[0]
    await tools(mem, [])["remove_preference"][1]({"id": default.id})
    assert not any(p.builtin for p in rules.list_preferences(mem.db))


async def test_edit_preference_rewrites_and_notifies(mem):
    pref = rules.add_preference(
        mem.db, sentence="x", source=None, tool=None, group_key=None, at="t"
    )
    sent = []
    await tools(mem, sent)["edit_preference"][1]({"id": pref.id, "sentence": "  new  "})
    assert [p.sentence for p in rules.list_preferences(mem.db) if p.id == pref.id] == ["new"]
    assert sent == [("changed", {"what": "approvals"})]


@pytest.mark.parametrize("sentence", ["", "   ", "x" * 301, 5, None])
async def test_edit_preference_rejects_empty_and_overlong(mem, sentence):
    pref = rules.add_preference(
        mem.db, sentence="x", source=None, tool=None, group_key=None, at="t"
    )
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

    pref = rules.add_preference(
        mem.db, sentence="Allow reads", source=None, tool=None, group_key=None, at="t"
    )
    sent = []
    facts = AskFacts("claude_code", "claude_code:ls", "ls", {"c": 1}, "claude_code:/repo")

    approvals = make(mem, sent)
    approvals.work.create("goal", "a job", id="j1", state="active")  # job_id is the row's parent
    approvals.scout_approved(facts, pref, "ls -la", job_id="j1")

    [row] = list_approvals(mem, "all", 10, None)
    assert (row.outcome, row.decided_by, row.rule_id) == ("approved", "scout", pref.id)
    assert (row.source, row.tool, row.group_key, row.job_id, row.input) == (
        "claude_code", "claude_code:ls", "claude_code:/repo", "j1", {"c": 1},
    )  # fmt: skip
    assert (row.summary, row.rule_sentence) == ("ls -la", "Allow reads")
    used = next(p for p in rules.list_preferences(mem.db) if p.id == pref.id)
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
    assert [p.sentence for p in rules.list_preferences(mem.db) if p.id == pref.id] == ["b"]
    assert service.remove_preference(pref.id) is True
    assert service.remove_preference(pref.id) is False
    assert service.edit_preference(pref.id, "c") is False
    assert sent == [("changed", {"what": "approvals"})] * 2
