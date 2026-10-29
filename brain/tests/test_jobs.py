"""Checks Jobs (hand-off ask, relayed asks, limits) through the real ExpertRun on the fake agent.

Asks and notify are fakes: the ask transport has its own tests, and here only what Jobs
opens and how it maps the answers matters. No Node, no Claude Code, no network.
"""

import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

from brain.approvals import Approvals
from brain.asks import Answer
from brain.experts import ExpertRun, Question, QuestionField
from brain.jobs import JobError, Jobs, job_note
from brain.memory import Job, Memory
from brain.protocol import ErrorCode, RpcError

AGENT = Path(__file__).parent / "fake_acp_agent.py"
HANG = [{"text": "working"}, {"hang": True}]


class FakeAsks:
    """open() pops the next scripted answer; None in the script blocks until cancelled."""

    def __init__(self, *answers) -> None:
        self.script = list(answers)
        self.opened: list[dict] = []
        self.open_ids: set[str] = set()
        self.closed_by_cancel: list[str] = []
        self.cancel_all_calls: list[list[str]] = []
        self.online = True

    def anyone_online(self) -> bool:
        return self.online

    async def open(self, **kw):
        self.opened.append(kw)
        ask_id = kw["ask_id"]
        self.open_ids.add(ask_id)
        try:
            answer = self.script.pop(0) if self.script else None
            if answer is None:
                await asyncio.Event().wait()
            if isinstance(answer, Exception):
                raise answer
            return answer
        except asyncio.CancelledError:
            self.closed_by_cancel.append(ask_id)
            raise
        finally:
            self.open_ids.discard(ask_id)

    def cancel_all(self, ask_ids) -> None:
        self.cancel_all_calls.append(list(ask_ids))


class FakeScout:
    """Stands in for ScoutQuestions: ask() returns the scripted value."""

    def __init__(self, result=None) -> None:
        self.result = result
        self.asked: list[tuple] = []
        self.cancelled: list[str] = []
        self.before_return = lambda: None

    async def ask(self, job_id, question):
        self.asked.append((job_id, question))
        self.before_return()
        return self.result

    def cancel_job(self, job_id) -> None:
        self.cancelled.append(job_id)


class Rig:
    def __init__(
        self,
        tmp_path,
        monkeypatch,
        asks,
        steps,
        max_running=2,
        scout=None,
        approvals=False,
        side_check=None,
    ) -> None:
        script = tmp_path / "script.json"
        script.write_text(json.dumps(steps))
        monkeypatch.setenv("FAKE_ACP_SCRIPT", str(script))
        monkeypatch.setenv("FAKE_ACP_LOG", str(tmp_path / "log.jsonl"))
        self.log = tmp_path / "log.jsonl"
        self.folder = tmp_path / "proj"
        self.folder.mkdir()
        self.memory = Memory(tmp_path / "t.db")
        self.asks = asks
        self.notes: list[tuple] = []
        self.runs: list[ExpertRun] = []
        self.finished: list = []
        self.now = 0.0
        self.approvals = (
            Approvals(self.memory, lambda m, p: None, lambda: datetime(2026, 1, 1, tzinfo=UTC))
            if approvals
            else None
        )
        self.jobs = Jobs(
            self.memory,
            asks,
            lambda method, params: self.notes.append((method, params)),
            self.make_run,
            max_running=max_running,
            on_finished=self.finished.append,
            clock=lambda: self.now,
            scout_questions=scout,
            approvals=self.approvals,
            side_check=side_check,
        )

    def make_run(self, **callbacks) -> ExpertRun:
        run = ExpertRun(command=[sys.executable, str(AGENT)], timeout=30, grace=2, **callbacks)
        self.runs.append(run)
        return run

    def changed(self) -> int:
        return sum(1 for n in self.notes if n == ("changed", {"what": "jobs"}))

    def frames(self) -> list[dict]:
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    async def teardown(self) -> None:
        for job_id in list(self.jobs._runs):
            await self.jobs.stop(job_id)
        for run in self.runs:
            await run.close()
        self.memory.close()


@pytest.fixture
async def make_rig(tmp_path, monkeypatch):
    rigs: list[Rig] = []

    def make(asks, steps=HANG, **kw) -> Rig:
        rigs.append(Rig(tmp_path, monkeypatch, asks, steps, **kw))
        return rigs[-1]

    yield make
    for rig in rigs:  # nothing may outlive the test
        await rig.teardown()


async def until(condition, timeout: float = 10) -> None:
    async def poll() -> None:
        while not condition():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(poll(), timeout)


def alive(run: ExpertRun) -> bool:
    return run.process is not None and run.process.returncode is None


async def test_bad_folders_give_a_plain_message_and_start_nothing(make_rig, tmp_path):
    rig = make_rig(FakeAsks())
    a_file = tmp_path / "file.txt"
    a_file.write_text("x")
    for bad in ("relative/dir", str(tmp_path / "missing"), str(a_file)):
        with pytest.raises(JobError, match="no folder at"):
            await rig.jobs.start("task", bad)
    assert rig.runs == [] and rig.asks.opened == []


async def test_handoff_ask_shows_task_folder_and_mode_names_then_cancel(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")))
    job_id = await rig.jobs.start("fix the bug", str(rig.folder))
    ask = rig.asks.opened[0]
    assert ask["text"] == "fix the bug"
    assert ask["input"] == {"folder": str(rig.folder)}
    assert ask["options"] == [
        "Manual",
        "Accept edits",
        "Plan",
        "Auto",
        "Bypass permissions",
        "cancel",
    ]
    job = rig.memory.get_job(job_id)
    assert (job.state, job.mode, job.task, job.folder) == (
        "running",
        "plan",
        "fix the bug",
        str(rig.folder),
    )
    assert rig.changed() == 1
    await until(lambda: any(f.get("method") == "session/prompt" for f in rig.frames()))
    sent = rig.frames()
    assert (
        next(f for f in sent if f.get("method") == "session/set_mode")["params"]["modeId"] == "plan"
    )


@pytest.mark.parametrize(
    "answer", [Answer("cancel"), Answer(None), RpcError(ErrorCode.timeout, "nobody answered")]
)
async def test_cancel_nobody_or_timeout_at_the_mode_ask_starts_nothing(make_rig, answer):
    rig = make_rig(FakeAsks(answer))
    with pytest.raises(JobError, match="not started"):
        await rig.jobs.start("task", str(rig.folder))
    assert rig.memory.list_jobs() == [] and rig.changed() == 0
    assert len(rig.runs) == 1
    await until(lambda: not alive(rig.runs[0]))  # the adapter process did not linger


async def test_third_running_job_is_refused_naming_the_running_ones(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")))
    first = await rig.jobs.start("one", str(rig.folder))
    second = await rig.jobs.start("two", str(rig.folder))
    with pytest.raises(JobError) as refused:
        await rig.jobs.start("three", str(rig.folder))
    assert first in str(refused.value) and second in str(refused.value)
    assert len(rig.runs) == 2 and len(rig.asks.opened) == 2


async def test_relayed_permission_shows_claude_code_tool_and_the_pick_maps_to_its_id(make_rig):
    steps = [{"permission": {"title": "ls -la", "kind": "execute", "input": {"command": "ls"}}}]
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Yes")), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    ask = rig.asks.opened[1]
    assert ask["tool"] == "claude_code:ls -la"
    assert ask["input"] == {"command": "ls"}
    assert ask["text"] == "" and ask["options"] == ["Yes", "No"]
    assert "confirm" not in ask and not ask.get("timeout")
    reply = next(f for f in rig.frames() if "outcome" in f.get("result", {}))
    assert reply["result"]["outcome"] == {"outcome": "selected", "optionId": "allow-once"}
    assert rig.changed() >= 3  # started, answered, finished


async def test_begin_failure_ends_the_row_as_error_kills_the_adapter_and_frees_the_slot(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan"), Answer("Plan")), max_running=1)
    original = rig.make_run

    def failing(**callbacks):
        run = original(**callbacks)

        async def boom(mode_id, task):
            raise ConnectionError("connection lost")

        run.begin = boom
        return run

    rig.jobs._make_run = failing
    with pytest.raises(JobError, match="connection lost"):
        await rig.jobs.start("go", str(rig.folder))
    (job,) = rig.memory.list_jobs()
    assert (job.state, job.reason) == ("error", "connection lost") and job.ended_at
    assert rig.memory.running_jobs() == [] and rig.jobs._runs == {}
    assert rig.changed() == 2
    await until(lambda: not alive(rig.runs[0]))
    rig.jobs._make_run = original
    await rig.jobs.start("again", str(rig.folder))  # the cap of one is free again


async def test_start_failure_from_the_adapter_is_a_plain_message(make_rig):
    rig = make_rig(FakeAsks())
    original = rig.make_run

    def failing(**callbacks):
        run = original(**callbacks)

        async def refuse(folder):
            raise RuntimeError("auth required")

        run.start = refuse
        return run

    rig.jobs._make_run = failing
    with pytest.raises(JobError, match="auth required") as raised:
        await rig.jobs.start("go", str(rig.folder))
    assert isinstance(raised.value.__cause__, RuntimeError)
    assert rig.memory.list_jobs() == [] and rig.asks.opened == []


async def test_a_job_counts_once_so_a_second_hand_off_fits_under_the_cap(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")))
    original = rig.make_run
    slow = []

    def make(**callbacks):
        run = original(**callbacks)
        if not slow:
            slow.append(run)
            real = run.begin

            async def slow_begin(mode_id, task):
                await asyncio.sleep(0.5)
                await real(mode_id, task)

            run.begin = slow_begin
        return run

    rig.jobs._make_run = make
    first = asyncio.create_task(rig.jobs.start("one", str(rig.folder)))
    await until(lambda: rig.memory.running_jobs())  # row exists, begin still pending
    second = await rig.jobs.start("two", str(rig.folder))
    assert second and await first


async def test_unanswered_permission_is_cancelled(make_rig):
    steps = [{"permission": {"title": "rm x"}}]
    rig = make_rig(FakeAsks(Answer("Plan"), Answer(None)), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    reply = next(f for f in rig.frames() if "outcome" in f.get("result", {}))
    assert reply["result"]["outcome"] == {"outcome": "cancelled"}


async def test_question_with_a_pick_and_with_typed_text(make_rig):
    steps = [{"question": {"message": "Which colour?", "options": ["Red", "Blue"]}}]
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Red")), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    ask = rig.asks.opened[1]
    assert (ask["text"], ask["options"], ask["free_text"]) == (
        "Which colour?",
        ["Red", "Blue"],
        True,
    )
    reply = next(f for f in rig.frames() if f.get("result", {}).get("action"))
    assert reply["result"]["content"] == {"question_0": "Red"}


async def test_typed_text_wins_over_the_option(make_rig):
    steps = [{"question": {"message": "Which colour?", "options": ["Red", "Blue"]}}]
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Red", "teal")), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    reply = next(f for f in rig.frames() if f.get("result", {}).get("action"))
    assert reply["result"]["content"] == {"question_0_custom": "teal"}


async def test_unanswered_question_cancels(make_rig):
    steps = [{"question": {"message": "?", "options": ["A"]}}]
    rig = make_rig(FakeAsks(Answer("Plan"), Answer(None)), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    reply = next(f for f in rig.frames() if f.get("result", {}).get("action"))
    assert reply["result"]["action"] == "cancel"


async def test_progress_is_saved_and_changed_is_throttled(make_rig):
    steps = [{"text": "a"}, {"text": "b"}, {"text": "c"}, {"end": "end_turn"}]
    rig = make_rig(FakeAsks(Answer("Plan")), steps)
    job_id = await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    assert rig.memory.get_job(job_id).progress == "abc"
    # started + first progress (the clock never moves, so no more) + finished
    assert rig.changed() == 3


async def test_progress_notifies_again_after_two_seconds(make_rig):
    steps = [{"text": "a"}, {"sleep": 0.3}, {"text": "b"}, {"end": "end_turn"}]
    rig = make_rig(FakeAsks(Answer("Plan")), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.changed() >= 2)  # first progress
    rig.now = 5.0
    await until(lambda: rig.finished)
    assert rig.changed() == 4  # started, "a", "b" after the clock moved, finished


async def test_end_writes_the_row_and_calls_on_finished(make_rig):
    steps = [{"text": "all done"}, {"end": "end_turn"}]
    rig = make_rig(FakeAsks(Answer("Plan")), steps)
    job_id = await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    job = rig.memory.get_job(job_id)
    assert (job.state, job.result) == ("done", "all done")
    assert job.ended_at
    assert rig.finished[0].id == job_id and rig.finished[0].state == "done"
    assert rig.changed() >= 2
    with pytest.raises(JobError, match="not running"):
        await rig.jobs.stop(job_id)


async def test_a_crashed_run_ends_as_error(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), [{"crash": 3}])
    job_id = await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    assert rig.memory.get_job(job_id).state == "error"


async def test_tell_queues_a_note_for_a_running_job_only(make_rig):
    steps = [[{"text": "first"}, {"sleep": 0.5}], [{"text": "second"}]]
    rig = make_rig(FakeAsks(Answer("Plan")), steps)
    job_id = await rig.jobs.start("go", str(rig.folder))
    rig.jobs.tell(job_id, "also do X")
    await until(lambda: rig.finished)
    prompts = [
        f["params"]["prompt"][0]["text"]
        for f in rig.frames()
        if f.get("method") == "session/prompt"
    ]
    assert prompts == ["go", "also do X"]
    with pytest.raises(JobError, match="not running"):
        rig.jobs.tell(job_id, "late")
    with pytest.raises(JobError, match="no job"):
        rig.jobs.tell("nope", "x")


async def test_stop_closes_open_asks_and_marks_stopped(make_rig):
    steps = [{"question": {"message": "?", "options": ["A"]}}]
    rig = make_rig(FakeAsks(Answer("Plan"), None), steps)
    job_id = await rig.jobs.start("go", str(rig.folder))
    await until(lambda: len(rig.asks.opened) == 2 and rig.asks.open_ids)
    open_id = rig.asks.opened[1]["ask_id"]
    before = rig.changed()
    await rig.jobs.stop(job_id)
    job = rig.memory.get_job(job_id)
    assert job.state == "stopped" and job.ended_at
    assert open_id in rig.asks.closed_by_cancel or [open_id] in rig.asks.cancel_all_calls
    assert rig.changed() > before
    assert rig.finished[0].state == "stopped"
    with pytest.raises(JobError, match="not running"):
        await rig.jobs.stop(job_id)
    with pytest.raises(JobError, match="no job"):
        await rig.jobs.stop("nope")


async def test_list_returns_the_last_twenty_newest_first_with_progress(make_rig):
    rig = make_rig(FakeAsks())
    for i in range(22):
        rig.memory.add_job(f"j{i}", "claude_code", f"t{i}", str(rig.folder), "plan")
    rig.memory.update_job("j21", progress="latest words")
    listed = rig.jobs.list()
    assert len(listed) == 20 and listed[0].id == "j21" and listed[0].progress == "latest words"


async def test_shutdown_stops_every_running_job_and_leaves_no_process(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")))
    first = await rig.jobs.start("one", str(rig.folder))
    await rig.jobs.start("two", str(rig.folder))
    await rig.jobs.shutdown()
    assert rig.memory.running_jobs() == [] and rig.jobs._runs == {}
    assert rig.memory.get_job(first).state == "stopped"
    await until(lambda: not any(alive(r) for r in rig.runs))


async def test_shutdown_swallows_one_runs_failure_and_stops_the_rest(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")))
    await rig.jobs.start("one", str(rig.folder))
    await rig.jobs.start("two", str(rig.folder))

    async def boom():
        raise RuntimeError("stuck")

    rig.runs[0].stop = boom
    await rig.jobs.shutdown()
    assert not alive(rig.runs[1])
    del rig.runs[0].stop  # back to the real stop so the rig can clean the stuck one up


async def test_shutdown_leaves_the_report_for_the_next_start(make_rig):
    # A job stopped by shutdown must not wake a turn the exiting brain would drop.
    rig = make_rig(FakeAsks(Answer("Plan")))
    job_id = await rig.jobs.start("one", str(rig.folder))
    await rig.jobs.shutdown()
    assert rig.finished == []
    assert rig.memory.get_job(job_id).state == "stopped"
    assert not rig.memory.get_job(job_id).reported


async def test_cancelling_start_while_it_waits_on_the_mode_ask_cleans_up(make_rig):
    rig = make_rig(FakeAsks(), max_running=1)  # the mode ask blocks forever
    task = asyncio.create_task(rig.jobs.start("go", str(rig.folder)))
    await until(lambda: rig.asks.open_ids)
    ask_id = rig.asks.opened[0]["ask_id"]
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert ask_id in rig.asks.closed_by_cancel and not rig.asks.open_ids
    assert rig.jobs._starting == 0 and rig.memory.list_jobs() == []
    await until(lambda: not alive(rig.runs[0]))


async def test_startup_stops_leftover_running_rows(make_rig):
    rig = make_rig(FakeAsks())
    rig.memory.add_job("old", "claude_code", "t", str(rig.folder), "plan")
    rig.jobs.startup()
    job = rig.memory.get_job("old")
    assert (job.state, job.reason) == ("stopped", "brain restarted")


def test_job_note_states_facts_and_trims_a_long_result():
    job = Job(
        "j1",
        "claude_code",
        "fix it",
        "C:/x",
        "default",
        "done",
        "end_turn",
        None,
        "A" * 5000,
        "s1",
        False,
        "t0",
        "t1",
    )
    note = job_note(job)
    for fact in ("j1", "fix it", "C:/x", "done", "end_turn"):
        assert fact in note
    assert "A" * 4000 in note and "A" * 4001 not in note
    assert note.endswith("[trimmed]")


def test_job_note_without_a_result_or_reason():
    job = Job(
        "j2",
        "claude_code",
        "t",
        "C:/x",
        "default",
        "stopped",
        None,
        None,
        None,
        None,
        False,
        "t0",
        "t1",
    )
    note = job_note(job)
    assert "stopped" in note and "[trimmed]" not in note


# --- expert questions go to Scout first (10d) ---

ASK_COLOUR = [{"question": {"message": "Which colour?", "options": ["Red", "Blue"]}}]


def reply_of(rig):
    return next(f for f in rig.frames() if f.get("result", {}).get("action"))["result"]


async def test_scout_answer_goes_to_the_expert_and_no_user_ask_opens(make_rig):
    scout = FakeScout({"question_0": "Blue"})
    rig = make_rig(FakeAsks(Answer("Plan")), ASK_COLOUR, scout=scout)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    assert len(rig.asks.opened) == 1  # only the hand-off ask
    assert reply_of(rig)["content"] == {"question_0": "Blue"}
    assert scout.asked[0][1].message == "Which colour?"


async def test_scout_pass_opens_the_users_question_card_as_before(make_rig):
    scout = FakeScout(None)
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Red")), ASK_COLOUR, scout=scout)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    ask = rig.asks.opened[1]
    assert (ask["text"], ask["options"], ask["free_text"]) == (
        "Which colour?",
        ["Red", "Blue"],
        True,
    )
    assert "tool" not in ask
    assert reply_of(rig)["content"] == {"question_0": "Red"}


async def test_ask_with_nobody_online_skips_scout_and_cancels(make_rig):
    scout = FakeScout({"question_0": "Blue"})
    asks = FakeAsks(Answer("Plan"), Answer(None))
    rig = make_rig(asks, ASK_COLOUR, scout=scout)
    await rig.jobs.start("go", str(rig.folder))
    asks.online = False
    await until(lambda: rig.finished)
    assert scout.asked == []
    assert reply_of(rig)["action"] == "cancel"


@pytest.mark.parametrize("result", [None, {"question_0": "Blue"}])
async def test_job_stopped_while_scout_thinks_opens_no_ask(make_rig, result):
    scout = FakeScout(result)
    rig = make_rig(FakeAsks(), scout=scout)
    rig.jobs._runs["j1"] = object()  # a running job, stopped while Scout thinks
    scout.before_return = lambda: rig.jobs._runs.pop("j1")
    question = Question("Which?", [QuestionField("question_0", "Q", ["A"])])
    assert await rig.jobs._question("j1", question) is None
    assert scout.asked and rig.asks.opened == []


async def test_permission_asks_never_go_to_scout(make_rig):
    steps = [{"permission": {"title": "ls -la", "kind": "execute", "input": {"command": "ls"}}}]
    scout = FakeScout({"question_0": "Blue"})
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Yes")), steps, scout=scout)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    assert scout.asked == []
    assert rig.asks.opened[1]["tool"] == "claude_code:ls -la"


async def test_cancel_job_is_called_when_a_job_ends(make_rig):
    scout = FakeScout()
    steps = [{"text": "done"}, {"end": "end_turn"}]
    rig = make_rig(FakeAsks(Answer("Plan")), steps, scout=scout)
    job_id = await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    assert scout.cancelled == [job_id]


def with_approvals(make_rig, asks, steps, side_check=None):
    return make_rig(asks, steps, approvals=True, side_check=side_check)


def logged(rig):
    return rig.memory.list_approvals("all", 50, None)


OPTS = [
    {"id": "a1", "name": "Sure", "kind": "allow_once"},
    {"id": "a2", "name": "Whatever", "kind": "allow_always"},
    {"id": "r1", "name": "Nope", "kind": "reject_once"},
    {"id": "r2", "name": "Never", "kind": "reject_always"},
]


@pytest.mark.parametrize("pick", ["Sure", "Whatever"])
async def test_permission_allow_kinds_record_approved(make_rig, pick):
    steps = [{"permission": {"title": "ls -la", "input": {"command": "ls"}, "options": OPTS}}]
    rig = with_approvals(make_rig, FakeAsks(Answer("Plan"), Answer(pick)), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    (row,) = logged(rig)
    assert (row.outcome, row.decided_by, row.source) == ("approved", "person", "claude_code")
    assert row.tool == "claude_code:ls -la" and row.job_id == rig.finished[0].id


@pytest.mark.parametrize("pick", ["Nope", "Never"])
async def test_permission_reject_kinds_record_refused(make_rig, pick):
    steps = [{"permission": {"title": "rm x", "options": OPTS}}]
    rig = with_approvals(make_rig, FakeAsks(Answer("Plan"), Answer(pick)), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    (row,) = logged(rig)
    assert (row.outcome, row.decided_by) == ("refused", "person")


async def test_permission_no_answer_records_timed_out(make_rig):
    steps = [{"permission": {"title": "rm x"}}]
    timeout = RpcError(ErrorCode.timeout, "nobody answered")
    rig = with_approvals(make_rig, FakeAsks(Answer("Plan"), timeout), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    (row,) = logged(rig)
    assert (row.outcome, row.decided_by) == ("timed_out", "none")


async def test_permission_nobody_online_records_no_one(make_rig):
    steps = [{"permission": {"title": "rm x"}}]
    asks = FakeAsks(Answer("Plan"), Answer(None))
    rig = with_approvals(make_rig, asks, steps)
    real_open = asks.open

    async def open_then_go_offline(**kw):
        if kw.get("tool"):  # also the hand-off ask (tool="hand_off"): offline before _permission
            asks.online = False
        return await real_open(**kw)

    asks.open = open_then_go_offline
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    (row,) = logged(rig)
    assert (row.outcome, row.decided_by) == ("no_one", "none")


async def test_cancelled_permission_records_nothing(make_rig):
    steps = [{"permission": {"title": "rm x"}}]
    cancelled = RpcError(ErrorCode.cancelled, "the ask was cancelled")
    rig = with_approvals(make_rig, FakeAsks(Answer("Plan"), cancelled), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    assert logged(rig) == []


async def test_group_key_is_the_job_folder_for_every_title(make_rig):
    steps = [{"permission": {"title": "ls"}}, {"permission": {"title": "cat y"}}]
    rig = with_approvals(make_rig, FakeAsks(Answer("Plan"), Answer("Yes"), Answer("No")), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    rows = logged(rig)
    assert len(rows) == 2
    assert {r.group_key for r in rows} == {f"claude_code:{rig.folder}"}


async def test_jobs_without_approvals_unchanged(make_rig):
    steps = [{"permission": {"title": "ls"}}]
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Yes")), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    reply = next(f for f in rig.frames() if "outcome" in f.get("result", {}))
    assert reply["result"]["outcome"] == {"outcome": "selected", "optionId": "allow-once"}


# --- Scout answers Claude Code's permission asks under a preference ----------------------


class FakeSideCheck:
    def __init__(self, result=None):
        self.result = result
        self.facts = []

    async def decide(self, facts):
        self.facts.append(facts)
        return self.result


def pref_in(rig, sentence="Reading files is fine"):
    return rig.memory.add_preference(
        sentence=sentence, source=None, tool=None, group_key=None, at="2026-10-28T09:00:00Z"
    )


def make_scouted(make_rig, asks, steps, approve=True):
    check = FakeSideCheck()
    rig = with_approvals(make_rig, asks, steps, side_check=check)
    if approve:
        check.result = pref_in(rig)
    return rig, check


async def test_claude_code_approval_returns_the_allow_once_option_id(make_rig):
    steps = [{"permission": {"title": "ls -la", "input": {"command": "ls"}, "options": OPTS}}]
    asks = FakeAsks(Answer("Plan"))  # no second answer: the person is never asked
    rig, check = make_scouted(make_rig, asks, steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    reply = next(f for f in rig.frames() if "outcome" in f.get("result", {}))
    assert reply["result"]["outcome"] == {"outcome": "selected", "optionId": "a1"}
    assert len(asks.opened) == 1  # only the hand-off ask
    [row] = logged(rig)
    assert (row.outcome, row.decided_by, row.source) == ("approved", "scout", "claude_code")
    assert row.preference_id == check.result.id and row.job_id == rig.finished[0].id
    assert row.preference_sentence == "Reading files is fine"
    [facts] = check.facts
    assert (facts.source, facts.tool, facts.group_key, facts.locked) == (
        "claude_code", "claude_code:ls -la", f"claude_code:{rig.folder}", False,
    )  # fmt: skip


async def test_claude_code_without_allow_once_option_passes(make_rig):
    no_once = [OPTS[1], OPTS[2]]  # allow_always and reject_once only
    steps = [{"permission": {"title": "ls", "options": no_once}}]
    rig, check = make_scouted(make_rig, FakeAsks(Answer("Plan"), Answer("Nope")), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    [row] = logged(rig)
    assert (row.outcome, row.decided_by) == ("refused", "person")  # never allow_always


async def test_claude_code_pass_falls_through_to_the_person(make_rig):
    steps = [{"permission": {"title": "ls", "options": OPTS}}]
    rig, check = make_scouted(
        make_rig, FakeAsks(Answer("Plan"), Answer("Sure")), steps, approve=False
    )
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    assert len(check.facts) == 1
    [row] = logged(rig)
    assert (row.outcome, row.decided_by, row.preference_id) == ("approved", "person", None)


async def test_claude_code_no_one_online_skips_side_check(make_rig):
    steps = [{"permission": {"title": "rm x"}}]
    asks = FakeAsks(Answer("Plan"), Answer(None))
    rig, check = make_scouted(make_rig, asks, steps)
    real_open = asks.open

    async def open_then_go_offline(**kw):
        if kw.get("tool"):
            asks.online = False
        return await real_open(**kw)

    asks.open = open_then_go_offline
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    assert check.facts == []
    [row] = logged(rig)
    assert (row.outcome, row.decided_by) == ("no_one", "none")
