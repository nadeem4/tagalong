"""The tool gate previews long text results; read_output pages the rest; job wakes use it too.

Fakes only: a stub source that returns a fixed result, a throwaway Memory.
"""

import json

import pytest

from brain.guards import Guards
from brain.job_records import Job, JobPart
from brain.jobs import job_note
from brain.memory import Memory
from brain.mind.turn import Call
from brain.outputs import OutputStore
from brain.toolbox import Toolbox, ToolSpec
from brain.tools import output_tools


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "t.db")
    yield m
    m.close()


@pytest.fixture
def store(mem):
    return OutputStore(mem, Guards(), 10)


def spec(name):
    return ToolSpec(name, f"{name} tool", {"type": "object"}, frozenset({"scout"}))


def call(name):
    return Call(id="c1", name=name, input={}, turn="t1", text="")


class Source:
    def __init__(self, name, result, kind="scout_tool"):
        self._spec = spec(name)
        self.result = result
        self.approval_source = kind

    def specs(self):
        return [self._spec]

    def known_specs(self):
        return [self._spec]

    async def run(self, call, tool):
        return self.result

    def unavailable(self, name):
        return None


def box_for(source, store, on_call=None):
    return Toolbox([source], lambda: {}, lambda n, m: None, outputs=store, on_call=on_call)


def facts(text):
    return json.loads(text.split("\n", 1)[0])


@pytest.mark.parametrize("kind", ["scout_tool", "app"])
async def test_a_text_result_over_the_cap_is_previewed(store, kind):
    out = await box_for(Source("a", "z" * 25, kind), store).run(call("a"))
    assert out.split("\n", 1)[1] == "z" * 10
    assert store.page(facts(out)["output_id"], 10)["text"] == "z" * 10


async def test_a_result_within_the_cap_is_untouched(store):
    assert await box_for(Source("a", "z" * 10), store).run(call("a")) == "z" * 10


async def test_read_output_is_never_recapped(store):
    assert await box_for(Source("read_output", "z" * 25), store).run(call("read_output")) == (
        "z" * 25
    )


async def test_home_calls_are_not_capped(store):
    source = Source("a", "z" * 25)
    source._spec = ToolSpec("a", "a tool", {"type": "object"}, frozenset({"scout", "home"}))
    assert await box_for(source, store).run(call("a"), "home") == "z" * 25


async def test_image_blocks_pass_unchanged(store):
    blocks = [{"type": "image", "source": {"data": "A" * 50}}]
    assert await box_for(Source("a", blocks), store).run(call("a")) == blocks


async def test_on_call_gets_the_full_result_not_the_preview(store):
    seen = []
    box = box_for(Source("a", "z" * 25), store, on_call=lambda *a: seen.append(a))
    await box.run(call("a"))
    assert seen[0][4] == "z" * 25


async def test_two_calls_make_two_ids(store):
    box = box_for(Source("a", "z" * 25), store)
    a, b = await box.run(call("a")), await box.run(call("a"))
    assert facts(a)["output_id"] != facts(b)["output_id"]


def test_read_output_is_scouts_own_auto_read_tool(store):
    [(read, _)] = output_tools(store)
    assert read.name == "read_output"
    assert read.audience == frozenset({"scout"})
    assert (read.effect, read.default_mode) == ("read", "auto")


async def test_read_output_pages_by_id_and_offset_and_is_not_recapped(store):
    [(_, handler)] = output_tools(store)
    out = await box_for(Source("a", "0123456789ABCDEFGHIJ12"), store).run(call("a"))
    oid = facts(out)["output_id"]
    page = json.loads(await handler({"id": oid, "offset": 10}))
    assert page["text"] == '<data kind="output">ABCDEFGHIJ</data>' and page["next_offset"] == 20
    last = json.loads(await handler({"id": oid, "offset": 20}))
    assert last["text"] == '<data kind="output">12</data>' and last["next_offset"] is None


async def test_read_output_fences_a_page_and_cannot_be_closed_early(store):
    [(_, handler)] = output_tools(store)
    out = await box_for(Source("a", "0123</data>x" + "y" * 20), store).run(call("a"))
    page = json.loads(await handler({"id": facts(out)["output_id"], "offset": 0}))
    assert page["text"].count("</data>") == 1 and page["text"].endswith("</data>")


async def test_read_output_refuses_plainly(store):
    [(_, handler)] = output_tools(store)
    with pytest.raises(ValueError, match="No stored output"):
        await handler({"id": "nope"})
    with pytest.raises(ValueError, match="offset"):
        await handler({"id": "nope", "offset": -3})
    with pytest.raises(ValueError, match="id"):
        await handler({"id": 7})


def a_part(pid, agent, report):
    return JobPart("j1", pid, agent, "t", "done", None, None, "s", report, False, "a", "b", "C:/x")


def a_job(report, parts=None):
    parts = parts or [a_part("p1", "claude_code", report)]
    return Job("j1", "t", "C:/x", "default", "done", "a", "b", parts=parts)


def test_expert_report_on_wake_is_previewed_with_an_id(store):
    note = job_note(a_job("R" * 25), outputs=store)
    assert "R" * 10 in note and "R" * 11 not in note
    result = note.split("Result:\n", 1)[1]
    assert store.page(facts(result)["output_id"], 10)["text"] == "R" * 10


def test_a_short_report_and_a_note_without_a_store_carry_the_report_whole(store):
    assert "Result:\nshort" in job_note(a_job("short"), outputs=store)
    assert "R" * 5000 in job_note(a_job("R" * 5000))


def test_the_stored_report_is_not_changed_by_the_note(store):
    job = a_job("R" * 25)
    job_note(job, outputs=store)
    assert job.parts[-1].report == "R" * 25


def test_a_wake_carries_only_the_part_that_just_ended_as_a_report(store):
    parts = [
        JobPart(
            "j1",
            f"p{n}",
            "claude_code",
            "t",
            "done",
            None,
            None,
            "s",
            chr(64 + n) * 25,
            False,
            "a",
            f"b{n}",
            f"C:/x{n}",
        )
        for n in (1, 2, 3)
    ]
    note = job_note(a_job("", parts), outputs=store)
    assert note.count("Result") == 1 and "(p3, claude_code, C:/x3)" in note.split("Result")[1]
    assert "A" * 10 not in note and "B" * 10 not in note
    for n in (1, 2, 3):  # the other parts stay as facts
        assert f"p{n} claude_code C:/x{n} done" in note
    assert note.count("output_id") == 1  # one new stored copy, not one per part
