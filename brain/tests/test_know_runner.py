"""The get-to-know-me run: sources one at a time, each saved as it finishes, the budget and
failures handled per source, and nothing forgotten coming back. Fakes only, a real Memory."""

import json
import logging

import pytest
from know_fakes import FakeModel, FakeSource, budget, final

from brain.know.facts import Known, Material
from brain.know.runner import KnowMeRunner
from brain.memory import Memory


class Sent:
    def __init__(self):
        self.frames = []

    def __call__(self, body_id, params):
        self.frames.append((body_id, params))


class Seeing(FakeSource):
    """A source that records what it was given."""

    def __init__(self, name, materials=None, needs="none"):
        super().__init__(name, materials)
        self.needs = needs
        self.seen = []

    async def read(self, given, known):
        self.seen.append((given, known))
        return await super().read(given, known)


class Exploding(FakeSource):
    async def read(self, given, known):
        raise RuntimeError("boom")


def reply(*facts, name=None, employer=None):
    body = {
        "facts": [{"tag": t, "text": text, "evidence": ev, "ref": "r"} for t, text, ev in facts],
        "name": name,
        "employer": employer,
    }
    return final(json.dumps(body))


def material(text="Alice builds compilers at Acme.", keys=None):
    return Material(text, "ref", keys=keys or Known())


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


def run(sources, mem, model, tmp_path, limit=1.0, github="octocat", pdf=None):
    sent = Sent()
    runner = KnowMeRunner(sources, mem, model, budget(tmp_path, limit), sent)
    runner.start("desktop", github, pdf)
    return runner, sent


def by_source(mem):
    out = {}
    for i in mem.profile_facts():
        out.setdefault(i.source, []).append(i.text)
    return out


async def test_run_saves_each_source_as_it_finishes(mem, tmp_path):
    ok = Seeing("one", [material()])
    model = FakeModel(reply(("work", "Builds compilers", "builds compilers")), final("Portrait."))
    runner, _ = run([ok, Exploding("two")], mem, model, tmp_path)
    await runner._task
    assert by_source(mem) == {"one": ["Builds compilers"]}
    one, two = runner.status().sources[:2]
    assert one.state == "done"
    assert (two.state, two.gap) == ("failed", "Something went wrong reading Two.")


async def test_run_marks_gap_from_source(mem, tmp_path):
    runner, sent = run([FakeSource("one", gap="No GitHub user 'x'.")], mem, FakeModel(), tmp_path)
    await runner._task
    src = runner.status().sources[0]
    assert (src.state, src.gap) == ("failed", "No GitHub user 'x'.")
    assert sent.frames[-1][1]["sources"][0] == {
        "name": "one",
        "state": "failed",
        "gap": "No GitHub user 'x'.",
    }


async def test_run_drops_facts_without_evidence(mem, tmp_path):
    model = FakeModel(
        reply(("work", "Invented", "never in the text"), ("work", "Real", "builds compilers")),
        final("Portrait."),
    )
    runner, _ = run([Seeing("one", [material()])], mem, model, tmp_path)
    await runner._task
    assert by_source(mem) == {"one": ["Real"]}


async def test_rerun_replaces_same_source_facts(mem, tmp_path):
    mem.remember("about_you", "Likes tea")
    model = FakeModel(
        reply(("work", "First", "builds compilers")),
        final("One."),
        reply(("work", "Second", "builds compilers")),
        final("Two."),
    )
    runner, _ = run([Seeing("one", [material()])], mem, model, tmp_path)
    await runner._task
    runner.start("desktop", "octocat", None)
    await runner._task
    assert by_source(mem) == {"one": ["Second"]}
    assert [i.text for i in mem.list_items(10) if i.kind == "about_you"] == ["Likes tea"]


async def test_rerun_skips_dismissed(mem, tmp_path):
    again = reply(("work", "Builds compilers", "builds compilers"))
    model = FakeModel(again, final("Portrait."), again)
    runner, _ = run([Seeing("one", [material()])], mem, model, tmp_path)
    await runner._task
    mem.forget(mem.profile_facts()[0].id)
    runner.start("desktop", "octocat", None)
    await runner._task
    assert mem.profile_facts() == []


async def test_run_stops_at_budget_and_keeps_finished(mem, tmp_path):
    sources = [Seeing(n, [material()]) for n in ("one", "two", "three")]
    model = FakeModel(reply(("work", "Builds compilers", "builds compilers")))
    b = budget(tmp_path, 1.0)
    real_spend = b.spend

    def spend(usage, model_id):  # the day is used up right after the first model call
        real_spend(usage, model_id)
        b.limit = 0.0

    b.spend = spend
    runner = KnowMeRunner(sources, mem, model, b, Sent())
    runner.start("desktop", "octocat", None)
    await runner._task
    assert by_source(mem) == {"one": ["Builds compilers"]}
    got = [(s.name, s.state, s.gap) for s in runner.status().sources]
    assert got[0] == ("one", "done", None)
    assert got[1:3] == [
        ("two", "failed", "Stopped: daily limit reached"),
        ("three", "failed", "Stopped: daily limit reached"),
    ]
    assert runner.status().done is True


async def test_run_masks_saved_facts(tmp_path):
    mem = Memory(tmp_path / "m.db", mask=lambda t: t.replace("sk-abc123", "[secret]"))
    text = "Alice uses key sk-abc123 daily."
    model = FakeModel(reply(("work", "Uses key sk-abc123", "key sk-abc123")), final("Portrait."))
    runner, _ = run([Seeing("one", [material(text)])], mem, model, tmp_path)
    await runner._task
    item = mem.profile_facts()[0]
    assert "sk-abc123" not in item.text and "sk-abc123" not in (item.evidence or "")
    mem.close()


async def test_web_receives_known_keys_from_github(mem, tmp_path):
    keys = Known(handle="octocat", urls=("https://x.dev",), name="Alice", employer=None)
    gh = Seeing("github", [material(keys=keys)], needs="username")
    web = Seeing("web", [material()])
    model = FakeModel(
        reply(("work", "A", "builds compilers"), name="Alice", employer="Acme"),
        reply(("work", "B", "builds compilers")),
        final("Portrait."),
    )
    runner, _ = run([gh, web], mem, model, tmp_path)
    await runner._task
    known = web.seen[0][1]
    assert known.handle == "octocat" and known.urls == ("https://x.dev",)
    assert known.name == "Alice" and known.employer == "Acme"  # employer from the extraction


async def test_source_not_given_is_not_read(mem, tmp_path):
    gh = Seeing("github", needs="username")
    pdf = Seeing("linkedin", [material()], needs="file")
    model = FakeModel(reply(("work", "A", "builds compilers")), final("Portrait."))
    runner, _ = run([gh, pdf], mem, model, tmp_path, github=None, pdf=b"%PDF")
    await runner._task
    assert gh.seen == []
    assert (runner.status().sources[0].state, runner.status().sources[0].gap) == ("done", None)
    assert pdf.seen[0][0] == b"%PDF"


async def test_status_progress_published_in_order(mem, tmp_path):
    model = FakeModel(reply(("work", "A", "builds compilers")), final("Portrait."))
    runner, sent = run([Seeing("one", [material()])], mem, model, tmp_path)
    await runner._task
    states = [f[1]["sources"][0]["state"] for f in sent.frames]
    seq = [s for i, s in enumerate(states) if i == 0 or s != states[i - 1]]
    assert seq == ["waiting", "reading", "done"]


async def test_unexpected_failure_is_logged_and_ends_the_run(mem, tmp_path, caplog):
    sent = Sent()
    runner = KnowMeRunner([Seeing("one", [material()])], mem, FakeModel(), budget(tmp_path), sent)

    async def boom(*args):
        raise RuntimeError("bug")

    runner._work = boom
    with caplog.at_level(logging.ERROR):
        runner.start("desktop", "octocat", None)
        await runner._task
    assert "know-me run failed" in caplog.text
    last = sent.frames[-1][1]
    assert last["done"] is True
    assert last["sources"][0]["state"] == "failed"


async def test_no_key_says_so_not_daily_limit(mem, tmp_path):
    sources = [Seeing("one", [material()]), Seeing("two", [material()])]
    runner, _ = run(sources, mem, FakeModel(ready=False), tmp_path)
    await runner._task
    gaps = [s.gap for s in runner.status().sources]
    assert gaps == ["Add your Anthropic key first."] * 3  # both sources and the portrait row


async def test_crash_before_portrait_leaves_portrait_row_failed(mem, tmp_path):
    runner, sent = run([Seeing("one")], mem, FakeModel(), tmp_path)

    async def boom(*args):
        raise RuntimeError("bug")

    runner._work = boom
    await runner._task
    assert sent.frames[-1][1]["sources"][-1]["state"] == "failed"


async def test_later_source_is_told_earlier_facts(mem, tmp_path):
    model = FakeModel(
        reply(("work", "Builds compilers", "builds compilers")),
        reply(),
        final("Portrait."),
    )
    sources = [Seeing("one", [material()]), Seeing("two", [material()])]
    runner, _ = run(sources, mem, model, tmp_path)
    await runner._task
    second = model.calls[1][1][0]["content"][-1]["text"]
    assert "Builds compilers" in second


async def test_run_saves_category_and_span(mem, tmp_path):
    fact = {
        "tag": "work",
        "text": "Builds compilers",
        "evidence": "Alice builds compilers since 2019",
        "ref": "r",
        "category": "Craft",
        "start": "2019",
        "end": "now",
    }
    model = FakeModel(final(json.dumps({"facts": [fact]})), final("Portrait."))
    src = Seeing("one", [material("Alice builds compilers since 2019")])
    runner, _ = run([src], mem, model, tmp_path)
    await runner._task
    item = mem.profile_facts()[0]
    assert (item.category, item.span_start, item.span_end) == ("Craft", "2019", None)
