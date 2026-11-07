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
    memory_store.remember(db, "about_you", "likes tea", None, None, AT)
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
    memory_store.remember(db, "about_you", "likes marmalade", None, None, AT)
    conversation.save_messages(db, [{"role": "user", "content": "marmalade toast"}], AT)
    hits = search.search(db, "marmalade", None, 10)
    assert {h.kind for h in hits} == {"about_you", "chat"}
    assert sorted(h.ref for h in hits) == ["1", "chat:1"]
