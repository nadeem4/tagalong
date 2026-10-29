"""ScoutQuestions: an expert's question is offered to Scout first; Scout answers or passes.
The emit callable is a fake that records the event and its hooks, so no scheduler runs here.
"""

import asyncio

from brain.experts import Question, QuestionField
from brain.questions import ScoutQuestions


class _Emit:
    def __init__(self):
        self.calls = []

    def __call__(self, event, *, on_start=None, on_drop=None, on_end=None):
        self.calls.append((event, on_drop, on_end))

    def id(self, n=-1):
        return self.calls[n][0].facts["question"]


def _q(*fields):
    return Question("Which way?", list(fields) or [QuestionField("way", "Way", ["a", "b"])])


async def _ask(sq, emit, question=None, job="j1"):
    task = asyncio.ensure_future(sq.ask(job, question or _q()))
    await asyncio.sleep(0)
    return task


async def test_ask_emits_a_job_question_event_with_the_facts():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    field = QuestionField("way", "Way", ["a", "b"], "Pick one", multi=True)
    task = await _ask(sq, emit, _q(field))
    event = emit.calls[0][0]
    assert event.kind == "job_question" and event.key is None
    assert len(event.facts["question"]) == 8
    assert event.facts["job"] == "j1"
    assert event.facts["message"] == "Which way?"
    assert event.facts["fields"] == "way | Way | Pick one | options a/b | multi"
    sq.pass_to_user(event.facts["question"])
    await task


async def test_answer_with_an_option_resolves_ask_with_the_pick():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    task = await _ask(sq, emit)
    assert sq.answer(emit.id(), {"way": "a"}) == "answered"
    assert await task == {"way": "a"}


async def test_answer_with_other_text_uses_the_custom_key():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    task = await _ask(sq, emit)
    sq.answer(emit.id(), {"way": "something else"})
    assert await task == {"way_custom": "something else"}


async def test_multi_field_takes_a_list():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    task = await _ask(sq, emit, _q(QuestionField("ways", "Ways", ["a", "b"], multi=True)))
    sq.answer(emit.id(), {"ways": ["a", "b"]})
    assert await task == {"ways": ["a", "b"]}


async def test_multi_field_with_a_single_option_string_is_a_one_item_list():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    task = await _ask(sq, emit, _q(QuestionField("ways", "Ways", ["a", "b"], multi=True)))
    sq.answer(emit.id(), {"ways": "a"})
    assert await task == {"ways": ["a"]}


async def test_answer_missing_a_field_is_refused_and_leaves_the_question_open():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    task = await _ask(sq, emit, _q(QuestionField("x", "X", ["a"]), QuestionField("y", "Y", ["b"])))
    out = sq.answer(emit.id(), {"x": "a"})
    assert "y" in out and "x" not in out.replace("missing", "")
    assert not task.done()
    assert sq.answer(emit.id(), {"x": "a", "y": "b"}) == "answered"
    assert await task == {"x": "a", "y": "b"}


async def test_answer_unknown_id_is_refused():
    sq = ScoutQuestions(_Emit())
    assert sq.answer("nope", {}) == "no open question nope."


async def test_answer_twice_the_second_is_refused():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    task = await _ask(sq, emit)
    qid = emit.id()
    sq.answer(qid, {"way": "a"})
    await task
    assert sq.answer(qid, {"way": "b"}) == f"no open question {qid}."


async def test_pass_resolves_none():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    task = await _ask(sq, emit)
    assert sq.pass_to_user(emit.id()) == "passed to the owner"
    assert await task is None


async def test_pass_unknown_id_is_refused():
    assert ScoutQuestions(_Emit()).pass_to_user("zz") == "no open question zz."


async def test_on_end_without_an_answer_resolves_none():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    task = await _ask(sq, emit)
    emit.calls[0][2]()
    assert await task is None


async def test_on_end_after_an_answer_is_harmless():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    task = await _ask(sq, emit)
    sq.answer(emit.id(), {"way": "a"})
    emit.calls[0][2]()
    assert await task == {"way": "a"}


async def test_on_drop_resolves_none():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    task = await _ask(sq, emit)
    emit.calls[0][1]()
    assert await task is None


async def test_cancel_job_resolves_only_that_jobs_questions():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    t1 = await _ask(sq, emit, job="j1")
    t2 = await _ask(sq, emit, job="j2")
    sq.cancel_job("j1")
    assert await t1 is None
    assert not t2.done()
    sq.answer(emit.id(1), {"way": "a"})
    assert await t2 == {"way": "a"}


async def test_two_jobs_ask_at_once_get_different_ids():
    emit = _Emit()
    sq = ScoutQuestions(emit)
    t1 = await _ask(sq, emit, job="j1")
    t2 = await _ask(sq, emit, job="j2")
    assert emit.id(0) != emit.id(1)
    sq.pass_to_user(emit.id(0))
    sq.pass_to_user(emit.id(1))
    await asyncio.gather(t1, t2)
