"""Tests for the SQLite memory store: kinds rules, remember, replace, forget, open/migrate."""

import sqlite3
from datetime import UTC, datetime, timedelta, timezone

import pytest

from brain import memory
from brain.memory import Memory, MemoryRefused


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
    assert item.cadence is None


def test_unknown_kind_refused(mem):
    with pytest.raises(MemoryRefused, match="instruction"):
        mem.remember("nonsense", "x")


def test_summary_kind_refused_for_model(mem):
    with pytest.raises(MemoryRefused, match="code"):
        mem.remember("summary", "x")


def test_blank_and_too_long_refused(mem):
    with pytest.raises(MemoryRefused):
        mem.remember("tracking", "   ")
    with pytest.raises(MemoryRefused, match="300"):
        mem.remember("instruction", "x" * 301)


def test_cadence_only_for_tracking(mem):
    assert mem.remember("tracking", "watch X", cadence="daily").cadence == "daily"
    with pytest.raises(MemoryRefused):
        mem.remember("about_you", "a", cadence="daily")


def test_exact_duplicate_not_added(mem):
    a = mem.remember("about_you", "Likes tea")
    b = mem.remember("about_you", "Likes tea")
    c = mem.remember("about_you", "Likes coffee")
    assert b.id == a.id
    assert c.id == a.id + 1


def test_full_kind_refused_with_hint(mem):
    for i in range(30):
        mem.remember("tracking", f"t{i}")
    with pytest.raises(MemoryRefused) as err:
        mem.remember("tracking", "one more")
    assert "replaces" in str(err.value)
    assert "forget" in str(err.value)


def test_replace_in_full_kind_works(mem):
    first = mem.remember("tracking", "t0")
    for i in range(1, 30):
        mem.remember("tracking", f"t{i}")
    new = mem.remember("tracking", "new", replaces=first.id)
    assert new.id == first.id
    assert new.text == "new"
    assert new.updated_at > first.updated_at
    assert new.created_at == first.created_at


def test_replace_rules(mem):
    a = mem.remember("tracking", "a")
    other = mem.remember("about_you", "b")
    gone = mem.remember("tracking", "gone")
    mem.forget(gone.id)
    mem._db.execute(
        "INSERT INTO memories(kind, text, created_at, updated_at) VALUES ('summary','s','x','x')"
    )
    summary_id = mem._db.execute("SELECT max(id) FROM memories").fetchone()[0]
    for bad in (999, other.id, gone.id):
        with pytest.raises(MemoryRefused):
            mem.remember("tracking", "z", replaces=bad)
    with pytest.raises(MemoryRefused):
        mem.remember("about_you", "z", replaces=summary_id)
    assert mem.remember("tracking", "a2", replaces=a.id).id == a.id


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

    monkeypatch.setattr(memory, "_probe_fts5", boom)
    with pytest.raises(RuntimeError, match="FTS5"):
        Memory(tmp_path / "t.db")


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
    mem.remember("tracking", "t")
    mem.remember("instruction", "i")
    mem.remember("project", "p")
    assert list(mem.always_loaded()) == ["instruction", "tracking"]


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
    assert memory.fts_query('Foo "bar"!') == '"foo" OR "bar"'
    assert memory.fts_query("***") == ""


def test_replace_without_cadence_keeps_old_cadence(mem):
    old = mem.remember("tracking", "Watch the build", "daily")
    new = mem.remember("tracking", "Watch the nightly build", replaces=old.id)
    assert new.cadence == "daily"
    assert mem.remember("tracking", "Watch it", "weekly", replaces=old.id).cadence == "weekly"


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


def test_compaction_text_reads_content():
    assert memory._compaction_text({"type": "compaction", "content": "sum"}) == "sum"
    assert memory._compaction_text({"type": "compaction", "content": None}) == ""


def test_upgrade_from_v1_keeps_items(tmp_path):
    path = tmp_path / "v1.db"
    db = sqlite3.connect(path)
    db.executescript(memory.MIGRATIONS[0] + "PRAGMA user_version = 1;")
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


def test_failed_migration_rolls_back(tmp_path, monkeypatch):
    bad = memory.MIGRATIONS + ("CREATE TABLE half(x); CREATE TABLE half(x);",)
    monkeypatch.setattr(memory, "MIGRATIONS", bad)
    with pytest.raises(sqlite3.OperationalError):
        Memory(tmp_path / "r.db")
    db = sqlite3.connect(tmp_path / "r.db", timeout=0, isolation_level=None)
    db.execute("BEGIN IMMEDIATE")  # fails with "locked" if the failed migration left a write open
    db.execute("ROLLBACK")
    assert db.execute("PRAGMA user_version").fetchone()[0] == len(memory.MIGRATIONS) - 1
    assert db.execute("SELECT name FROM sqlite_master WHERE name='half'").fetchall() == []
    db.close()
    monkeypatch.undo()
    Memory(tmp_path / "r.db").close()  # the real migrations still apply afterwards


def test_migration_creates_permissions_and_survives_reopen(tmp_path):
    m = Memory(tmp_path / "p.db")
    assert m.permission_modes() == {}
    m.set_permission_mode("x", "auto")
    m.close()
    m = Memory(tmp_path / "p.db")
    assert m.permission_modes() == {"x": "auto"}
    m.close()


def test_set_permission_mode_upserts(mem):
    mem.set_permission_mode("x", "ask")
    mem.set_permission_mode("x", "auto")
    assert mem.permission_modes() == {"x": "auto"}


def test_set_permission_mode_rejects_other_modes(mem):
    with pytest.raises(sqlite3.IntegrityError):
        mem.set_permission_mode("x", "maybe")


# ---- jobs (8a2) ----


def test_jobs_migration_keeps_existing_data(tmp_path):
    path = tmp_path / "old.db"
    db = sqlite3.connect(path, isolation_level=None)
    db.executescript("".join(memory.MIGRATIONS[:3]) + "PRAGMA user_version = 3;")
    db.execute(
        "INSERT INTO memories(kind,text,created_at,updated_at)"
        " VALUES('about_you','Likes tea','a','a')"
    )
    db.close()
    m = Memory(path)
    assert m.always_loaded()["about_you"][0].text == "Likes tea"
    assert m.list_jobs() == []
    m.close()


def test_job_round_trip(mem):
    job = mem.add_job("j1", "claude-code", "fix the test", "C:/p", "default")
    assert job.state == "running"
    assert job.reported is False
    assert job.ended_at is None
    assert job.started_at
    mem.update_job("j1", state="done", progress="almost", result="all fixed", session_id="s1")
    got = mem.get_job("j1")
    assert (got.state, got.progress, got.result, got.session_id) == (
        "done",
        "almost",
        "all fixed",
        "s1",
    )
    assert got.agent == "claude-code" and got.folder == "C:/p" and got.mode == "default"
    assert mem.get_job("nope") is None


def test_update_job_keeps_only_the_last_2000_chars_of_progress(mem):
    mem.add_job("j1", "a", "t", "f", "m")
    mem.update_job("j1", progress="x" * 5000 + "tail")
    got = mem.get_job("j1").progress
    assert len(got) == 2000 and got.endswith("tail")


def test_update_job_unknown_field_refused(mem):
    mem.add_job("j1", "a", "t", "f", "m")
    with pytest.raises(ValueError):
        mem.update_job("j1", nonsense="x")


def test_list_jobs_newest_first_and_limited(mem):
    for i in range(5):
        mem.add_job(f"j{i}", "a", "t", "f", "m")
    assert [j.id for j in mem.list_jobs()] == ["j4", "j3", "j2", "j1", "j0"]
    assert [j.id for j in mem.list_jobs(limit=2)] == ["j4", "j3"]


def test_running_jobs_only_running(mem):
    mem.add_job("a", "a", "t", "f", "m")
    mem.add_job("b", "a", "t", "f", "m")
    mem.update_job("b", state="done")
    assert [j.id for j in mem.running_jobs()] == ["a"]


def test_stop_running_on_start_only_touches_running(mem):
    mem.add_job("a", "a", "t", "f", "m")
    mem.add_job("b", "a", "t", "f", "m")
    mem.update_job("b", state="done", ended_at="x")
    mem.stop_running_on_start()
    a, b = mem.get_job("a"), mem.get_job("b")
    assert (a.state, a.reason) == ("stopped", "brain restarted")
    assert a.ended_at
    assert (b.state, b.reason, b.ended_at) == ("done", None, "x")


def test_unreported_jobs_finished_only(mem):
    for name in ("run", "done", "err", "stop", "seen"):
        mem.add_job(name, "a", "t", "f", "m")
    mem.update_job("done", state="done")
    mem.update_job("err", state="error")
    mem.update_job("stop", state="stopped")
    mem.update_job("seen", state="done")
    mem.mark_reported("seen")
    assert {j.id for j in mem.unreported_jobs()} == {"done", "err", "stop"}
    assert mem.get_job("seen").reported is True


def test_job_result_capped_at_20000_and_progress_at_2000(mem):
    mem.add_job("j", "a", "t", "f", "m")
    mem.update_job("j", result="x" * 25_000, progress="p" * 5000)
    got = mem.get_job("j")
    assert len(got.result) == 20_000
    assert len(got.progress) == 2000


# ---- timers (10b) ----


def _t(hour, minute=0, tz=UTC):
    return datetime(2026, 3, 1, hour, minute, tzinfo=tz)


def test_timers_table_exists_after_migration(mem):
    assert mem.list_timers() == []
    cols = [r[1] for r in mem._db.execute("PRAGMA table_info(timers)")]
    assert cols == ["id", "note", "next_at", "repeat_s", "created_at", "fired"]


def test_add_and_list_timers_soonest_first(mem):
    late = mem.add_timer("late", _t(12))
    soon = mem.add_timer("soon", _t(9), repeat_s=600)
    assert soon.repeat_s == 600 and late.repeat_s is None and not soon.fired
    assert soon.next_at == _t(9)
    assert [t.note for t in mem.list_timers()] == ["soon", "late"]
    assert mem.get_timer(late.id) == late
    assert mem.get_timer(999) is None


def test_due_timers_returns_only_those_at_or_before_now(mem):
    mem.add_timer("past", _t(8))
    mem.add_timer("exact", _t(9))
    mem.add_timer("future", _t(10))
    assert [t.note for t in mem.due_timers(_t(9))] == ["past", "exact"]


def test_next_at_is_stored_in_utc_and_compares_across_offsets(mem):
    plus5 = timezone(timedelta(hours=5))
    t = mem.add_timer("tz", datetime(2026, 3, 1, 14, 0, tzinfo=plus5))
    assert t.next_at == _t(9)
    assert t.next_at.utcoffset() == timedelta(0)
    stored = mem._db.execute("SELECT next_at FROM timers").fetchone()[0]
    assert stored == "2026-03-01T09:00:00+00:00"
    assert mem.due_timers(_t(9))[0].id == t.id


def test_delete_timer_returns_false_for_unknown_id(mem):
    t = mem.add_timer("x", _t(9))
    assert mem.delete_timer(t.id) is True
    assert mem.delete_timer(t.id) is False
    assert mem.list_timers() == []


def test_set_timer_next_moves_a_timer(mem):
    t = mem.add_timer("x", _t(9), repeat_s=300)
    mem.set_timer_next(t.id, _t(11))
    assert mem.get_timer(t.id).next_at == _t(11)
    assert mem.due_timers(_t(10)) == []


def test_fired_timers_are_excluded_from_due_and_listed_separately(mem):
    a = mem.add_timer("a", _t(8))
    mem.add_timer("b", _t(8))
    mem.mark_timer_fired(a.id)
    assert [t.note for t in mem.due_timers(_t(9))] == ["b"]
    assert [t.id for t in mem.fired_timers()] == [a.id]
    assert mem.get_timer(a.id).fired is True


def test_an_older_database_migrates_forward(tmp_path):
    path = tmp_path / "old.db"
    db = sqlite3.connect(path, isolation_level=None)
    n = len(memory.MIGRATIONS) - 1
    db.executescript("".join(memory.MIGRATIONS[:n]) + f"PRAGMA user_version = {n};")
    db.close()
    m = Memory(path)
    assert m.list_timers() == []
    m.close()


def _ap(mem, outcome="approved", by="person", group="g1", at="2026-01-01T00:00:00+00:00"):
    return mem.add_approval(
        source="scout_tool",
        tool="run",
        summary="s",
        input={"a": 1},
        job_id=None,
        group_key=group,
        outcome=outcome,
        decided_by=by,
        preference_id=None,
        at=at,
    )


def test_fresh_db_has_only_the_risky_default(mem):
    prefs = mem.list_preferences()
    assert len(prefs) == 1
    assert prefs[0].builtin is True
    assert prefs[0].sentence == "Always ask me before risky actions"
    assert mem.default_preference() == prefs[0]
    assert mem.has_user_preferences() is False


def test_default_is_not_reseeded_after_removal(tmp_path):
    m = Memory(tmp_path / "d.db")
    assert m.remove_preference(m.default_preference().id) is True
    m.close()
    m = Memory(tmp_path / "d.db")
    assert m.list_preferences() == []
    assert m.default_preference() is None
    m.close()


def test_add_preference_and_listing_order(mem):
    p = mem.add_preference(
        sentence="Run tests freely", source="scout_tool", tool="run", group_key="g1", at="t"
    )
    assert p.builtin is False and p.use_count == 0 and p.last_used is None
    assert [x.builtin for x in mem.list_preferences()] == [True, False]
    assert mem.has_user_preferences() is True
    assert mem.has_preference_for("g1") is True
    assert mem.has_preference_for("other") is False


def test_list_approvals_filters(mem):
    a = _ap(mem)
    b = _ap(mem, by="scout")
    c = _ap(mem, outcome="refused", by="person")
    assert [x.id for x in mem.list_approvals("all", 10, None)] == [c, b, a]
    assert [x.id for x in mem.list_approvals("scout", 10, None)] == [b]
    assert [x.id for x in mem.list_approvals("refused", 10, None)] == [c]
    assert [x.id for x in mem.list_approvals("all", 1, None)] == [c]
    assert [x.id for x in mem.list_approvals("all", 10, b)] == [a]
    assert mem.list_approvals("all", 10, None)[0].input == {"a": 1}


def test_approval_counts(mem):
    _ap(mem)
    _ap(mem, by="scout")
    _ap(mem, outcome="refused")
    assert mem.approval_counts() == {"total": 3, "scout": 1, "refused": 1}


def test_person_approvals_since_counts_only_person_approved_in_group(mem):
    _ap(mem, at="2026-01-02T00:00:00+00:00")
    _ap(mem, at="2026-01-03T00:00:00+00:00")
    _ap(mem, by="scout", at="2026-01-03T00:00:00+00:00")
    _ap(mem, outcome="refused", at="2026-01-03T00:00:00+00:00")
    _ap(mem, group="g2", at="2026-01-03T00:00:00+00:00")
    _ap(mem, at="2025-12-01T00:00:00+00:00")
    assert mem.person_approvals_since("g1", "2026-01-01T00:00:00+00:00") == 2


def test_use_preference_bumps_count_and_last_used(mem):
    p = mem.add_preference(sentence="x", source="app", tool="t", group_key="g", at="t0")
    mem.use_preference(p.id, "t1")
    mem.use_preference(p.id, "t2")
    got = next(x for x in mem.list_preferences() if x.id == p.id)
    assert (got.use_count, got.last_used) == (2, "t2")


def test_edit_and_remove_report_missing_ids(mem):
    p = mem.add_preference(sentence="x", source="app", tool="t", group_key="g", at="t0")
    assert mem.edit_preference(p.id, "y") is True
    assert mem.edit_preference(999, "y") is False
    assert mem.remove_preference(p.id) is True
    assert mem.remove_preference(p.id) is False


def test_offers_newest_first(mem):
    mem.add_offer("g", "2026-01-01", "no_answer")
    mem.add_offer("g", "2026-01-02", "yes")
    mem.add_offer("h", "2026-01-03", "none")
    assert mem.offers_for("g") == [("2026-01-02", "yes"), ("2026-01-01", "no_answer")]


def test_migration_is_one_step_after_timers(tmp_path):
    path = tmp_path / "old.db"
    db = sqlite3.connect(path, isolation_level=None)
    n = len(memory.MIGRATIONS) - 1
    db.executescript("".join(memory.MIGRATIONS[:n]) + f"PRAGMA user_version = {n};")
    db.close()
    m = Memory(path)
    v = m._db.execute("PRAGMA user_version").fetchone()[0]
    assert v == n + 1 == len(memory.MIGRATIONS)
    assert m.default_preference() is not None
    m.close()
