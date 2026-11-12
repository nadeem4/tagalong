"""The web source: the match rule that drops namesakes, and its budget and tool limits."""

import pytest
from know_fakes import FakeModel, budget, final

from brain.know.extract import BudgetStop
from brain.know.facts import Known
from brain.know.source import SourceGap
from brain.know.web import WebSource, matches
from brain.web_tools import MAX_USES

KNOWN = Known(handle="amyb", urls=("https://amy.dev",), name="Amy Brown", employer="Acme Corp")


def test_web_matches_handle():
    assert matches("Follow @AmyB on social", KNOWN)


def test_web_matches_listed_url():
    assert matches("Blog at https://amy.dev/posts", Known(urls=("https://amy.dev",)))


def test_web_matches_name_and_employer_together():
    assert matches(
        "Amy Brown joined Acme Corp in 2021", Known(name="Amy Brown", employer="Acme Corp")
    )


def test_web_matches_rejects_name_only():
    # a namesake: same name, nothing else that ties the page to this person
    assert not matches(
        "Amy Brown, a dentist in Ohio", Known(name="Amy Brown", employer="Acme Corp")
    )


def test_web_matches_rejects_employer_only():
    assert not matches("Acme Corp announced a sale", Known(name="Amy Brown", employer="Acme Corp"))


def test_web_matches_handle_is_whole_word():
    assert not matches("bobby tables", Known(handle="bob"))


def fetch(url, text):
    return {
        "type": "web_fetch_tool_result",
        "tool_use_id": "s1",
        "content": {
            "type": "web_fetch_result",
            "url": url,
            "content": {"type": "document", "source": {"type": "text", "data": text}},
        },
    }


async def test_web_read_skips_without_keys_as_gap(tmp_path):
    model = FakeModel()
    with pytest.raises(SourceGap, match="skipped"):
        await WebSource(model, budget(tmp_path)).read(None, Known(name="Amy Brown"))
    assert model.calls == []


async def test_web_read_keeps_only_matching_pages(tmp_path):
    blocks = [
        {"type": "text", "text": "done"},
        fetch("https://amy.dev/about", "I am amyb and I build CLIs."),
        fetch("https://other.example/amy", "Amy Brown, dentist."),
        fetch("https://news.example/acme", "Acme Corp quarterly results."),
    ]
    model = FakeModel(final(content=blocks))
    out = await WebSource(model, budget(tmp_path)).read(None, KNOWN)
    assert [m.ref for m in out] == ["https://amy.dev/about"]
    assert "amyb" in out[0].text


async def test_web_read_none_matched_is_gap(tmp_path):
    model = FakeModel(final(content=[fetch("https://x.example", "Amy Brown, dentist.")]))
    with pytest.raises(SourceGap, match="No web pages matched"):
        await WebSource(model, budget(tmp_path)).read(None, KNOWN)


async def test_web_read_requests_capped_web_tools(tmp_path):
    model = FakeModel(final(content=[fetch("https://amy.dev/a", "amyb")]))
    await WebSource(model, budget(tmp_path)).read(None, KNOWN)
    tools = model.calls[0][2]
    assert {t["name"] for t in tools} == {"web_search", "web_fetch"}
    assert all(t["max_uses"] == MAX_USES == 5 for t in tools)


async def test_web_read_spends_budget(tmp_path):
    b = budget(tmp_path)
    model = FakeModel(final(content=[fetch("https://amy.dev/a", "amyb")]))
    await WebSource(model, b).read(None, KNOWN)
    assert b.spent > 0


async def test_web_read_stops_on_spent_budget(tmp_path):
    model = FakeModel(final("x"))
    with pytest.raises(BudgetStop):
        await WebSource(model, budget(tmp_path, limit=0.0)).read(None, KNOWN)
    assert model.calls == []
