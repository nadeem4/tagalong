"""The portrait writer: built only from saved free facts, trimmed to its cap, and the old
portrait kept whenever a new one cannot be written. Fake model, real Memory."""

import pytest
from know_fakes import FakeModel, budget, final

from brain.know.extract import BudgetStop
from brain.know.portrait import PORTRAIT_MAX, trim, write_portrait
from brain.memory import Memory
from brain.store.memory import NewFact


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


def seed(mem):
    mem.save_source_facts(
        "github",
        [
            NewFact("work", "Builds compilers at Acme", "compilers", "r"),
            NewFact("family", "Has two daughters", "daughters", "r"),
        ],
    )


async def test_portrait_input_excludes_asked(mem, tmp_path):
    seed(mem)
    model = FakeModel(final("Alice builds compilers."))
    await write_portrait(model, budget(tmp_path), mem)
    sent = str(model.calls[0][1])
    assert "Builds compilers at Acme" in sent and "daughters" not in sent


async def test_portrait_input_is_fenced_as_data(mem, tmp_path):
    seed(mem)
    model = FakeModel(final("Alice builds compilers."))
    await write_portrait(model, budget(tmp_path), mem)
    assert "untrusted" in str(model.calls[0][1])


async def test_portrait_saved_replacing_previous(mem, tmp_path):
    seed(mem)
    mem.set_portrait("Old text.")
    text = await write_portrait(FakeModel(final("New text.")), budget(tmp_path), mem)
    assert text == "New text." and mem.portrait().text == "New text."


def test_trim_cuts_at_the_last_sentence_end():
    text = "One. " * 400
    out = trim(text)
    assert len(out) <= PORTRAIT_MAX and out.endswith("One.")
    assert trim("Short.") == "Short."


def test_trim_without_a_sentence_end_cuts_at_the_cap():
    assert len(trim("x" * 3000)) == PORTRAIT_MAX


async def test_portrait_trimmed_to_cap_at_sentence(mem, tmp_path):
    seed(mem)
    text = await write_portrait(FakeModel(final("A fact. " * 400)), budget(tmp_path), mem)
    assert len(text) <= PORTRAIT_MAX and text.endswith(".")
    assert mem.portrait().text == text


async def test_no_free_facts_returns_none_and_keeps_old_portrait(mem, tmp_path):
    mem.save_source_facts("github", [NewFact("family", "Has two daughters", "daughters", "r")])
    mem.set_portrait("Old text.")
    model = FakeModel()
    assert await write_portrait(model, budget(tmp_path), mem) is None
    assert model.calls == [] and mem.portrait().text == "Old text."


async def test_empty_reply_keeps_old_portrait(mem, tmp_path):
    seed(mem)
    mem.set_portrait("Old text.")
    assert await write_portrait(FakeModel(final("  ")), budget(tmp_path), mem) is None
    assert mem.portrait().text == "Old text."


async def test_portrait_budget_stop_keeps_old(mem, tmp_path):
    seed(mem)
    mem.set_portrait("Old text.")
    with pytest.raises(BudgetStop):
        await write_portrait(FakeModel(), budget(tmp_path, limit=0.0), mem)
    assert mem.portrait().text == "Old text."


async def test_portrait_input_has_free_chat_facts_but_not_asked_ones(mem, tmp_path):
    seed(mem)
    mem.remember("about_you", "Works at Initech, not Acme")
    mem.remember("project", "Building a garden planner")
    mem.remember("about_you", "Has a sister named Zed", tag="personal")
    mem.remember("instruction", "Answer in short sentences")
    model = FakeModel(final("Alice works at Initech."))
    await write_portrait(model, budget(tmp_path), mem)
    sent = str(model.calls[0][1])
    assert "Works at Initech, not Acme" in sent and "garden planner" in sent
    assert "Zed" not in sent and "daughters" not in sent and "short sentences" not in sent


async def test_portrait_writes_from_chat_facts_alone(mem, tmp_path):
    mem.remember("about_you", "Works at Initech")
    text = await write_portrait(FakeModel(final("Works at Initech.")), budget(tmp_path), mem)
    assert text == "Works at Initech."


def test_portrait_prompt_says_chat_wins_over_source_facts():
    from brain.know.extract import prompt

    p = prompt("know_portrait.md").lower()
    assert "told scout" in p and "wins" in p
