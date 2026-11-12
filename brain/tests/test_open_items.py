"""OpenItems: one lifecycle (open to answered, done or expired), one deadline, every move logged."""

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from brain.open_items import DEADLINE_S, OpenItemRefused, OpenItems
from brain.store.db import migrate, open_db

T0 = datetime(2026, 11, 11, 9, 0, 0, tzinfo=UTC)


class Clock:
    def __init__(self):
        self.at = T0

    def __call__(self):
        return self.at


def make(tmp_path, clock=None):
    clock = clock or Clock()
    return OpenItems(open_db(tmp_path / "t.db"), clock), clock


def test_answer_while_open_counts(tmp_path):
    items, clock = make(tmp_path)
    item = items.open("ask", "desktop", saved_call={"tool": "x"})
    clock.at = T0 + timedelta(seconds=DEADLINE_S - 1)
    done = items.answer(item.id, "yes", "desktop")
    assert (done.state, done.closed_by, done.answer) == ("answered", "desktop", "yes")
    assert done.reason == "answered"
    assert items.list_open() == []


def test_answer_after_expiry_is_refused_with_clear_reason(tmp_path):
    items, clock = make(tmp_path)
    item = items.open("ask", "desktop")
    clock.at = T0 + timedelta(seconds=DEADLINE_S)
    with pytest.raises(OpenItemRefused) as e:
        items.answer(item.id, "yes", "desktop")
    assert e.value.reason == "expired"
    with pytest.raises(OpenItemRefused) as e:
        items.answer("nope", "yes", "desktop")
    assert e.value.reason == "not_found"


def test_survives_restart(tmp_path):
    items, _ = make(tmp_path)
    item = items.open("install", "desktop", saved_call={"tool": "i"}, job_id="j1")
    items.db.close()
    again, _ = make(tmp_path)
    [back] = again.list_open("desktop")
    assert (back.id, back.saved_call, back.job_id) == (item.id, {"tool": "i"}, "j1")


def test_live_only_items_expire_on_restart(tmp_path):
    items, _ = make(tmp_path)
    live = items.open("expert_ask", "desktop", live_only=True)
    kept = items.open("ask", "desktop", saved_call={"tool": "x"})
    expired = items.expire_live_only()
    assert [i.id for i in expired] == [live.id]
    assert [i.id for i in items.list_open()] == [kept.id]
    assert items.get(live.id).reason == "process_ended"


def test_every_transition_is_logged(tmp_path, caplog):
    caplog.set_level("INFO", logger="brain.open_items")
    items, clock = make(tmp_path)
    a = items.open("ask", "desktop")
    b = items.open("choice", "desktop")
    c = items.open("setup", "desktop", ttl_s=10)
    items.answer(a.id, "yes", "desktop")
    items.finish(b.id, "ran")
    clock.at = T0 + timedelta(seconds=10)
    items.expire_due(clock.at)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("open_item.")]
    assert [ln.split()[0] for ln in lines] == [
        "open_item.opened",
        "open_item.opened",
        "open_item.opened",
        "open_item.answered",
        "open_item.done",
        "open_item.expired",
    ]
    assert f"id={a.id} kind=ask by=desktop why=answered" in lines[3]
    assert f"id={c.id} kind=setup by=brain why=deadline" in lines[5]


def test_one_deadline_rule(tmp_path):
    items, _ = make(tmp_path)
    default = items.open("ask", "desktop")
    short = items.open("ask", "desktop", ttl_s=60)
    assert default.deadline_at == T0 + timedelta(seconds=DEADLINE_S)
    assert short.deadline_at == T0 + timedelta(seconds=60)


def test_finish_keeps_the_answer(tmp_path):
    items, _ = make(tmp_path)
    item = items.open("ask", "desktop")
    items.answer(item.id, "yes please", "desktop")
    done = items.finish(item.id, "ran")
    assert (done.state, done.answer, done.reason) == ("done", "yes please", "ran")


def test_answer_in_a_closed_state_is_refused(tmp_path):
    items, _ = make(tmp_path)
    item = items.open("ask", "desktop")
    items.finish(item.id, "ran")
    with pytest.raises(OpenItemRefused) as e:
        items.answer(item.id, "yes", "desktop")
    assert e.value.reason == "closed"


def test_list_answered_holds_answered_but_not_done_items(tmp_path):
    items, _ = make(tmp_path)
    a = items.open("ask", "desktop", saved_call={"n": 1})
    b = items.open("ask", "desktop", saved_call={"n": 2})
    items.open("ask", "desktop", saved_call={"n": 3})
    items.answer(a.id, "allow", "desktop")
    items.answer(b.id, "allow", "desktop")
    items.finish(b.id, "ran")
    assert [i.id for i in items.list_answered("ask")] == [a.id]


def test_find_open_by_saved_call_ignores_closed_and_other_kinds(tmp_path):
    items, _ = make(tmp_path)
    call = {"name": "t", "input": {"b": 1, "a": 2}}
    first = items.open("ask", "desktop", saved_call={**call, "text": "Doing it."})
    items.open("offer", "desktop", saved_call={"name": "u"})
    assert items.find_open("ask", {"input": {"a": 2, "b": 1}, "name": "t"}).id == first.id
    assert items.find_open("ask", {"name": "t", "input": {"a": 9}}) is None
    assert items.find_open("ask", {"name": "other"}) is None
    items.answer(first.id, "deny", "desktop")
    assert items.find_open("ask", call) is None


def test_expire_due_and_list_open_can_take_one_kind(tmp_path):
    items, clock = make(tmp_path)
    items.open("ask", "desktop")
    items.open("offer", "desktop")
    clock.at = T0 + timedelta(seconds=DEADLINE_S)
    assert [i.kind for i in items.list_open(kind="offer")] == ["offer"]
    assert [i.kind for i in items.expire_due(clock.at, kind="ask")] == ["ask"]
    assert [i.kind for i in items.list_open()] == ["offer"]


def test_expired_since_lists_what_ended_while_away(tmp_path):
    items, clock = make(tmp_path)
    items.open("expert_ask", "desktop", live_only=True)
    items.expire_live_only()
    clock.at = T0 + timedelta(hours=1)
    new = items.open("expert_ask", "desktop", live_only=True)
    clock.at = T0 + timedelta(hours=2)
    items.expire_live_only()
    items.open("ask", "desktop", saved_call={"tool": "x"})
    assert [i.id for i in items.expired_since(T0 + timedelta(minutes=30))] == [new.id]


def test_held_news_is_an_open_item_kind(tmp_path):
    # Migration 0032 widens the kind list so the dispatcher can hold any event's news.
    items, _ = make(tmp_path)
    item = items.open("held", "desktop", saved_call={"event": "timer", "why": "budget_spent"})
    assert items.list_open(kind="held") == [item]


def test_migration_0032_keeps_existing_rows(tmp_path):
    raw = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(raw, upto=31)
    raw.execute(
        "INSERT INTO open_items(id, kind, origin_body, created_at, deadline_at)"
        " VALUES ('a', 'ask', 'desktop', 't', 't')"
    )
    migrate(raw)
    assert raw.execute("SELECT id, kind FROM open_items").fetchall() == [("a", "ask")]
    assert raw.execute("SELECT name FROM sqlite_master WHERE name = 'open_items_open'").fetchone()
