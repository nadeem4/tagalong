"""Tests for the loop store: save, update-not-duplicate, history, forget, wipe, reopen, masking."""

from datetime import UTC, datetime, timedelta

import pytest

from brain.loops.loop import Loop
from brain.loops.store import LoopStore
from brain.masking import Masker
from brain.memory import Memory

T0 = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


def mk(ref="t1", **kw):
    base = dict(source="app1", ref=ref, title="Reply to Sam", asks="send the Q4 numbers")
    base.update(kw)
    return Loop(**base)


@pytest.fixture
def store(tmp_path):
    mem = Memory(tmp_path / "t.db")
    yield LoopStore(mem.db, lambda: T0)
    mem.close()


def test_save_then_get_round_trips_every_field(store):
    due = T0 + timedelta(days=1)
    saved = store.save(
        mk(
            direction="they_owe",
            people=["sam@x.com"],
            due=due,
            quiet_after=due + timedelta(days=2),
            anchors=["Q4 pricing deck"],
        )
    )
    got = store.get(saved.id)
    assert got.title == "Reply to Sam" and got.direction == "they_owe"
    assert got.people == ["sam@x.com"] and got.anchors == ["Q4 pricing deck"]
    assert got.due == due and got.quiet_after == due + timedelta(days=2)
    assert got.status == "held" and got.created == T0 and got.updated == T0


def test_get_unknown_is_none(store):
    assert store.get("nope") is None


def test_list_filters_by_status(store):
    a = store.save(mk("a"))
    b = store.save(mk("b"))
    store.set_status(b.id, "done")
    assert [x.id for x in store.list("held")] == [a.id]
    assert {x.id for x in store.list()} == {a.id, b.id}


def test_save_same_source_and_ref_updates_not_duplicates(store):
    first = store.save(mk("a", title="old"))
    second = store.save(mk("a", title="new"))
    assert second.id == first.id
    assert len(store.list()) == 1
    assert store.get(first.id).title == "new"


def test_same_ref_in_another_source_is_a_different_loop(store):
    store.save(mk("a", source="app1"))
    store.save(mk("a", source="app2"))
    assert len(store.list()) == 2


def test_history_appends_in_order(store):
    lp = store.save(mk())
    store.add_history(lp.id, "reader: new")
    store.add_history(lp.id, "person: later")
    assert [h["note"] for h in store.get(lp.id).history] == ["reader: new", "person: later"]


def test_forget_one_removes_it_and_its_surface_log(store):
    a = store.save(mk("a"))
    b = store.save(mk("b"))
    store.mark_surfaced(a.id, "due", "2026-11-04")
    store.forget(a.id)
    assert store.get(a.id) is None and store.get(b.id) is not None
    assert store.surfaced(a.id) == {}


def test_wipe_removes_loops_cursor_and_surface_log(store):
    a = store.save(mk())
    store.mark_surfaced(a.id, "due", "2026-11-04")
    store.set_cursor("app1", "c-9")
    store.wipe()
    assert store.list() == [] and store.cursor("app1") is None


def test_cursor_is_per_app_and_overwritten(store):
    store.set_cursor("a", "1")
    store.set_cursor("a", "2")
    store.set_cursor("b", "x")
    assert (store.cursor("a"), store.cursor("b"), store.cursor("c")) == ("2", "x", None)


def test_surfaced_map_is_kept_on_the_loop(store):
    lp = store.save(mk())
    store.mark_surfaced(lp.id, "Q4 deck", "2026-11-04")
    store.mark_surfaced(lp.id, "Q4 deck", "2026-11-05")
    assert store.get(lp.id).surfaced == {"Q4 deck": "2026-11-05"}


def test_survives_reopen(tmp_path):
    mem = Memory(tmp_path / "t.db")
    lp = LoopStore(mem.db, lambda: T0).save(mk())
    mem.close()
    mem2 = Memory(tmp_path / "t.db")
    assert LoopStore(mem2.db, lambda: T0).get(lp.id).title == "Reply to Sam"
    mem2.close()


def test_text_fields_are_masked_on_save(tmp_path):
    mem = Memory(tmp_path / "t.db")
    masker = Masker(lambda: ["hunter2hunter2"])
    store = LoopStore(mem.db, lambda: T0, mask=masker.mask)
    lp = store.save(mk(asks="use password hunter2hunter2", people=["hunter2hunter2"]))
    store.add_history(lp.id, "saw hunter2hunter2")
    got = store.get(lp.id)
    assert "hunter2" not in got.asks and "[secret]" in got.asks
    assert got.people == ["[secret]"]
    assert "hunter2" not in got.history[0]["note"]
    mem.close()
