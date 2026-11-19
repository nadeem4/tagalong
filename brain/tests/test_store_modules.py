"""Round trips for the store modules that own chat, memory, apps and outputs SQL.

Each runs straight on `open_db`, with no Memory in between, so the store is tested alone.
"""

from brain.apps import AppRow
from brain.store import connections, conversation, outputs, search
from brain.store import memory as memory_store
from brain.store.db import open_db

AT = "2026-01-01T00:00:00+00:00"


def _db(tmp_path):
    return open_db(tmp_path / "t.db")


def test_conversation_round_trip(tmp_path):
    db = _db(tmp_path)
    msgs = [{"role": "user", "content": "hello"}, {"role": "assistant", "content": "hi"}]
    conversation.save_messages(db, msgs, AT)
    assert conversation.load_messages(db) == msgs


def test_memory_round_trip(tmp_path):
    db = _db(tmp_path)
    memory_store.remember(db, "about_you", "likes tea", None, AT)
    assert [i.text for i in memory_store.list_items(db, 10)] == ["likes tea"]


def test_apps_round_trip(tmp_path):
    db = _db(tmp_path)
    connections.add_app(db, AppRow("a1", "App", "stdio", {"command": "x"}, "none", True))
    connections.set_app_enabled(db, "a1", False)
    assert [(a.id, a.enabled) for a in connections.list_apps(db)] == [("a1", False)]
    connections.remove_app(db, "a1")
    assert connections.list_apps(db) == []


def test_outputs_prune_keeps_newest(tmp_path):
    db = _db(tmp_path)
    for n in range(5):
        outputs.put_output(db, f"o{n}", "tool", f"text {n}", AT)
    outputs.prune_outputs(db, 2)
    assert outputs.get_output(db, "o0") is None
    assert [outputs.get_output(db, "o3"), outputs.get_output(db, "o4")] == ["text 3", "text 4"]


def test_search_finds_memory_and_message(tmp_path):
    db = _db(tmp_path)
    memory_store.remember(db, "about_you", "likes marmalade", None, AT)
    conversation.save_messages(db, [{"role": "user", "content": "marmalade toast"}], AT)
    hits = search.search(db, "marmalade", None, 10)
    assert {h.kind for h in hits} == {"about_you", "chat"}
    assert sorted(h.ref for h in hits) == ["1", "chat:1"]


def test_saved_messages_record_their_body(tmp_path):
    db = _db(tmp_path)
    msg = [{"role": "user", "content": "hi"}]
    conversation.save_messages(db, msg, AT, "whatsapp")
    conversation.save_messages(db, msg, AT)
    rows = db.execute("SELECT body FROM messages ORDER BY id").fetchall()
    assert rows == [("whatsapp",), ("desktop",)]


def test_saved_user_rows_keep_their_event_and_source(tmp_path):
    db = _db(tmp_path)
    msgs = [
        {"role": "user", "content": "from the desktop"},
        {"role": "user", "content": "a job ended"},
        {"role": "assistant", "content": "ok"},
    ]
    ids = conversation.save_messages(
        db, msgs, AT, event_ids=["e1", "e2", None], sources=["desktop", "job:j1", None]
    )
    rows = db.execute("SELECT id, event_id, source FROM messages ORDER BY id").fetchall()
    assert rows == [
        (ids[0], "e1", "desktop"),
        (ids[1], "e2", "job:j1"),
        (ids[2], None, None),
    ]
    conversation.set_cut(db, ids[:2], True)
    assert conversation.load_messages(db) == [msgs[2]]


def _chat(db, n):
    msgs = [{"role": "assistant", "content": f"m{i}"} for i in range(n)]
    return conversation.save_messages(db, msgs, AT, sources=[None] * n)


def test_since_returns_rows_after_an_id(tmp_path):
    db = _db(tmp_path)
    ids = _chat(db, 4)
    rows, more = conversation.since(db, ids[1], 10)
    assert [r.text for r in rows] == ["m2", "m3"] and not more
    assert rows[0].id == ids[2] and rows[0].role == "assistant" and rows[0].at == AT


def test_since_with_no_id_returns_the_last_rows(tmp_path):
    db = _db(tmp_path)
    _chat(db, 5)
    rows, more = conversation.since(db, None, 2)
    assert [r.text for r in rows] == ["m3", "m4"] and more


def test_since_reports_more_when_limited(tmp_path):
    db = _db(tmp_path)
    ids = _chat(db, 5)
    rows, more = conversation.since(db, ids[0], 2)
    assert [r.text for r in rows] == ["m1", "m2"] and more


def test_since_pages_from_the_oldest_after_the_id(tmp_path):
    db = _db(tmp_path)
    ids = _chat(db, 30)
    first, more = conversation.since(db, ids[0], 20)
    assert more and first[-1].id == ids[20]
    rest, more = conversation.since(db, first[-1].id, 20)
    assert [r.id for r in rest] == ids[21:] and not more


def test_since_returns_only_final_assistant_rows_with_their_body(tmp_path):
    db = _db(tmp_path)
    tool = {"type": "tool_use", "id": "t1", "name": "x", "input": {}}
    msgs = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": [{"type": "text", "text": "Let me check"}, tool]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "r"}]},
        {"role": "assistant", "content": [{"type": "text", "text": "Done."}]},
    ]
    conversation.save_messages(db, msgs, AT, "whatsapp")
    rows, _ = conversation.since(db, None, 10)
    assert [(r.text, r.body) for r in rows] == [("Done.", "whatsapp")]


def test_since_an_unknown_id_acts_as_none(tmp_path):
    db = _db(tmp_path)
    _chat(db, 3)
    rows, _ = conversation.since(db, 999, 2)
    assert [r.text for r in rows] == ["m1", "m2"]
