"""ScoutQuestions: an expert's question is offered to Scout first; Scout answers or passes.
The emit callable is a fake that records the event and its hooks, so no dispatcher runs here.
"""

import asyncio

import pytest
from job_rows import fresh_work

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
    sq = ScoutQuestions(emit, fresh_work())
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
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit)
    assert sq.answer(emit.id(), {"way": "a"}) == "answered"
    assert await task == {"way": "a"}


async def test_answer_with_other_text_uses_the_custom_key():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit)
    sq.answer(emit.id(), {"way": "something else"})
    assert await task == {"way_custom": "something else"}


async def test_multi_field_takes_a_list():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit, _q(QuestionField("ways", "Ways", ["a", "b"], multi=True)))
    sq.answer(emit.id(), {"ways": ["a", "b"]})
    assert await task == {"ways": ["a", "b"]}


async def test_multi_field_with_a_single_option_string_is_a_one_item_list():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit, _q(QuestionField("ways", "Ways", ["a", "b"], multi=True)))
    sq.answer(emit.id(), {"ways": "a"})
    assert await task == {"ways": ["a"]}


async def test_answer_missing_a_field_is_refused_and_leaves_the_question_open():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit, _q(QuestionField("x", "X", ["a"]), QuestionField("y", "Y", ["b"])))
    out = sq.answer(emit.id(), {"x": "a"})
    assert "y" in out and "x" not in out.replace("missing", "")
    assert not task.done()
    assert sq.answer(emit.id(), {"x": "a", "y": "b"}) == "answered"
    assert await task == {"x": "a", "y": "b"}


async def test_answer_unknown_id_is_refused():
    sq = ScoutQuestions(_Emit(), fresh_work())
    assert sq.answer("nope", {}) == "no open question nope."


async def test_answer_twice_the_second_is_refused():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit)
    qid = emit.id()
    sq.answer(qid, {"way": "a"})
    await task
    assert sq.answer(qid, {"way": "b"}) == f"no open question {qid}."


async def test_pass_then_answer_the_answer_is_refused():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit)
    qid = emit.id()
    assert sq.pass_to_user(qid) == "passed to the owner"
    assert sq.answer(qid, {"way": "a"}) == f"no open question {qid}."
    assert sq.pass_to_user(qid) == f"no open question {qid}."
    assert await task is None


async def test_cancel_job_then_answer_is_refused():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit)
    qid = emit.id()
    sq.cancel_job("j1")
    assert sq.answer(qid, {"way": "a"}) == f"no open question {qid}."
    assert await task is None


async def test_emit_failure_does_not_leak_the_open_question():
    def boom(*args, **kwargs):
        raise RuntimeError("emit failed")

    sq = ScoutQuestions(boom, fresh_work())
    with pytest.raises(RuntimeError):
        await sq.ask("j1", _q())
    assert sq._open == {}


async def test_pass_resolves_none():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit)
    assert sq.pass_to_user(emit.id()) == "passed to the owner"
    assert await task is None


async def test_pass_unknown_id_is_refused():
    assert ScoutQuestions(_Emit(), fresh_work()).pass_to_user("zz") == "no open question zz."


async def test_on_end_without_an_answer_resolves_none():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit)
    emit.calls[0][2]("done")
    assert await task is None


async def test_on_end_after_an_answer_is_harmless():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit)
    sq.answer(emit.id(), {"way": "a"})
    emit.calls[0][2]("done")
    assert await task == {"way": "a"}


async def test_on_drop_resolves_none():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    task = await _ask(sq, emit)
    emit.calls[0][1]()
    assert await task is None


async def test_cancel_job_resolves_only_that_jobs_questions():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    t1 = await _ask(sq, emit, job="j1")
    t2 = await _ask(sq, emit, job="j2")
    sq.cancel_job("j1")
    assert await t1 is None
    assert not t2.done()
    sq.answer(emit.id(1), {"way": "a"})
    assert await t2 == {"way": "a"}


async def test_two_jobs_ask_at_once_get_different_ids():
    emit = _Emit()
    sq = ScoutQuestions(emit, fresh_work())
    t1 = await _ask(sq, emit, job="j1")
    t2 = await _ask(sq, emit, job="j2")
    assert emit.id(0) != emit.id(1)
    sq.pass_to_user(emit.id(0))
    sq.pass_to_user(emit.id(1))
    await asyncio.gather(t1, t2)


# --- the question is a work row, a child of its job ---------------------------


def _rig():
    work = fresh_work()
    work.create("goal", "a job", id="j1", state="active")
    emit = _Emit()
    return work, emit, ScoutQuestions(emit, work)


async def test_question_row_lifecycle():
    work, emit, sq = _rig()
    task = await _ask(sq, emit)
    row = work.get(emit.id())
    assert (row.kind, row.state, row.parent_id, row.title) == (
        "question",
        "active",
        "j1",
        "Which way?",
    )
    sq.answer(emit.id(), {"way": "a"})
    assert await task == {"way": "a"}
    row = work.get(emit.id())
    assert (row.state, row.end_reason, row.summary) == ("done", "answered", '{"way": "a"}')
    assert row.reported_at is not None


async def test_passed_question_ends_with_an_event():
    work, emit, sq = _rig()
    task = await _ask(sq, emit)
    sq.pass_to_user(emit.id())
    assert await task is None
    row = work.get(emit.id())
    assert (row.state, row.end_reason) == ("done", "passed to the owner")
    assert "passed" in [e.kind for e in work.events(emit.id())]


async def test_dropped_wake_and_cancelled_job_expire_the_question():
    work, emit, sq = _rig()
    task = await _ask(sq, emit)
    emit.calls[0][1]()  # on_drop
    assert await task is None
    assert work.get(emit.id()).state == "expired"
    task = await _ask(sq, emit)
    sq.cancel_job("j1")
    assert await task is None
    assert (work.get(emit.id()).state, work.get(emit.id()).end_reason) == ("expired", "job ended")


async def test_goal_close_expires_the_question_and_resolves_the_waiter():
    work, emit, sq = _rig()
    task = await _ask(sq, emit)
    work.close_goal("j1", "done", "finished")
    assert await task is None
    assert work.get(emit.id()).state == "expired"
    assert sq.answer(emit.id(), {"way": "a"}) == f"no open question {emit.id()}."


async def test_question_of_a_missing_job_is_a_root():
    work, emit, sq = _rig()
    task = await _ask(sq, emit, job="nope")
    assert work.get(emit.id()).parent_id is None
    sq.pass_to_user(emit.id())
    await task
