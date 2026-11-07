"""WorkStore: the work table, its tree, states, rollup, retry rule and search.

Runs on a real temp database file with a hand-moved clock; no provider is involved.
"""

from datetime import UTC, datetime, timedelta

import pytest

from brain.config import load_config
from brain.store.db import open_db, utc_text
from brain.store.work import TERMINAL, RetrySettings, TransitionRefused, WorkStore

START = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
STATES = ["planned", "active", "blocked", "paused", "done", "failed", "cancelled", "expired"]


class Clock:
    def __init__(self) -> None:
        self.at = START

    def __call__(self) -> datetime:
        return self.at


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def db(tmp_path):
    return open_db(tmp_path / "t.db")


@pytest.fixture
def store(db, clock):
    return WorkStore(db, clock, mask=lambda s: s.replace("sk-x", "[secret]"))


def _kinds(store, work_id):
    return [e.kind for e in store.events(work_id)]


def test_create_root_sets_root_id_to_self(store):
    row = store.create("goal", "Fix export")
    assert row.root_id == row.id and row.parent_id is None and row.seq == 1
    assert len(row.id) == 8 and row.state == "planned"
    assert store.get(row.id) == row
    assert store.get("nope") is None


def test_child_inherits_root_and_seq_increments(store):
    goal = store.create("goal", "g")
    a = store.create("expert_call", "a", parent_id=goal.id)
    b = store.create("tool_call", "b", parent_id=goal.id)
    grand = store.create("tool_call", "c", parent_id=a.id)
    assert (a.root_id, a.seq, b.seq) == (goal.id, 1, 2)
    assert grand.root_id == goal.id and grand.seq == 1


def test_title_masked_and_capped(store):
    assert store.create("goal", "use sk-x now").title == "use [secret] now"
    assert len(store.create("goal", "x" * 300).title) == 200


def test_create_writes_created_event(store):
    row = store.create("timer", "t")
    assert _kinds(store, row.id) == ["created"]


def test_create_stores_options(store, clock):
    due = clock.at + timedelta(minutes=5)
    row = store.create(
        "tool_call",
        "t",
        input={"a": 1},
        due_at=due,
        safe_to_retry=True,
        source_message_id=7,
        id="abc",
        max_attempts=5,
    )
    assert (row.id, row.input, row.safe_to_retry, row.max_attempts) == ("abc", {"a": 1}, True, 5)
    assert row.due_at == utc_text(due) and row.source_message_id == 7
    assert row.created_at == utc_text(START) and row.checkpoint is None


def test_update_changes_non_state_fields(store, clock):
    row = store.create("expert_call", "t")
    clock.at += timedelta(seconds=5)
    store.update(
        row.id,
        summary="found sk-x",
        progress="running",
        checkpoint={"session_id": "s1"},
        detail_id="o1",
        last_error="e" * 400,
        error_kind="transient",
        due_at=clock.at,
    )
    got = store.get(row.id)
    assert got.summary == "found [secret]" and got.progress == "running"
    assert got.checkpoint == {"session_id": "s1"} and got.detail_id == "o1"
    assert len(got.last_error) == 300 and got.error_kind == "transient"
    assert got.due_at == utc_text(clock.at) and got.updated_at == utc_text(clock.at)
    assert got.state == "planned"
    store.update(row.id, due_at=None)
    assert store.get(row.id).due_at is None


def test_search_finds_title_and_summary(store):
    by_title = store.create("goal", "Fix the invoice export")
    by_summary = store.create("goal", "Weekly report")
    store.create("goal", "Unrelated")
    store.update(by_summary.id, summary="sent the invoices to Ana")
    assert {r.id for r in store.search("invoice")} == {by_title.id, by_summary.id}
    assert store.search("") == []


def test_tree_returns_whole_goal_in_seq_order(store):
    goal = store.create("goal", "g")
    a = store.create("expert_call", "a", parent_id=goal.id)
    b = store.create("tool_call", "b", parent_id=goal.id)
    c = store.create("tool_call", "c", parent_id=a.id)
    store.create("goal", "other")
    assert [r.id for r in store.tree(goal.id)] == [goal.id, a.id, c.id, b.id]
    assert [r.id for r in store.children(goal.id)] == [a.id, b.id]


def test_of_kind_and_events_limit(store):
    t = store.create("timer", "t")
    store.create("loop", "l")
    assert [r.id for r in store.of_kind("timer")] == [t.id]
    assert store.of_kind("timer", states=["done"]) == []
    for i in range(5):
        store.add_event(t.id, "note", {"i": i})
    assert [e.data for e in store.events(t.id, limit=2)] == [{"i": 3}, {"i": 4}]


# ---- transitions ----

ALLOWED = {
    (a, b)
    for a, tos in {
        "planned": {"active", "cancelled", "expired", "paused"},
        "active": {"done", "failed", "blocked", "planned", "cancelled", "expired"},
        "blocked": {"planned", "cancelled", "expired"},
        "paused": {"planned", "cancelled"},
        "failed": {"cancelled"},
    }.items()
    for b in tos
}
DISALLOWED = [(a, b) for a in STATES for b in STATES if (a, b) not in ALLOWED]


def _at_state(store, kind, state):
    """A row of `kind` sitting in `state`, reached by legal moves only."""
    row = store.create(kind, "t")
    path = {
        "planned": [],
        "active": ["active"],
        "paused": ["paused"],
        "blocked": ["active", "blocked"],
        "done": ["active", "done"],
        "failed": ["active", "failed"],
        "cancelled": ["cancelled"],
        "expired": ["expired"],
    }[state]
    for step in path:
        store.transition(row.id, step, reason="r")
    return store.get(row.id)


@pytest.mark.parametrize("frm,to", sorted(ALLOWED))
def test_every_allowed_move(store, frm, to):
    row = _at_state(store, "tool_call", frm)
    assert store.transition(row.id, to, reason="why").state == to


@pytest.mark.parametrize("frm,to", DISALLOWED)
def test_every_disallowed_move_refused(store, frm, to):
    row = _at_state(store, "tool_call", frm)
    before = len(store.events(row.id))
    with pytest.raises(TransitionRefused):
        store.transition(row.id, to, reason="why")
    assert store.get(row.id).state == frm and len(store.events(row.id)) == before


def test_goal_extra_moves(store):
    goal = _at_state(store, "goal", "blocked")
    assert store.transition(goal.id, "active").state == "active"
    # a goal reaches done or failed only through close_goal
    for frm in ("active", "blocked"):
        if frm == "blocked":
            store.transition(goal.id, "blocked")
        for to in ("done", "failed"):
            with pytest.raises(TransitionRefused):
                store.transition(goal.id, to, reason="x")


def test_other_kinds_cannot_move_blocked_to_active(store):
    row = _at_state(store, "tool_call", "blocked")
    with pytest.raises(TransitionRefused):
        store.transition(row.id, "active")


@pytest.mark.parametrize("frm", ["done", "cancelled", "expired"])
def test_loop_reopens(store, frm):
    loop = _at_state(store, "loop", frm)
    got = store.transition(loop.id, "planned")
    assert got.state == "planned" and got.ended_at is None and got.end_reason is None
    assert "reopened" in _kinds(store, loop.id)


def test_non_loop_cannot_reopen(store):
    row = _at_state(store, "timer", "done")
    with pytest.raises(TransitionRefused):
        store.transition(row.id, "planned")


def test_terminal_needs_reason_and_sets_ended(store, clock):
    row = store.create("tool_call", "t")
    store.transition(row.id, "active")
    store.update(row.id, progress="going")
    with pytest.raises(ValueError):
        store.transition(row.id, "done")
    clock.at += timedelta(seconds=9)
    got = store.transition(row.id, "done", reason="finished")
    assert got.end_reason == "finished" and got.ended_at == utc_text(clock.at)
    assert got.progress is None and got.reported_at is None
    event = store.events(row.id)[-1]
    assert event.kind == "state"
    assert event.data == {"from": "active", "to": "done", "reason": "finished"}


def test_transition_from_stale_state_refused(store):
    row = store.create("timer", "t")
    store.transition(row.id, "active")
    before = len(store.events(row.id))
    with pytest.raises(TransitionRefused):
        store.transition(row.id, "cancelled", reason="person", expect="planned")
    assert store.get(row.id).state == "active" and len(store.events(row.id)) == before
    assert store.transition(row.id, "done", reason="ok", expect="active").state == "done"


def test_transition_unknown_id(store):
    with pytest.raises(KeyError):
        store.transition("nope", "active")


# ---- rollup and parent end ----


def _goal_with_step(store):
    goal = store.create("goal", "g", state="active")
    step = store.create("expert_call", "s", parent_id=goal.id)
    store.transition(step.id, "active")
    return goal, step


def test_child_blocked_blocks_goal(store):
    goal, step = _goal_with_step(store)
    store.transition(step.id, "blocked", reason="needs person")
    assert store.get(goal.id).state == "blocked"


def test_child_resolved_unblocks_goal(store):
    goal, step = _goal_with_step(store)
    other = store.create("expert_call", "o", parent_id=goal.id)
    store.transition(other.id, "active")
    store.transition(step.id, "blocked")
    store.transition(other.id, "blocked")
    store.transition(step.id, "planned")
    assert store.get(goal.id).state == "blocked"  # a sibling is still blocked
    store.transition(other.id, "planned")
    assert store.get(goal.id).state == "active"


def test_child_failed_blocks_goal_never_fails_it(store):
    goal, step = _goal_with_step(store)
    store.transition(step.id, "failed", reason="boom")
    assert store.get(goal.id).state == "blocked"


def test_goal_close_cancels_children_and_expires_asks(store):
    goal = store.create("goal", "g", state="active")
    timer = store.create("timer", "t", parent_id=goal.id)
    ask = store.create("ask", "a", parent_id=goal.id)
    store.transition(ask.id, "active")
    grand = store.create("timer", "gt", parent_id=ask.id)
    done = store.create("tool_call", "d", parent_id=goal.id)
    store.transition(done.id, "active")
    store.transition(done.id, "done", reason="ok")
    store.mark_reported(done.id)
    closed = store.close_goal(goal.id, "done", "all good")
    assert closed.state == "done" and closed.summary == "all good"
    assert closed.end_reason == "closed by Scout" and closed.reported_at is not None
    t = store.get(timer.id)
    assert (t.state, t.end_reason) == ("cancelled", "goal closed")
    a = store.get(ask.id)
    assert (a.state, a.end_reason) == ("expired", "parent ended: closed by Scout")
    assert store.get(grand.id).state == "cancelled"
    assert store.get(done.id).state == "done"
    # rows ended by the close are already known to Scout
    assert store.unreported() == []


def test_close_goal_refuses_non_goal_or_ended(store):
    t = store.create("timer", "t")
    with pytest.raises(TransitionRefused):
        store.close_goal(t.id, "done", "x")
    goal = store.create("goal", "g", state="active")
    store.close_goal(goal.id, "failed", "no luck")
    with pytest.raises(TransitionRefused):
        store.close_goal(goal.id, "done", "again")


def test_goal_with_planned_children_stays_active(store):
    goal = store.create("goal", "g", state="active")
    store.create("timer", "t", parent_id=goal.id)
    assert store.get(goal.id).state == "active"


def test_children_ended_true_only_when_all_terminal(store):
    goal = store.create("goal", "g", state="active")
    assert store.children_ended(goal.id) is False
    a = store.create("tool_call", "a", parent_id=goal.id)
    b = store.create("tool_call", "b", parent_id=goal.id)
    store.transition(a.id, "cancelled", reason="x")
    assert store.children_ended(goal.id) is False
    store.transition(b.id, "expired", reason="x")
    assert store.children_ended(goal.id) is True
    assert TERMINAL == {"done", "failed", "cancelled", "expired"}


# ---- retry ----


def _active(store, safe=True):
    row = store.create("tool_call", "t", safe_to_retry=safe)
    store.transition(row.id, "active")
    return row


def test_retry_transient_safe_backs_off(store, clock):
    row = _active(store)
    for n, wait in enumerate([30, 120, 600], 1):
        got = store.fail(row.id, "transient", "timed out")
        assert (got.state, got.attempt) == ("planned", n)
        assert got.due_at == utc_text(clock.at + timedelta(seconds=wait))
        assert got.error_kind == "transient" and got.last_error == "timed out"
        assert "attempt_failed" in _kinds(store, row.id)
        store.transition(row.id, "active")
    got = store.fail(row.id, "transient", "timed out")
    assert got.state == "failed" and got.end_reason == "gave up after 3 tries: timed out"
    assert got.reported_at is None


def test_not_safe_fails_at_once(store):
    row = _active(store, safe=False)
    got = store.fail(row.id, "transient", "timed out")
    assert got.state == "failed" and got.end_reason == "not retryable: timed out"
    assert got.attempt == 0


def test_permanent_fails_at_once(store):
    row = _active(store)
    got = store.fail(row.id, "permanent", "login expired sk-x")
    assert got.state == "failed" and got.end_reason == "not retryable: login expired [secret]"
    assert got.error_kind == "permanent" and got.last_error == "login expired [secret]"


def test_fail_uses_store_retry_settings(db, clock):
    store = WorkStore(db, clock, retry=RetrySettings(max_attempts=1, backoff_s=(5,)))
    row = _active(store)
    assert store.fail(row.id, "transient", "x").due_at == utc_text(clock.at + timedelta(seconds=5))
    store.transition(row.id, "active")
    assert store.fail(row.id, "transient", "x").state == "failed"


def test_fail_refuses_row_that_is_not_active(store):
    row = store.create("tool_call", "t")
    with pytest.raises(TransitionRefused):
        store.fail(row.id, "permanent", "x")


def test_retry_step_resets_attempt(store):
    goal = store.create("goal", "g", state="active")
    row = store.create("tool_call", "t", parent_id=goal.id)
    store.transition(row.id, "active")
    store.fail(row.id, "permanent", "boom")
    assert store.get(goal.id).state == "blocked"
    got = store.retry_step(row.id)
    assert (got.state, got.attempt, got.ended_at, got.end_reason) == ("planned", 0, None, None)
    assert "retried" in _kinds(store, row.id)
    assert store.get(goal.id).state == "active"
    with pytest.raises(TransitionRefused):
        store.retry_step(row.id)  # planned rows are not retried


def test_retry_step_from_blocked(store):
    row = store.create("expert_call", "t")
    store.transition(row.id, "active")
    store.transition(row.id, "blocked", reason="restart")
    assert store.retry_step(row.id).state == "planned"


# ---- unreported and due ----


def test_unreported_and_mark_reported(store):
    a = _active(store)
    store.transition(a.id, "done", reason="ok")
    b = _active(store)
    store.transition(b.id, "blocked", reason="needs you")
    store.create("tool_call", "c")
    assert {r.id for r in store.unreported()} == {a.id, b.id}
    assert store.unreported(kinds=["timer"]) == []
    store.mark_reported(a.id)
    assert [r.id for r in store.unreported()] == [b.id]


def test_due_next_due_and_open_roots(store, clock):
    soon = store.create("timer", "soon", due_at=clock.at + timedelta(seconds=10))
    later = store.create("timer", "later", due_at=clock.at + timedelta(seconds=60))
    store.create("timer", "none")
    paused = store.create("timer", "p", due_at=clock.at)
    store.transition(paused.id, "paused")
    assert store.due(["timer"]) == []
    assert store.next_due(["timer"]) == clock.at + timedelta(seconds=10)
    clock.at += timedelta(seconds=10)
    assert [r.id for r in store.due(["timer"])] == [soon.id]
    clock.at += timedelta(seconds=100)
    assert [r.id for r in store.due(["timer"])] == [soon.id, later.id]
    assert store.due(["watch"]) == []
    child = store.create("tool_call", "c", parent_id=paused.id)
    store.transition(soon.id, "cancelled", reason="x")
    store.transition(later.id, "cancelled", reason="x")
    assert store.next_due(["timer"]) is None
    roots = {r.id for r in store.open_roots()}
    assert paused.id in roots and child.id not in roots and soon.id not in roots


# ---- config ----


def test_config_retry_settings():
    cfg = load_config({})
    assert cfg.retry_max == 3 and cfg.retry_backoff_s == (30, 120, 600)
    cfg = load_config({"TAGALONG_RETRY_MAX": "5", "TAGALONG_RETRY_BACKOFF_S": "1, 2,3"})
    assert cfg.retry_max == 5 and cfg.retry_backoff_s == (1, 2, 3)
    for bad in ("abc", "0", "-5", "1,,2", "30,x"):
        with pytest.raises(ValueError, match="TAGALONG_RETRY_BACKOFF_S"):
            load_config({"TAGALONG_RETRY_BACKOFF_S": bad})
    with pytest.raises(ValueError, match="TAGALONG_RETRY_MAX"):
        load_config({"TAGALONG_RETRY_MAX": "0"})


# ---- review fixes ----


def test_goal_stays_blocked_while_a_sibling_is_failed(store):
    goal = store.create("goal", "g", state="active")
    bad = store.create("tool_call", "bad", parent_id=goal.id)
    other = store.create("tool_call", "other", parent_id=goal.id)
    store.transition(bad.id, "active")
    store.transition(bad.id, "failed", reason="boom")
    store.transition(other.id, "active")
    assert store.get(goal.id).state == "blocked"


def test_skip_failed_step_unblocks_goal(store):
    goal = store.create("goal", "g", state="active")
    bad = store.create("tool_call", "bad", parent_id=goal.id)
    store.transition(bad.id, "active")
    store.transition(bad.id, "failed", reason="boom")
    assert store.get(goal.id).state == "blocked"
    assert store.transition(bad.id, "cancelled", reason="skipped").state == "cancelled"
    assert store.get(goal.id).state == "active"


def test_cannot_add_or_retry_under_an_ended_parent(store):
    goal = store.create("goal", "g", state="active")
    step = store.create("tool_call", "s", parent_id=goal.id)
    store.transition(step.id, "active")
    store.transition(step.id, "failed", reason="boom")
    store.mark_reported(step.id)
    store.close_goal(goal.id, "failed", "gave up")
    with pytest.raises(TransitionRefused):
        store.create("tool_call", "late", parent_id=goal.id)
    with pytest.raises(TransitionRefused):
        store.retry_step(step.id)
    assert store.get(step.id).state == "failed"


def test_reason_is_masked(store):
    row = store.create("tool_call", "t")
    store.transition(row.id, "active")
    got = store.transition(row.id, "failed", reason="bad key sk-x")
    assert got.end_reason == "bad key [secret]"
    assert store.events(row.id)[-1].data["reason"] == "bad key [secret]"


def test_unreported_index_matches_the_query(db):
    plan = db.execute(
        "EXPLAIN QUERY PLAN SELECT id FROM work WHERE reported_at IS NULL"
        " AND state IN ('done','failed','cancelled','expired','blocked')"
    ).fetchall()
    assert any("work_unreported" in str(r) for r in plan)


def test_close_goal_from_planned(store):
    goal = store.create("goal", "g")
    assert store.close_goal(goal.id, "done", "ok").state == "done"


def test_max_attempts_zero_is_kept(store):
    assert store.create("tool_call", "t", max_attempts=0).max_attempts == 0


def test_retry_step_is_due_now(store):
    row = store.create("tool_call", "t")
    store.transition(row.id, "active")
    store.fail(row.id, "permanent", "x")
    store.retry_step(row.id)
    assert [r.id for r in store.due(["tool_call"])] == [row.id]


def test_search_survives_updates_of_other_fields(store):
    row = store.create("goal", "invoice thing")
    store.update(row.id, progress="going")
    assert [r.id for r in store.search("invoice")] == [row.id]
