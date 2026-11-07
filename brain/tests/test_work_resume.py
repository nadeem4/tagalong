"""The resume scan: what the brain does with unfinished work when it starts again.

Each case seeds a database file, then opens it with a fresh WorkStore as a restart would.
"""

from datetime import UTC, datetime

import pytest

from brain.store.db import open_db, utc_text
from brain.store.work import WorkStore

NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


def _stores(tmp_path):
    path = tmp_path / "t.db"
    first = WorkStore(open_db(path), lambda: NOW)
    return first, lambda: WorkStore(open_db(path), lambda: NOW)


def _active(store, kind, **kw):
    row = store.create(kind, "t", **kw)
    store.transition(row.id, "active")
    return row


def _event_count(store):
    return store.db.execute("SELECT COUNT(*) FROM work_events").fetchone()[0]


def _kinds(store, work_id):
    return [e.kind for e in store.events(work_id)]


def _yes(row):
    return True


@pytest.mark.parametrize("state", ["planned", "active", "blocked"])
def test_resume_open_ask_expires(tmp_path, state):
    seed, restart = _stores(tmp_path)
    ask = seed.create("ask", "Edit export.py")
    if state != "planned":
        seed.transition(ask.id, "active")
    if state == "blocked":
        seed.transition(ask.id, "blocked", reason="x")
    store = restart()
    assert store.resume_scan(_yes) == [(ask.id, "expired")]
    got = store.get(ask.id)
    assert (got.state, got.end_reason, got.reported_at) == ("expired", "brain restarted", None)


def test_resume_open_question_expires(tmp_path):
    seed, restart = _stores(tmp_path)
    q = _active(seed, "question")
    store = restart()
    assert store.resume_scan(_yes) == [(q.id, "expired")]
    assert store.get(q.id).end_reason == "brain restarted"


def test_resume_expert_call_with_session_blocks(tmp_path):
    seed, restart = _stores(tmp_path)
    goal = seed.create("goal", "g", state="active")
    call = _active(seed, "expert_call", parent_id=goal.id)
    seed.update(call.id, checkpoint={"session_id": "s-81"})
    store = restart()
    asked = []
    out = store.resume_scan(lambda row: asked.append(row.id) or None)  # None is not False
    assert out == [(call.id, "blocked")] and asked == [call.id]
    got = store.get(call.id)
    assert (got.state, got.reported_at) == ("blocked", None)
    assert "resumed" in _kinds(store, call.id)
    assert store.get(goal.id).state == "blocked"  # the rollup tells Scout the goal is stuck


def test_resume_expert_call_cannot_reload_fails(tmp_path):
    seed, restart = _stores(tmp_path)
    with_session = _active(seed, "expert_call")
    seed.update(with_session.id, checkpoint={"session_id": "s-1"})
    no_session = _active(seed, "expert_call")
    store = restart()
    out = dict(store.resume_scan(lambda row: False))
    assert out == {with_session.id: "failed", no_session.id: "failed"}
    got = store.get(no_session.id)
    assert got.end_reason == "brain restarted, session cannot reload" and got.reported_at is None
    assert "failed on restart" in _kinds(store, no_session.id)


def test_resume_safe_tool_call_reruns(tmp_path):
    seed, restart = _stores(tmp_path)
    call = _active(seed, "tool_call", safe_to_retry=True)
    store = restart()
    assert store.resume_scan(_yes) == [(call.id, "rerun")]
    got = store.get(call.id)
    assert (got.state, got.due_at) == ("planned", utc_text(NOW))
    assert "resumed" in _kinds(store, call.id)


def test_resume_unsafe_tool_call_fails(tmp_path):
    seed, restart = _stores(tmp_path)
    call = _active(seed, "tool_call")
    store = restart()
    assert store.resume_scan(_yes) == [(call.id, "failed")]
    got = store.get(call.id)
    assert got.state == "failed" and got.end_reason == "brain restarted, unsure if it ran"
    assert got.reported_at is None


def test_resume_timer_watch_loop_untouched(tmp_path):
    seed, restart = _stores(tmp_path)
    rows = [
        _active(seed, "goal"),
        seed.create("timer", "t", due_at=NOW),
        seed.create("watch", "w"),
        seed.create("loop", "l"),
        seed.create("tool_call", "planned one"),
        _active(seed, "watch"),
    ]
    paused = seed.create("expert_call", "p")
    seed.transition(paused.id, "paused")
    blocked = _active(seed, "expert_call")
    seed.transition(blocked.id, "blocked", reason="x")
    done = _active(seed, "tool_call")
    seed.transition(done.id, "done", reason="ok")
    ids = [r.id for r in rows] + [paused.id, blocked.id, done.id]
    store = restart()
    before = [store.get(i) for i in ids]
    events = _event_count(store)
    assert store.resume_scan(_yes) == []
    assert [store.get(i) for i in ids] == before and _event_count(store) == events


def test_resume_scan_twice_changes_nothing(tmp_path):
    seed, restart = _stores(tmp_path)
    goal = seed.create("goal", "g", state="active")
    ask = _active(seed, "ask", parent_id=goal.id)
    call = _active(seed, "expert_call", parent_id=goal.id)
    seed.update(call.id, checkpoint={"session_id": "s"})
    safe = _active(seed, "tool_call", parent_id=goal.id, safe_to_retry=True)
    unsafe = _active(seed, "tool_call", parent_id=goal.id)
    store = restart()
    first = store.resume_scan(_yes)
    assert {w for w, _ in first} == {ask.id, call.id, safe.id, unsafe.id}
    events = _event_count(store)
    states = {w: store.get(w) for w, _ in first}
    again = restart()  # killed again before Scout spoke
    assert again.resume_scan(_yes) == []
    assert _event_count(again) == events
    assert {w: again.get(w) for w in states} == states


@pytest.mark.parametrize("unsafe_first", [True, False])
def test_resume_goal_ends_blocked_in_either_order(tmp_path, unsafe_first):
    seed, restart = _stores(tmp_path)
    goal = seed.create("goal", "g", state="active")
    for safe in [False, True] if unsafe_first else [True, False]:
        _active(seed, "tool_call", parent_id=goal.id, safe_to_retry=safe)
    store = restart()
    store.resume_scan(_yes)
    assert store.get(goal.id).state == "blocked"
