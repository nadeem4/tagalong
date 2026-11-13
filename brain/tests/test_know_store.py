"""Profile facts and the portrait in the memory store, and how recall, remember, the tools
and the prompt treat them.

Runs on a real temp database; no provider is involved.
"""

import pytest

from brain.memory import Memory
from brain.store.memory import MemoryRefused, NewFact


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


def fact(text, evidence=None, tag="work", ref="r"):
    return NewFact(tag, text, evidence or f"ev {text}", ref)


def texts(items):
    return [i.text for i in items]


def test_save_source_facts_replaces_same_source_only(mem):
    mem.save_source_facts("github", [fact("a"), fact("b")])
    mem.save_source_facts("linkedin", [fact("c")])
    mem.remember("about_you", "Likes tea")
    mem.save_source_facts("github", [fact("d")])
    by_source = {i.source: [] for i in mem.profile_facts()}
    for i in mem.profile_facts():
        by_source[i.source].append(i.text)
    assert by_source == {"github": ["d"], "linkedin": ["c"]}
    assert [i.text for i in mem.list_items(10) if i.kind == "about_you"] == ["Likes tea"]


def test_save_sets_visibility_from_tag(mem):
    saved = mem.save_source_facts(
        "github", [fact("a", tag="work"), fact("b", tag="Family"), fact("c", tag="")]
    )
    assert [(i.tag, i.visibility) for i in saved] == [
        ("work", "free"),
        ("family", "asked"),
        ("other", "asked"),
    ]


def test_forget_profile_fact_records_dismissal(mem):
    saved = mem.save_source_facts("github", [fact("a", "built foo")])
    mem.forget(saved[0].id)
    assert mem.save_source_facts("github", [fact("a", "built foo")]) == []
    assert texts(mem.save_source_facts("github", [fact("a", "built bar")])) == ["a"]


def test_dismissal_matches_after_whitespace_and_case(mem):
    saved = mem.save_source_facts("github", [fact("a", "Built  Foo")])
    mem.forget(saved[0].id)
    assert mem.save_source_facts("github", [fact("a", "built foo")]) == []


def test_duplicate_text_from_other_source_skipped(mem):
    mem.save_source_facts("github", [fact("Builds Foo", "e1")])
    assert mem.save_source_facts("linkedin", [fact("builds  foo", "e2")]) == []


def test_profile_cap_drops_extra(mem):
    saved = mem.save_source_facts("github", [fact(f"fact {n}") for n in range(501)])
    assert len(saved) == 500
    assert len(mem.profile_facts()) == 500


def test_profile_facts_can_leave_out_asked(mem):
    mem.save_source_facts("github", [fact("a", tag="work"), fact("b", tag="family")])
    assert texts(mem.profile_facts(include_asked=False)) == ["a"]
    assert texts(mem.profile_facts()) == ["a", "b"]


def test_set_portrait_replaces_single_row(mem):
    mem.set_portrait("first")
    mem.set_portrait("second")
    assert mem.portrait().text == "second"
    assert mem.db.execute("SELECT count(*) FROM memories WHERE kind='portrait'").fetchone()[0] == 1


def test_portrait_over_cap_refused(mem):
    with pytest.raises(MemoryRefused):
        mem.set_portrait("x" * 1501)


def test_portrait_none_when_unset(mem):
    assert mem.portrait() is None


def test_forget_portrait_refused(mem):
    p = mem.set_portrait("who")
    with pytest.raises(MemoryRefused, match="rewritten"):
        mem.forget(p.id)


def test_list_items_excludes_portrait(mem):
    mem.set_portrait("who")
    mem.remember("about_you", "tea")
    assert [i.kind for i in mem.list_items(10)] == ["about_you"]


def test_memory_masks_saved_fact(tmp_path):
    m = Memory(tmp_path / "m.db", mask=lambda t: t.replace("sk-123", "[secret]"))
    saved = m.save_source_facts("github", [fact("uses sk-123", "key sk-123")])
    assert saved[0].text == "uses [secret]"
    assert saved[0].evidence == "key [secret]"
    assert m.set_portrait("has sk-123").text == "has [secret]"
    m.close()


def test_withheld_fact_dropped(tmp_path):
    m = Memory(tmp_path / "m.db", mask=lambda t: "[withheld]" if "bad" in t else t)
    saved = m.save_source_facts("github", [fact("bad one"), fact("good one")])
    assert texts(saved) == ["good one"]
    m.close()


def _seed_profile(mem):
    mem.save_source_facts(
        "github",
        [fact("Ships widgets", tag="work"), fact("Widgets for the family", tag="family")],
    )


def test_recall_hides_asked_facts_by_default(mem):
    _seed_profile(mem)
    assert [h.text for h in mem.search("widgets")] == ["Ships widgets"]


def test_recall_include_personal_shows_them(mem):
    _seed_profile(mem)
    assert len(mem.search("widgets", include_personal=True)) == 2


def test_recall_never_returns_portrait(mem):
    mem.set_portrait("Makes widgets")
    assert mem.search("widgets", include_personal=True) == []
    assert mem.search("widgets", kind="portrait", include_personal=True) == []


@pytest.mark.parametrize("kind", ["profile", "portrait"])
def test_remember_cannot_write_profile_or_portrait(mem, kind):
    with pytest.raises(MemoryRefused, match="written by code"):
        mem.remember(kind, "x")


def test_remember_with_tag_sets_visibility(mem):
    item = mem.remember("about_you", "Has a dog", tag="personal", evidence="my dog Rex")
    assert (item.visibility, item.source, item.tag, item.evidence) == (
        "asked",
        "chat",
        "personal",
        "my dog Rex",
    )
    assert mem.remember("about_you", "Likes tea").visibility == "free"


def test_prompt_never_shows_asked_chat_facts(mem):
    from brain.mind.prompt import render_know

    mem.remember("about_you", "Has a dog", tag="personal")
    mem.remember("about_you", "Likes tea")
    out = render_know(mem.always_loaded())
    assert "Likes tea" in out and "dog" not in out


def test_profile_text_over_cap_or_empty_skipped(mem):
    saved = mem.save_source_facts(
        "github", [fact("  padded  "), fact("   "), fact("x" * 501), fact("x" * 500, "e2")]
    )
    assert texts(saved) == ["padded", "x" * 500]


def test_withheld_evidence_stored_as_none_on_remember(tmp_path):
    m = Memory(tmp_path / "w.db", mask=lambda t: "[withheld]" if "bad" in t else t)
    assert m.remember("about_you", "ok", evidence="bad words").evidence is None
    m.close()


@pytest.mark.parametrize("text", ["", "   "])
def test_empty_portrait_refused(mem, text):
    with pytest.raises(MemoryRefused):
        mem.set_portrait(text)


def _row(mem, text):
    return mem.db.execute(
        "SELECT category, span_start, span_end, layer, period FROM memories WHERE text=?", (text,)
    ).fetchone()


def test_save_source_facts_stores_category_and_span(mem):
    mem.save_source_facts("github", [NewFact("work", "a", "ev a", "r", "Languages", "2019", None)])
    item = mem.profile_facts()[0]
    assert (item.category, item.span_start, item.span_end) == ("Languages", "2019", None)
    assert _row(mem, "a") == ("Languages", "2019", None, "episodic", "year")


def test_undated_fact_stays_core(mem):
    mem.save_source_facts("github", [fact("b")])
    item = mem.profile_facts()[0]
    assert item.span_start is None and item.category is None
    assert _row(mem, "b") == (None, None, None, "core", None)


def dated(text, start, end=None, category=None, tag="work"):
    return NewFact(tag, text, f"ev {text}", "r", category, start, end)


def test_shape_counts_free_dated_facts_only(mem):
    mem.save_source_facts(
        "github",
        [
            dated("a", "2012", "2014", "Work"),
            dated("b", "2018", None, "Work"),
            dated("c", "2005", None, "Medical", tag="health"),
        ],
    )
    shape = mem.shape()
    assert shape.years == ("2012", "2018")
    assert shape.categories == [("Work", 2)]


def test_shape_excludes_summaries(mem):
    mem.save_source_facts("github", [dated("a", "2015", "2016", "Work")])
    mem.add_summary("we talked")
    assert mem.shape().years == ("2015", "2016")


def test_shape_empty_is_none(mem):
    mem.save_source_facts("github", [fact("plain")])
    shape = mem.shape()
    assert shape.years is None and shape.categories == []


def test_shape_updates_after_forget(mem):
    saved = mem.save_source_facts(
        "github", [dated("old", "2012", "2013", "Work"), dated("new", "2020", "2021", "Skills")]
    )
    assert mem.shape().years == ("2012", "2021")
    mem.forget(saved[0].id)
    shape = mem.shape()
    assert shape.years == ("2020", "2021") and shape.categories == [("Skills", 1)]


def test_shape_open_ended_fact_counts_its_start_year(mem):
    mem.save_source_facts("github", [dated("a", "2019", None, "Work")])
    assert mem.shape().years == ("2019", "2019")


def test_shape_orders_categories_by_count_then_name(mem):
    mem.save_source_facts(
        "github",
        [
            dated("a", "2019", None, "Skills"),
            dated("b", "2019", None, "Work"),
            dated("c", "2020", None, "Work"),
            dated("d", "2020", None, "Awards"),
        ],
    )
    assert mem.shape().categories == [("Work", 2), ("Awards", 1), ("Skills", 1)]
