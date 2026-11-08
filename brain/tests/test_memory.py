"""Tests for the SQLite memory store: kinds rules, remember, replace, forget, open/migrate."""

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from brain import memory
from brain.memory import Memory
from brain.store import rules, search
from brain.store.conversation import compaction_text
from brain.store.db import load_migrations, migrate
from brain.store.memory import MemoryRefused
from brain.store.search import fts_query

# The schema before jobs held parts: what the old-database tests seed, whatever is added after.
_PARTS_MIGRATION = (
    next(m.number for m in load_migrations() if m.sql and "CREATE TABLE job_parts" in m.sql) - 1
)


@pytest.fixture
def mem(tmp_path):
    clock = {"t": datetime(2026, 1, 1, tzinfo=UTC)}

    def now():
        clock["t"] += timedelta(seconds=1)
        return clock["t"]

    m = Memory(tmp_path / "t.db", now=now)
    yield m
    m.close()


def test_remember_returns_item(mem):
    item = mem.remember("about_you", "Likes tea")
    assert item.id == 1
    assert item.kind == "about_you"
    assert item.text == "Likes tea"


def test_unknown_kind_refused(mem):
    with pytest.raises(MemoryRefused, match="instruction"):
        mem.remember("nonsense", "x")


def test_summary_kind_refused_for_model(mem):
    with pytest.raises(MemoryRefused, match="code"):
        mem.remember("summary", "x")


def test_blank_and_too_long_refused(mem):
    with pytest.raises(MemoryRefused):
        mem.remember("instruction", "   ")
    with pytest.raises(MemoryRefused, match="300"):
        mem.remember("instruction", "x" * 301)


def test_tracking_kind_is_gone(mem):
    with pytest.raises(MemoryRefused, match="Unknown kind 'tracking'"):
        mem.remember("tracking", "watch X")


def test_exact_duplicate_not_added(mem):
    a = mem.remember("about_you", "Likes tea")
    b = mem.remember("about_you", "Likes tea")
    c = mem.remember("about_you", "Likes coffee")
    assert b.id == a.id
    assert c.id == a.id + 1


def test_full_kind_refused_with_hint(mem):
    for i in range(50):
        mem.remember("instruction", f"t{i}")
    with pytest.raises(MemoryRefused) as err:
        mem.remember("instruction", "one more")
    assert "replaces" in str(err.value)
    assert "forget" in str(err.value)


def test_replace_in_full_kind_works(mem):
    first = mem.remember("instruction", "t0")
    for i in range(1, 50):
        mem.remember("instruction", f"t{i}")
    new = mem.remember("instruction", "new", replaces=first.id)
    assert new.id == first.id
    assert new.text == "new"
    assert new.updated_at > first.updated_at
    assert new.created_at == first.created_at


def test_replace_rules(mem):
    a = mem.remember("instruction", "a")
    other = mem.remember("about_you", "b")
    gone = mem.remember("instruction", "gone")
    mem.forget(gone.id)
    mem._db.execute(
        "INSERT INTO memories(kind, text, created_at, updated_at) VALUES ('summary','s','x','x')"
    )
    summary_id = mem._db.execute("SELECT max(id) FROM memories").fetchone()[0]
    for bad in (999, other.id, gone.id):
        with pytest.raises(MemoryRefused):
            mem.remember("instruction", "z", replaces=bad)
    with pytest.raises(MemoryRefused):
        mem.remember("about_you", "z", replaces=summary_id)
    assert mem.remember("instruction", "a2", replaces=a.id).id == a.id


def test_replace_with_text_of_another_item_merges(mem):
    a = mem.remember("about_you", "A")
    b = mem.remember("about_you", "B")
    result = mem.remember("about_you", "B", replaces=a.id)
    assert result.id == b.id
    with pytest.raises(MemoryRefused):
        mem.forget(a.id)


def test_forget_returns_deleted_item(mem):
    i = mem.remember("about_you", "x")
    assert mem.forget(i.id) == i
    with pytest.raises(MemoryRefused, match="no memory"):
        mem.forget(i.id)


def test_reopen_keeps_data_and_wal(tmp_path):
    path = tmp_path / "t.db"
    m = Memory(path)
    m.remember("about_you", "kept")
    m.close()
    m2 = Memory(path)
    assert m2.forget(1).text == "kept"
    assert m2._db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    m2.close()


def test_fts5_missing_fails_clearly(tmp_path, monkeypatch):
    def boom(_db):
        raise sqlite3.OperationalError("no such module: fts5")

    monkeypatch.setattr(search, "probe_fts5", boom)
    with pytest.raises(RuntimeError, match="FTS5"):
        Memory(tmp_path / "t.db")


def test_memory_uses_store_open(tmp_path):
    m = Memory(tmp_path / "t.db")
    assert m.db.execute("PRAGMA user_version").fetchone()[0] == load_migrations()[-1].number
    assert hasattr(memory, "MIGRATIONS") is False
    m.close()


def test_newer_schema_refused(tmp_path):
    path = tmp_path / "t.db"
    db = sqlite3.connect(path)
    db.execute("PRAGMA user_version = 99")
    db.close()
    with pytest.raises(RuntimeError, match="newer"):
        Memory(path)


def test_creates_missing_folder(tmp_path):
    m = Memory(tmp_path / "a" / "b" / "t.db")
    m.remember("about_you", "x")
    m.close()


def test_always_loaded_groups_in_kind_order(mem):
    mem.remember("about_you", "t")
    mem.remember("instruction", "i")
    mem.remember("project", "p")
    assert list(mem.always_loaded()) == ["instruction", "about_you"]


def test_always_loaded_oldest_first(mem):
    a = mem.remember("about_you", "first")
    b = mem.remember("about_you", "second")
    assert [i.id for i in mem.always_loaded()["about_you"]] == [a.id, b.id]


def test_search_finds_by_stem(mem):
    item = mem.remember("about_you", "Prefers short answers")
    [hit] = mem.search("answer")
    assert hit.ref == str(item.id)
    assert hit.kind == "about_you"
    assert hit.at == item.updated_at
    assert hit.text == "Prefers short answers"


def test_search_kind_filter(mem):
    mem.remember("about_you", "likes tea")
    mem.remember("project", "tea shop site")
    assert [h.kind for h in mem.search("tea", kind="project")] == ["project"]
    assert mem.search("tea", kind="nonsense") == []


def test_search_limit(mem):
    for i in range(5):
        mem.remember("project", f"tea note {i}")
    assert len(mem.search("tea", limit=3)) == 3


def test_search_covers_search_only_and_always_kinds(mem):
    mem.remember("project", "tea shop")
    mem.remember("instruction", "tea first")
    assert {h.kind for h in mem.search("tea")} == {"project", "instruction"}


@pytest.mark.parametrize("q", ['"unclosed', "AND", "foo*", "a:b", "NEAR(", "", "***"])
def test_search_survives_hostile_queries(mem, q):
    mem.remember("about_you", "foo and a b")
    assert isinstance(mem.search(q), list)
    if q in ("", "***"):
        assert mem.search(q) == []


def test_search_sees_replaced_and_forgotten(mem):
    a = mem.remember("about_you", "likes tea")
    mem.remember("about_you", "likes coffee", replaces=a.id)
    assert mem.search("tea") == []
    assert len(mem.search("coffee")) == 1
    mem.forget(a.id)
    assert mem.search("coffee") == []


def test_fts_query_quotes_tokens():
    assert fts_query('Foo "bar"!') == '"foo" OR "bar"'
    assert fts_query("***") == ""


# --- 6b: saved chat, summaries, hardening ---


def _msg(role, *blocks):
    return {"role": role, "content": list(blocks)}


def test_save_and_load_round_trip(mem):
    msgs = [
        {"role": "user", "content": "hello there"},
        _msg("assistant", {"type": "text", "text": "hi"}),
    ]
    mem.save_messages(msgs)
    assert mem.load_messages() == msgs


def test_images_and_documents_are_not_stored(tmp_path):
    path = tmp_path / "img.db"
    m = Memory(path)
    big = "QUJD" * 500
    m.save_messages(
        [
            _msg(
                "user",
                {"type": "image", "source": {"type": "base64", "data": big}},
                {"type": "document", "source": {"type": "base64", "data": big}},
            )
        ]
    )
    loaded = m.load_messages()
    m.close()
    assert loaded[0]["content"] == [
        {"type": "text", "text": "[screenshot]"},
        {"type": "text", "text": "[document]"},
    ]
    for f in tmp_path.glob("img.db*"):
        assert big.encode() not in f.read_bytes()


def test_image_inside_tool_result_is_not_stored(tmp_path):
    path = tmp_path / "tr.db"
    m = Memory(path)
    big = "QUJD" * 500
    m.save_messages(
        [
            _msg(
                "user",
                {
                    "type": "tool_result",
                    "tool_use_id": "t1",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "data": big}},
                    ],
                },
            )
        ]
    )
    loaded = m.load_messages()
    m.close()
    assert loaded[0]["content"][0]["content"] == [{"type": "text", "text": "[screenshot]"}]
    for f in tmp_path.glob("tr.db*"):
        assert big.encode() not in f.read_bytes()


def test_save_is_atomic_and_ordered(mem):
    mem.save_messages([{"role": "user", "content": "one"}])
    with pytest.raises(TypeError):
        mem.save_messages(
            [{"role": "user", "content": "two"}, {"role": "user", "content": object()}]
        )
    assert [m["content"] for m in mem.load_messages()] == ["one"]
    mem.save_messages([{"role": "user", "content": "two"}, {"role": "user", "content": "three"}])
    assert [m["content"] for m in mem.load_messages()] == ["one", "two", "three"]


def test_thinking_and_tool_input_not_in_text_column(mem):
    mem.save_messages(
        [
            _msg(
                "assistant",
                {"type": "thinking", "thinking": "secretthought", "signature": "s"},
                {"type": "tool_use", "id": "t1", "name": "x", "input": {"q": "secretinput"}},
                {"type": "text", "text": "visible"},
            ),
            _msg("user", {"type": "tool_result", "tool_use_id": "t1", "content": "resultbody"}),
        ]
    )
    texts = [r[0] for r in mem._db.execute("SELECT text FROM messages ORDER BY id")]
    assert texts == ["visible", "resultbody"]


def test_search_finds_chat(mem):
    mem.save_messages([{"role": "user", "content": "we planned the Lisbon trip"}])
    hits = mem.search("lisbon")
    assert len(hits) == 1
    assert hits[0].kind == "chat"
    assert hits[0].ref.startswith("chat:")
    assert "Lisbon" in hits[0].text
    assert mem.search("lisbon", kind="project") == []
    assert len(mem.search("lisbon", kind="chat")) == 1


def test_search_orders_memory_before_chat_up_to_limit(mem):
    mem.remember("project", "lisbon notes")
    mem.save_messages([{"role": "user", "content": "lisbon chat"}])
    assert [h.kind for h in mem.search("lisbon")] == ["project", "chat"]
    assert [h.kind for h in mem.search("lisbon", limit=1)] == ["project"]
    assert mem.search("lisbon", kind="chat")[0].kind == "chat"


def test_add_summary_is_search_only_kind(mem):
    item = mem.add_summary("We talked about tea")
    assert item.kind == "summary"
    assert "summary" not in mem.always_loaded()
    assert [h.kind for h in mem.search("tea")] == ["summary"]


# ---- layers and masking on save (S7) ----

_LAYER_COLUMNS = (
    "layer, period, span_start, span_end, source_msg_from, source_msg_to, source_work_id"
)


def _layers(m, kind):
    sql = f"SELECT {_LAYER_COLUMNS} FROM memories WHERE kind=?"
    return [tuple(r) for r in m.db.execute(sql, (kind,))]


def test_memory_layers_migrated(tmp_path):
    path = tmp_path / "old.db"
    db = sqlite3.connect(path, isolation_level=None)
    migrate(db, upto=24)  # the schema before the layers (0025)
    at = "2026-01-02T03:04:05+00:00"
    for kind in ("instruction", "about_you", "project", "summary", "mystery"):
        db.execute(
            "INSERT INTO memories(kind, text, created_at, updated_at) VALUES (?, 'x', ?, ?)",
            (kind, at, at),
        )
    db.close()
    m = Memory(path)
    for kind in ("instruction", "about_you", "project", "mystery"):
        assert _layers(m, kind) == [("core", None, None, None, None, None, None)]
    assert _layers(m, "summary") == [("episodic", "day", at, at, None, None, None)]
    assert [i.kind for i in m.list_items(10)].count("summary") == 1  # Home's list is stable
    m.close()


def test_remember_refuses_withheld_text(tmp_path):
    m = Memory(tmp_path / "t.db", mask=lambda t: "[withheld]")
    with pytest.raises(MemoryRefused, match="withheld"):
        m.remember("about_you", "something a guard blocks")
    assert m.list_items(10) == []
    m.close()


def test_summary_is_episodic_day(mem):
    item = mem.add_summary("We talked about tea")
    layer, period, start, end, *_ = _layers(mem, "summary")[0]
    assert (layer, period) == ("episodic", "day")
    assert start == end == item.created_at


def test_remember_masks_secret(tmp_path):
    m = Memory(tmp_path / "t.db", mask=lambda t: t.replace("sk-fake-123", "[secret]"))
    assert m.remember("about_you", "My key is sk-fake-123").text == "My key is [secret]"
    assert m.add_summary("Pasted sk-fake-123 once").text == "Pasted [secret] once"
    assert not [i for i in m.list_items(10) if "sk-fake-123" in i.text]
    m.close()


def test_compaction_text_reads_content():
    assert compaction_text({"type": "compaction", "content": "sum"}) == "sum"
    assert compaction_text({"type": "compaction", "content": None}) == ""


def test_upgrade_from_v1_keeps_items(tmp_path):
    path = tmp_path / "v1.db"
    db = sqlite3.connect(path, isolation_level=None)
    migrate(db, upto=1)
    db.execute(
        "INSERT INTO memories(kind,text,created_at,updated_at)"
        " VALUES('about_you','Likes tea','a','a')"
    )
    db.commit()
    db.close()
    m = Memory(path)
    assert m.always_loaded()["about_you"][0].text == "Likes tea"
    m.save_messages([{"role": "user", "content": "hi"}])
    assert len(m.load_messages()) == 1
    m.close()


def test_migration_creates_permissions_and_survives_reopen(tmp_path):
    m = Memory(tmp_path / "p.db")
    assert rules.permission_modes(m.db) == {}
    rules.set_permission_mode(m.db, "x", "auto")
    m.close()
    m = Memory(tmp_path / "p.db")
    assert rules.permission_modes(m.db) == {"x": "auto"}
    m.close()


def test_set_permission_mode_upserts(mem):
    rules.set_permission_mode(mem.db, "x", "ask")
    rules.set_permission_mode(mem.db, "x", "auto")
    assert rules.permission_modes(mem.db) == {"x": "auto"}


def test_set_permission_mode_rejects_other_modes(mem):
    with pytest.raises(sqlite3.IntegrityError):
        rules.set_permission_mode(mem.db, "x", "maybe")


def test_off_is_a_stored_permission_and_survives_reopen(tmp_path):
    m = Memory(tmp_path / "o.db")
    rules.set_permission_mode(m.db, "x", "off")
    m.close()
    m = Memory(tmp_path / "o.db")
    assert rules.permission_modes(m.db) == {"x": "off"}
    m.close()


def test_off_migration_keeps_rows_stored_before_it(tmp_path):
    path = tmp_path / "old.db"
    db = sqlite3.connect(str(path), isolation_level=None)
    migrate(db, upto=14)  # the schema as it was before Off existed (0015)
    db.execute("INSERT INTO permissions(tool, mode) VALUES ('x', 'auto')")
    db.commit()
    db.close()
    m = Memory(path)
    assert rules.permission_modes(m.db) == {"x": "auto"}
    rules.set_permission_mode(m.db, "x", "off")
    assert rules.permission_modes(m.db) == {"x": "off"}
    m.close()


# ---- jobs (8a2) ----


def test_an_older_database_migrates_forward(tmp_path):
    path = tmp_path / "old.db"
    db = sqlite3.connect(path, isolation_level=None)
    n = _PARTS_MIGRATION
    migrate(db, upto=n)
    db.close()
    m = Memory(path)
    assert m.list_items(10) == []
    m.close()


def test_fresh_db_has_only_the_risky_default(mem):
    prefs = rules.list_preferences(mem.db)
    assert len(prefs) == 1
    assert prefs[0].builtin is True
    assert prefs[0].sentence == "Always ask me before risky actions"
    assert rules.has_user_preferences(mem.db) is False


def test_default_is_not_reseeded_after_removal(tmp_path):
    m = Memory(tmp_path / "d.db")
    assert rules.remove_preference(m.db, rules.list_preferences(m.db)[0].id) is True
    m.close()
    m = Memory(tmp_path / "d.db")
    assert rules.list_preferences(m.db) == []
    assert not any(p.builtin for p in rules.list_preferences(m.db))
    m.close()


def test_add_preference_and_listing_order(mem):
    p = rules.add_preference(
        mem.db, sentence="Run tests freely", source="scout_tool", tool="run", group_key="g1", at="t"
    )
    assert p.builtin is False and p.use_count == 0 and p.last_used is None
    assert [x.builtin for x in rules.list_preferences(mem.db)] == [True, False]
    assert rules.has_user_preferences(mem.db) is True
    assert rules.has_preference_for(mem.db, "g1") is True
    assert rules.has_preference_for(mem.db, "other") is False


def test_use_preference_bumps_count_and_last_used(mem):
    p = rules.add_preference(mem.db, sentence="x", source="app", tool="t", group_key="g", at="t0")
    rules.use_preference(mem.db, p.id, "t1")
    rules.use_preference(mem.db, p.id, "t2")
    got = next(x for x in rules.list_preferences(mem.db) if x.id == p.id)
    assert (got.use_count, got.last_used) == (2, "t2")


def test_edit_and_remove_report_missing_ids(mem):
    p = rules.add_preference(mem.db, sentence="x", source="app", tool="t", group_key="g", at="t0")
    assert rules.edit_preference(mem.db, p.id, "y") is True
    assert rules.edit_preference(mem.db, 999, "y") is False
    assert rules.remove_preference(mem.db, p.id) is True
    assert rules.remove_preference(mem.db, p.id) is False


def test_offers_newest_first(mem):
    rules.add_offer(mem.db, "g", "2026-01-01", "no_answer")
    rules.add_offer(mem.db, "g", "2026-01-02", "yes")
    rules.add_offer(mem.db, "h", "2026-01-03", "none")
    assert rules.offers_for(mem.db, "g") == [("2026-01-02", "yes"), ("2026-01-01", "no_answer")]


def test_migration_is_one_step_after_timers(tmp_path):
    path = tmp_path / "old.db"
    db = sqlite3.connect(path, isolation_level=None)
    n = _PARTS_MIGRATION
    migrate(db, upto=n)
    db.close()
    m = Memory(path)
    v = m._db.execute("PRAGMA user_version").fetchone()[0]
    assert v == len(load_migrations())
    assert any(p.builtin for p in rules.list_preferences(m.db))
    m.close()


def test_save_messages_records_the_body(mem):
    mem.save_messages([{"role": "user", "content": "a"}], "whatsapp")
    mem.save_messages([{"role": "user", "content": "b"}])
    rows = mem._db.execute("SELECT body FROM messages ORDER BY id").fetchall()
    assert rows == [("whatsapp",), ("desktop",)]
