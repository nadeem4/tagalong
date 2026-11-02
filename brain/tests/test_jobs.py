"""Checks Jobs (hand-off ask, relayed asks, limits) through the real ExpertRun on the fake agent.

Asks and notify are fakes: the ask transport has its own tests, and here only what Jobs
opens and how it maps the answers matters. No Node, no Claude Code, no network.
"""

import asyncio
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fake_clock import FakeClock

from brain.approvals import Approvals
from brain.asks import Answer
from brain.events import Event
from brain.experts import ExpertHost, ExpertHosts, ExpertRun, Question, QuestionField
from brain.guards import Guards
from brain.jobs import JobError, Jobs, job_note
from brain.masking import Masker, mask_secrets
from brain.memory import ActivityEntry, Job, Memory
from brain.protocol import ErrorCode, RpcError
from brain.setup.store import InstalledExpert

AGENT = Path(__file__).parent / "fake_acp_agent.py"
HANG = [{"text": "working"}, {"hang": True}]


def installed(id="claude-acp", **kw) -> InstalledExpert:
    base = dict(
        id=id, name=id, version="1", command=[sys.executable, str(AGENT)], source="registry"
    )
    return InstalledExpert(**{**base, "logged_in": True, **kw})


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
        guards=None,
        experts=None,
        setup_facts=None,
        shared: bool = False,
        load: bool | str = False,
    ) -> None:
        script = tmp_path / "script.json"
        script.write_text(json.dumps(steps))
        monkeypatch.setenv("FAKE_ACP_SCRIPT", str(script))
        monkeypatch.setenv("FAKE_ACP_LOG", str(tmp_path / "log.jsonl"))
        if load:
            monkeypatch.setenv("FAKE_ACP_LOAD", "1" if load is True else load)
        self.log = tmp_path / "log.jsonl"
        self.folder = tmp_path / "proj"
        self.folder.mkdir()
        self.memory = Memory(tmp_path / "t.db")
        self.asks = asks
        self.notes: list[tuple] = []
        self.runs: list[ExpertRun] = []
        self.finished: list = []
        self.now = 0.0
        self.clock = FakeClock()  # the quiet clock of each run, moved by the test
        self.emitted: list = []
        self.dropped: list = []
        self.timers_changed = 0
        self.wall = datetime.now(UTC)
        self.experts = [installed()] if experts is None else experts
        self.expert_ids: list[str] = []
        self.approvals = (
            Approvals(self.memory, lambda m, p: None, lambda: datetime(2026, 1, 1, tzinfo=UTC))
            if approvals
            else None
        )
        # shared: the real factory, one warm adapter per expert; its idle wait never ends here.
        self.gate = asyncio.Event()
        self.hosts = ExpertHosts(300, sleep=lambda s: self.gate.wait())
        self.jobs = Jobs(
            self.memory,
            asks,
            lambda method, params: self.notes.append((method, params)),
            lambda: self.experts,
            self.hosts if shared else self.make_run,
            max_running=max_running,
            on_finished=self.finished.append,
            clock=lambda: self.now,
            scout_questions=scout,
            approvals=self.approvals,
            side_check=side_check,
            guards=guards,
            setup_facts=setup_facts,
            emit=self.emitted.append,
            drop=lambda kind, key: self.dropped.append((kind, key, len(self.finished))),
            now=lambda: self.wall,
            on_timers_changed=lambda: setattr(self, "timers_changed", self.timers_changed + 1),
        )

    def make_run(self, expert, **callbacks) -> ExpertRun:
        self.expert_ids.append(expert.id)
        host = ExpertHost(expert.command, expert.id, idle_s=0, grace=2)
        run = ExpertRun(
            host=host,
            sleep=self.clock.sleep,
            clock=self.clock.clock,
            grace=2,
            **callbacks,
        )
        self.runs.append(run)
        return run

    def changed(self) -> int:
        return sum(1 for n in self.notes if n == ("changed", {"what": "jobs"}))

    def frames(self) -> list[dict]:
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def spawns(self) -> int:
        return sum(1 for f in self.frames() if "env" in f)

    async def teardown(self) -> None:
        for job_id in list(self.jobs._runs):
            await self.jobs.stop(job_id)
        for run in self.runs:
            await run.close()
        await self.hosts.shutdown()
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

    def failing(expert, **callbacks):
        run = original(expert, **callbacks)

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


async def test_begin_failure_deletes_the_jobs_timers_and_rearms(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")))
    original = rig.make_run

    def failing(expert, **callbacks):
        run = original(expert, **callbacks)

        async def boom(mode_id, task):
            job_id = rig.memory.list_jobs()[0].id
            rig.memory.add_timer("x", datetime.now(UTC) + timedelta(hours=1), job_id=job_id)
            raise ConnectionError("connection lost")

        run.begin = boom
        return run

    rig.jobs._make_run = failing
    with pytest.raises(JobError, match="connection lost"):
        await rig.jobs.start("go", str(rig.folder))
    assert rig.memory.list_timers() == []
    assert rig.timers_changed == 1


async def test_start_failure_from_the_adapter_is_a_plain_message(make_rig):
    rig = make_rig(FakeAsks())
    original = rig.make_run

    def failing(expert, **callbacks):
        run = original(expert, **callbacks)

        async def refuse(folder, resume=None):
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

    def make(expert, **callbacks):
        run = original(expert, **callbacks)
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


async def test_job_result_is_masked_in_the_row_and_reported_note(make_rig):
    guards = Guards()
    guards.add(mask_secrets(Masker(lambda: ["fake-token-12345678"])))
    steps = [{"text": "key is fake-token-12345678"}, {"end": "end_turn"}]
    rig = make_rig(FakeAsks(Answer("Plan")), steps, guards=guards)
    job_id = await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    job = rig.memory.get_job(job_id)
    assert job.result == "key is [secret]"
    assert "fake-token-12345678" not in (job.progress or "")
    assert "fake-token-12345678" not in job_note(rig.finished[0])


@pytest.mark.parametrize(
    "shape",
    [
        "sk-ant-" + "a1B2" * 6,
        "Bearer " + "A1b2C3d4E5f6G7h8i9",
        "https://x.example/y?token=abc12345xyz",
    ],
)
async def test_job_result_masks_key_shapes(make_rig, shape):
    guards = Guards()
    guards.add(mask_secrets(Masker(lambda: [])))
    steps = [{"text": f"saw {shape} there"}, {"end": "end_turn"}]
    rig = make_rig(FakeAsks(Answer("Plan")), steps, guards=guards)
    job_id = await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    job = rig.memory.get_job(job_id)
    secret_part = shape.split()[-1].split("=")[-1]
    assert "[secret]" in job.result
    assert secret_part not in job.result and secret_part not in (job.progress or "")


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


def with_approvals(make_rig, asks, steps, side_check=None, **kw):
    return make_rig(asks, steps, approvals=True, side_check=side_check, **kw)


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


# --- Scout offers to auto-approve after the person allows a Claude Code ask ---------------


class FakeOffers:
    def __init__(self):
        self.considered = []

    def consider(self, group_key, source, tool):
        self.considered.append((group_key, source, tool))


@pytest.mark.parametrize(
    ("pick", "expected"), [("Sure", True), ("Whatever", True), ("Nope", False)]
)
async def test_only_a_person_allow_is_offered_for_consideration(make_rig, pick, expected):
    steps = [{"permission": {"title": "ls", "options": OPTS}}]
    rig = with_approvals(make_rig, FakeAsks(Answer("Plan"), Answer(pick)), steps)
    rig.jobs._offers = offers = FakeOffers()
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    group = f"claude_code:{rig.folder}"
    assert offers.considered == ([(group, "claude_code", "claude_code:ls")] if expected else [])


async def test_scout_approval_is_not_offered(make_rig):
    steps = [{"permission": {"title": "ls", "options": OPTS}}]
    rig, _ = make_scouted(make_rig, FakeAsks(Answer("Plan")), steps)
    rig.jobs._offers = offers = FakeOffers()
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    assert offers.considered == []


async def test_claude_code_side_check_that_raises_still_asks_the_person(make_rig):
    steps = [{"permission": {"title": "ls", "options": OPTS}}]
    rig, check = make_scouted(make_rig, FakeAsks(Answer("Plan"), Answer("Sure")), steps)

    async def boom(facts):
        raise RuntimeError("boom")

    check.decide = boom
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    [row] = logged(rig)
    assert (row.outcome, row.decided_by) == ("approved", "person")


async def test_claude_code_scout_approved_that_raises_still_asks_the_person(make_rig):
    steps = [{"permission": {"title": "ls", "options": OPTS}}]
    rig, _ = make_scouted(make_rig, FakeAsks(Answer("Plan"), Answer("Sure")), steps)

    def boom(*args, **kwargs):
        raise RuntimeError("boom")

    rig.jobs._approvals.scout_approved = boom
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    [row] = logged(rig)
    assert (row.outcome, row.decided_by) == ("approved", "person")


# --- The permission relay runs the shared ask chain ---------------------------------------


def chain_of(*guards):
    from brain.guards import Guards

    chain = Guards()
    for guard in guards:
        chain.add(guard)
    return chain


def recorder(seen, verdict):
    from brain.guards import Guard, Hook

    def check(ctx):
        seen.append(ctx)
        return verdict

    return Guard("recorder", Hook.ask, check)


async def test_permission_runs_the_shared_ask_chain(make_rig):
    from brain.guards import allow_once

    steps = [{"permission": {"title": "ls -la", "input": {"command": "ls"}, "options": OPTS}}]
    rig = make_rig(FakeAsks(Answer("Plan")), steps)
    seen: list = []
    rig.jobs._guards = chain_of(recorder(seen, allow_once("test", value="allow")))
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    [ctx] = seen
    assert (ctx.source, ctx.tool, ctx.group_key, ctx.locked) == (
        "claude_code", "claude_code:ls -la", f"claude_code:{rig.folder}", False,
    )  # fmt: skip


async def test_permission_side_check_approval_picks_allow_once_option_never_allow_always(make_rig):
    steps = [{"permission": {"title": "ls", "options": [OPTS[1], OPTS[0], OPTS[2]]}}]
    rig, _ = make_scouted(make_rig, FakeAsks(Answer("Plan")), steps)
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    reply = next(f for f in rig.frames() if "outcome" in f.get("result", {}))
    assert reply["result"]["outcome"] == {"outcome": "selected", "optionId": "a1"}


async def test_permission_chain_guard_error_refuses_without_hanging(make_rig):
    from brain.guards import Guard, Hook

    def boom(ctx):
        raise RuntimeError("boom")

    steps = [{"permission": {"title": "rm x", "options": OPTS}}]
    asks = FakeAsks(Answer("Plan"))
    rig = with_approvals(make_rig, asks, steps)
    rig.jobs._guards = chain_of(Guard("boom", Hook.ask, boom))
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    reply = next(f for f in rig.frames() if "outcome" in f.get("result", {}))
    assert reply["result"]["outcome"]["outcome"] != "selected"
    assert len(asks.opened) == 1  # only the hand-off ask: nothing ran, nobody was asked


async def test_permission_unexpected_allow_is_not_approval(make_rig):
    from brain.guards import ALLOW

    steps = [{"permission": {"title": "rm x", "options": OPTS}}]
    rig = with_approvals(make_rig, FakeAsks(Answer("Plan")), steps)
    rig.jobs._guards = chain_of(recorder([], ALLOW))
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.finished)
    reply = next(f for f in rig.frames() if "outcome" in f.get("result", {}))
    assert reply["result"]["outcome"]["outcome"] != "selected"
    assert logged(rig) == []


@pytest.mark.parametrize("scenario", ["denied", "nobody_online"])
async def test_permission_refusal_logs_no_tool_text(make_rig, caplog, scenario):
    steps = [{"permission": {"title": "rm secret-file", "options": OPTS}}]
    asks = FakeAsks(Answer("Plan"), Answer("Nope"))
    rig = with_approvals(make_rig, asks, steps)
    if scenario == "nobody_online":
        real_open = asks.open

        async def open_then_go_offline(**kw):
            if kw.get("tool"):
                asks.online = False
            return await real_open(**kw)

        asks.open = open_then_go_offline
    with caplog.at_level("INFO", logger="brain.guardrails"):
        await rig.jobs.start("go", str(rig.folder))
        await until(lambda: rig.finished)
    assert "guard=" in caplog.text  # the refusal was logged
    assert "rm secret-file" not in caplog.text


async def test_a_job_is_never_ended_for_taking_long(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")))
    job_id = await rig.jobs.start("fix it", str(rig.folder))
    await until(lambda: rig.clock._waiters)
    await rig.clock.advance(10 * 3600)  # ten hours later
    assert rig.memory.get_job(job_id).state == "running"
    assert not rig.finished and job_id in rig.jobs._runs


STEP_THEN_HANG = [
    {"tool": {"id": "a", "title": "Run", "kind": "execute", "input": {"command": "npm install"}}},
    {"hang": True},
]


async def test_a_quiet_job_wakes_scout_with_what_it_is_running(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), STEP_THEN_HANG)
    job_id = await rig.jobs.start("fix it", str(rig.folder))
    await until(lambda: rig.jobs.running_steps() and rig.clock._waiters)
    rig.wall += timedelta(minutes=34)
    await rig.clock.advance(1200)
    activity = rig.jobs.wake_facts(job_id)["activity"]
    assert rig.emitted == [
        Event(
            "job_quiet",
            {
                "job": job_id,
                "quiet_minutes": 20,
                "adapter_alive": "yes",
                "running": "npm install",
                "running_minutes": 34,
                "activity": activity,
            },
            key=f"job:{job_id}",
        )
    ]
    assert rig.memory.get_job(job_id).state == "running"  # code never stops a quiet job


async def test_no_quiet_wake_after_the_job_ends(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), [{"text": "done"}])
    await rig.jobs.start("fix it", str(rig.folder))
    await until(lambda: rig.finished)
    await rig.clock.advance(2 * 1200)
    assert rig.emitted == []


async def test_a_quiet_job_with_no_running_step_omits_it(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")))  # HANG: one message, no tool call
    job_id = await rig.jobs.start("fix it", str(rig.folder))
    await until(lambda: rig.memory.activity_after(job_id, 0, 5) and rig.clock._waiters)
    await rig.clock.advance(1200)
    (event,) = rig.emitted
    assert event.kind == "job_quiet" and event.key == f"job:{job_id}"
    assert "running" not in event.facts and "running_minutes" not in event.facts


async def test_expert_process_death_ends_failed_and_is_told(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), [{"text": "about to die"}, {"crash": 3}])
    job_id = await rig.jobs.start("fix it", str(rig.folder))
    await until(lambda: rig.finished)
    assert rig.memory.get_job(job_id).state == "error"
    assert len(rig.finished) == 1
    assert "State: error" in job_note(rig.finished[0])


async def test_one_installed_expert_is_used_without_naming_it(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")))
    await rig.jobs.start("go", str(rig.folder))
    assert rig.expert_ids == ["claude-acp"]


async def test_two_installed_and_none_named_fails_with_the_ids(make_rig):
    rig = make_rig(FakeAsks(), experts=[installed("claude-acp"), installed("codex-acp")])
    with pytest.raises(JobError) as err:
        await rig.jobs.start("go", str(rig.folder))
    assert "claude-acp" in str(err.value) and "codex-acp" in str(err.value)
    assert rig.runs == [] and rig.asks.opened == []


async def test_a_named_expert_is_used_and_recorded_as_the_rows_agent(make_rig):
    rig = make_rig(
        FakeAsks(Answer("Plan")), experts=[installed("claude-acp"), installed("codex-acp")]
    )
    job_id = await rig.jobs.start("go", str(rig.folder), "codex-acp")
    assert rig.expert_ids == ["codex-acp"]
    assert rig.memory.get_job(job_id).agent == "codex-acp"


async def test_asks_are_grouped_by_the_jobs_expert_so_preferences_do_not_cross(make_rig):
    steps = [{"permission": {"title": "ls"}}]
    rig = with_approvals(
        make_rig,
        FakeAsks(Answer("Plan"), Answer("Yes")),
        steps,
        experts=[installed("claude-acp"), installed("codex-acp")],
    )
    await rig.jobs.start("go", str(rig.folder), "codex-acp")
    await until(lambda: rig.finished)
    (row,) = logged(rig)
    assert row.source == "claude_code"  # the DB constraint
    assert row.tool == "codex-acp:ls" and row.group_key == f"codex-acp:{rig.folder}"


async def test_an_unknown_expert_is_a_fact_naming_what_is_installed(make_rig):
    rig = make_rig(FakeAsks())
    with pytest.raises(JobError) as err:
        await rig.jobs.start("go", str(rig.folder), "gemini")
    assert "gemini" in str(err.value) and "claude-acp" in str(err.value)
    assert rig.runs == []


async def test_a_custom_command_alone_works_and_is_the_agent(make_rig):
    custom = installed("custom", source="custom", logged_in=None)
    rig = make_rig(FakeAsks(Answer("Plan")), experts=[custom])
    job_id = await rig.jobs.start("go", str(rig.folder))
    assert rig.memory.get_job(job_id).agent == "custom"


async def test_no_experts_at_all_is_a_fact_not_wording(make_rig):
    rig = make_rig(FakeAsks(), experts=[])
    with pytest.raises(JobError) as err:
        await rig.jobs.start("go", str(rig.folder))
    assert str(err.value) == "no experts installed"
    assert rig.runs == []


FACTS = {
    "machine": {"os": "windows", "node": "18.0.0"},
    "candidates": ["claude-acp"],
    "stale": False,
}


async def fake_facts():
    return FACTS


def _facts_of(err: JobError) -> dict:
    return err.facts


async def test_no_expert_carries_setup_facts_with_candidates(make_rig):
    rig = make_rig(FakeAsks(), experts=[], setup_facts=fake_facts)
    with pytest.raises(JobError) as err:
        await rig.jobs.start("go", str(rig.folder))
    facts = _facts_of(err.value)
    assert facts["problem"] == "no_expert"
    assert facts["needs"] == {"node_major": 22}
    assert facts["candidates"] == ["claude-acp"] and facts["machine"]["os"] == "windows"
    assert str(err.value) == "no experts installed"


async def test_unknown_expert_carries_facts(make_rig):
    rig = make_rig(FakeAsks(), setup_facts=fake_facts)
    with pytest.raises(JobError) as err:
        await rig.jobs.start("go", str(rig.folder), "gemini")
    assert _facts_of(err.value)["problem"] == "unknown_expert"
    assert _facts_of(err.value)["expert"] == "gemini"
    assert _facts_of(err.value)["installed"] == ["claude-acp"]
    assert "needs" not in _facts_of(err.value)


async def test_a_not_logged_in_expert_is_a_fact_and_starts_nothing(make_rig):
    rig = make_rig(FakeAsks(), experts=[installed(logged_in=False)], setup_facts=fake_facts)
    with pytest.raises(JobError) as err:
        await rig.jobs.start("go", str(rig.folder))
    assert _facts_of(err.value)["problem"] == "expert_not_logged_in"
    assert "needs" not in _facts_of(err.value)
    assert _facts_of(err.value)["expert"] == "claude-acp"
    assert rig.runs == []


async def test_an_expert_whose_node_is_gone_is_a_fact(make_rig, tmp_path):
    gone = installed(command=[str(tmp_path / "no-such-node"), "x.js"], node="system")
    rig = make_rig(FakeAsks(), experts=[gone], setup_facts=fake_facts)
    with pytest.raises(JobError) as err:
        await rig.jobs.start("go", str(rig.folder))
    assert _facts_of(err.value)["problem"] == "expert_missing_node"
    assert _facts_of(err.value)["needs"] == {"node_major": 22}
    assert rig.runs == []


async def test_facts_hold_ids_and_numbers_never_sentences(make_rig):
    rig = make_rig(FakeAsks(), experts=[], setup_facts=fake_facts)
    with pytest.raises(JobError) as err:
        await rig.jobs.start("go", str(rig.folder))

    def leaves(value):
        if isinstance(value, dict):
            for v in value.values():
                yield from leaves(v)
        elif isinstance(value, list):
            for v in value:
                yield from leaves(v)
        else:
            yield value

    assert all(" " not in v for v in leaves(_facts_of(err.value)) if isinstance(v, str))


async def test_without_a_facts_source_the_error_has_no_facts(make_rig):
    rig = make_rig(FakeAsks(), experts=[])
    with pytest.raises(JobError) as err:
        await rig.jobs.start("go", str(rig.folder))
    assert err.value.facts == {"problem": "no_expert", "needs": {"node_major": 22}}


async def test_a_failing_facts_source_never_hides_the_refusal(make_rig):
    async def broken():
        raise RuntimeError("boom")

    rig = make_rig(FakeAsks(), experts=[], setup_facts=broken)
    with pytest.raises(JobError) as err:
        await rig.jobs.start("go", str(rig.folder))
    assert err.value.facts["problem"] == "no_expert" and "candidates" not in err.value.facts


async def finish(rig, job_id) -> None:
    await until(lambda: rig.memory.get_job(job_id).state != "running")


async def test_continue_job_reuses_the_saved_session_id_when_the_expert_can_resume(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")), [{"text": "ok"}], load=True)
    first = await rig.jobs.start("one", str(rig.folder))
    await finish(rig, first)
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first)
    assert (second.session, second.why_fresh) == ("continued", None)
    loads = [f for f in rig.frames() if f.get("method") == "session/load"]
    assert loads[0]["params"]["sessionId"] == rig.memory.get_job(first).session_id
    assert rig.memory.get_job(second).session_id == rig.memory.get_job(first).session_id


async def test_an_expert_that_cannot_resume_starts_fresh_and_the_result_says_why(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")), [{"text": "ok"}], load=False)
    first = await rig.jobs.start("one", str(rig.folder))
    await finish(rig, first)
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first)
    assert (second.session, second.why_fresh) == ("fresh", "expert cannot reopen sessions")
    assert not any(f.get("method") == "session/load" for f in rig.frames())


async def test_a_session_the_adapter_lost_falls_back_to_fresh(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")), [{"text": "ok"}], load=True)
    first = await rig.jobs.start("one", str(rig.folder))
    await finish(rig, first)
    rig.memory.update_job(first, session_id="bad-1")
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first)
    assert (second.session, second.why_fresh) == ("fresh", "session could not be loaded")


async def test_continuing_after_that_experts_adapter_died_leaves_the_other_expert_alone(make_rig):
    rig = make_rig(
        FakeAsks(Answer("Plan"), Answer("Plan"), Answer("Plan")),
        [{"text": "ok"}],
        experts=[installed(), installed("codex-acp")],
        load="known",  # a restarted adapter knows none of the earlier session ids
        shared=True,
    )
    first = await rig.jobs.start("one", str(rig.folder), "claude-acp")
    other = await rig.jobs.start("two", str(rig.folder), "codex-acp")
    await finish(rig, first)
    await finish(rig, other)
    hosts = {key[0]: host for key, host in rig.hosts._hosts.items()}
    survivor = hosts["codex-acp"].process
    await hosts["claude-acp"].shutdown()  # what the idle stop does
    third = await rig.jobs.start("three", str(rig.folder), continue_job=first)
    assert (third.session, third.why_fresh) == ("fresh", "session could not be loaded")
    assert survivor.returncode is None and hosts["codex-acp"].process is survivor
    assert rig.spawns() == 3


async def test_a_job_that_saved_no_session_continues_fresh(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")), [{"text": "ok"}], load=True)
    first = await rig.jobs.start("one", str(rig.folder))
    await finish(rig, first)
    rig.memory.update_job(first, session_id=None)
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first)
    assert (second.session, second.why_fresh) == ("fresh", "the earlier job saved no session")


async def test_a_plain_hand_off_reports_a_fresh_session_without_a_reason(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")))
    job = await rig.jobs.start("one", str(rig.folder))
    assert (job.session, job.why_fresh) == ("fresh", None)


async def test_continuing_from_another_expert_or_folder_is_a_job_error(make_rig, tmp_path):
    other = installed("codex-acp")
    rig = make_rig(FakeAsks(Answer("Plan")), [{"text": "ok"}], experts=[installed(), other])
    first = await rig.jobs.start("one", str(rig.folder), "claude-acp")
    await finish(rig, first)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    with pytest.raises(JobError, match="another expert"):
        await rig.jobs.start("two", str(rig.folder), "codex-acp", continue_job=first)
    with pytest.raises(JobError, match="another folder"):
        await rig.jobs.start("two", str(elsewhere), "claude-acp", continue_job=first)
    with pytest.raises(JobError, match="no job nope"):
        await rig.jobs.start("two", str(rig.folder), "claude-acp", continue_job="nope")
    assert len(rig.memory.list_jobs()) == 1


async def test_continuing_a_running_job_is_a_job_error(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")))
    first = await rig.jobs.start("one", str(rig.folder))
    with pytest.raises(JobError, match="still running"):
        await rig.jobs.start("two", str(rig.folder), continue_job=first)


async def test_the_new_row_records_its_parent(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")), [{"text": "ok"}], load=True)
    first = await rig.jobs.start("one", str(rig.folder))
    await finish(rig, first)
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first)
    assert rig.memory.get_job(second).parent_job == first
    assert rig.memory.get_job(first).parent_job is None


async def test_a_finished_jobs_adapter_is_reused_by_the_follow_up(make_rig):
    rig = make_rig(
        FakeAsks(Answer("Plan"), Answer("Plan")), [{"text": "ok"}], load=True, shared=True
    )
    first = await rig.jobs.start("one", str(rig.folder))
    await finish(rig, first)
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first)
    await finish(rig, second)
    assert rig.spawns() == 1
    assert rig.jobs.can_resume("claude-acp") is True


async def test_two_running_jobs_of_one_expert_share_the_process_and_the_cap_holds(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")), shared=True)
    await rig.jobs.start("one", str(rig.folder))
    await rig.jobs.start("two", str(rig.folder))
    assert rig.spawns() == 1
    with pytest.raises(JobError, match="2 jobs are already running"):
        await rig.jobs.start("three", str(rig.folder))
    assert rig.spawns() == 1


async def test_can_resume_is_unknown_until_the_adapter_has_started(make_rig):
    rig = make_rig(FakeAsks(), shared=True)
    assert rig.jobs.can_resume("claude-acp") is None


async def test_shutdown_stops_every_host(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")), [{"text": "ok"}], shared=True)
    first = await rig.jobs.start("one", str(rig.folder))
    await finish(rig, first)
    process = next(iter(rig.hosts._hosts.values())).process
    assert process.returncode is None  # warm for the follow-up
    await rig.jobs.shutdown()
    assert process.returncode is not None


TOKEN = "fake-token-12345678"


def rows_of(rig, job_id):
    return sorted(rig.memory.activity_after(job_id, 0, 1000), key=lambda e: e.seq)


async def test_a_jobs_steps_are_saved_masked(make_rig):
    guards = Guards()
    guards.add(mask_secrets(Masker(lambda: [TOKEN])))
    steps = [
        {"tool": {"id": "t1", "title": "Run", "kind": "execute", "input": {"command": "npm test"}}},
        {"tool_update": {"id": "t1", "status": "completed", "text": f"key {TOKEN}"}},
    ]
    rig = make_rig(FakeAsks(Answer("Plan")), steps, guards=guards)
    job_id = await rig.jobs.start("go", str(rig.folder))
    await finish(rig, job_id)
    command, output, end = rows_of(rig, job_id)
    assert (command.kind, command.text, command.status) == ("command", "npm test", "done")
    assert (output.kind, output.text) == ("output", "key [secret]")
    assert (end.kind, end.text) == ("end", "# done")


async def test_a_failing_command_through_the_fake_agent_has_its_exit_code(make_rig, monkeypatch):
    monkeypatch.setenv("FAKE_ACP_META_ONLY", "1")
    steps = [
        {
            "tool": {
                "id": "t1",
                "title": "Run",
                "kind": "execute",
                "terminal": True,
                "input": {"command": "false"},
            }
        },
        {
            "tool_update": {
                "id": "t1",
                "status": "failed",
                "terminal": {"output": "boom", "exit": 1},
            }
        },
    ]
    rig = make_rig(FakeAsks(Answer("Plan")), steps)
    job_id = await rig.jobs.start("go", str(rig.folder))
    await finish(rig, job_id)
    command, output, _end = rows_of(rig, job_id)
    assert (command.status, command.exit, output.text) == ("failed", 1, "boom")


async def test_a_stopped_job_ends_its_log_with_stopped(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), HANG)
    job_id = await rig.jobs.start("go", str(rig.folder))
    await rig.jobs.stop(job_id)
    assert rows_of(rig, job_id)[-1].text == "# stopped"


async def test_an_errored_job_ends_with_the_error_reason(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), [{"crash": 3}])
    job_id = await rig.jobs.start("go", str(rig.folder))
    await finish(rig, job_id)
    end = rows_of(rig, job_id)[-1]
    assert end.kind == "end" and end.text.startswith("# error: ")


async def test_entries_belong_to_their_job(make_rig):
    steps = [
        [{"tool": {"id": "a", "title": "first", "kind": "execute"}}, {"sleep": 0.3}],
        [{"tool": {"id": "b", "title": "second", "kind": "execute"}}],
    ]
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan")), steps, shared=True)
    one = await rig.jobs.start("one", str(rig.folder))
    await until(lambda: rows_of(rig, one))
    two = await rig.jobs.start("two", str(rig.folder))
    await finish(rig, one)
    await finish(rig, two)
    texts = lambda job: [e.text for e in rows_of(rig, job) if e.kind == "command"]  # noqa: E731
    assert texts(one) == ["first"] and texts(two) == ["second"]


def activity_changes(rig) -> int:
    return sum(1 for n in rig.notes if n == ("changed", {"what": "job_activity"}))


TOOL_STEPS = [
    {"tool": {"id": "t1", "title": "Run", "kind": "execute", "input": {"command": "npm test"}}},
    {"tool_update": {"id": "t1", "status": "completed", "text": "ok"}},
    {"tool": {"id": "t2", "title": "Run", "kind": "execute", "input": {"command": "npm run b"}}},
]


async def test_activity_page_returns_entries_after_the_cursor(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), TOOL_STEPS + [{"end": "end_turn"}])
    job_id = await rig.jobs.start("go", str(rig.folder))
    await finish(rig, job_id)
    page = rig.jobs.activity_page(job_id, 0)
    assert page["job"] == job_id and page["state"] == "done" and page["more"] is False
    assert page["watch"] is None
    assert {"rev", "seq", "at", "kind", "text", "status", "step", "exit"} == set(page["entries"][0])
    assert page["entries"][-1]["kind"] == "end"
    assert page["rev"] == max(e["rev"] for e in page["entries"])
    again = rig.jobs.activity_page(job_id, page["rev"])
    assert again["entries"] == [] and again["rev"] == page["rev"]


async def test_activity_page_cuts_at_the_page_limit(make_rig, monkeypatch):
    monkeypatch.setattr("brain.jobs.PAGE_LIMIT", 2)
    rig = make_rig(FakeAsks(Answer("Plan")), TOOL_STEPS + [{"end": "end_turn"}])
    job_id = await rig.jobs.start("go", str(rig.folder))
    await finish(rig, job_id)
    page = rig.jobs.activity_page(job_id, 0)
    assert len(page["entries"]) == 2 and page["more"] is True
    assert page["rev"] == page["entries"][-1]["rev"]  # the cursor to continue from


async def test_activity_page_for_an_unknown_job_is_a_job_error(make_rig):
    rig = make_rig(FakeAsks())
    with pytest.raises(JobError, match="no job nope"):
        rig.jobs.activity_page("nope", 0)


async def test_an_old_job_without_rows_has_an_empty_page(make_rig):
    rig = make_rig(FakeAsks())
    rig.memory.add_job("old", "claude-acp", "t", str(rig.folder), "default")
    page = rig.jobs.activity_page("old", 0)
    assert page["entries"] == [] and page["rev"] == 0 and page["more"] is False
    assert rig.jobs.with_activity() == set()


async def test_running_steps_lists_each_running_job_that_has_a_step(make_rig):
    rig = make_rig(
        FakeAsks(Answer("Plan"), Answer("Plan")),
        [[*TOOL_STEPS, {"hang": True}], [{"text": "hi"}, {"hang": True}]],
        experts=[installed(name="Claude Code")],
        shared=True,
    )
    one = await rig.jobs.start("one", str(rig.folder))
    await rig.jobs.start("two", str(rig.folder))  # says something, runs no step
    await until(lambda: rig.jobs.running_steps())
    steps = rig.jobs.running_steps()
    assert [(s["job"], s["expert"], s["text"]) for s in steps] == [
        (one, "Claude Code", "npm run b")
    ]
    assert steps[0]["at"]
    await rig.jobs.stop(one)
    assert rig.jobs.running_steps() == []  # an ended job is absent


async def test_running_steps_includes_a_pending_step(make_rig):
    pending = {
        "tool": {
            "id": "p1",
            "title": "Run",
            "kind": "execute",
            "status": "pending",
            "input": {"command": "npm ci"},
        }
    }
    rig = make_rig(FakeAsks(Answer("Plan")), [pending, {"hang": True}], experts=[installed()])
    job_id = await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.jobs.running_steps())
    assert [(s["job"], s["text"]) for s in rig.jobs.running_steps()] == [(job_id, "npm ci")]


async def test_first_activity_change_is_sent_at_once(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), [TOOL_STEPS[0], {"hang": True}])
    await rig.jobs.start("go", str(rig.folder))
    await until(lambda: activity_changes(rig) >= 1)


async def test_a_burst_sends_one_leading_and_one_trailing_change(make_rig, monkeypatch):
    monkeypatch.setattr("brain.jobs.ACTIVITY_NOTIFY_S", 0.2)
    steps = [{"text": str(i)} for i in range(30)]
    rig = make_rig(FakeAsks(Answer("Plan")), [*steps, {"hang": True}])
    job_id = await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.memory.last_rev(job_id) >= 1)
    await asyncio.sleep(0.05)  # the burst is over; the clock never moved
    assert activity_changes(rig) == 1
    await until(lambda: activity_changes(rig) == 2)  # the trailing flush announces the last write
    await asyncio.sleep(0.3)
    assert activity_changes(rig) == 2
    assert rig.notes[-1] == ("changed", {"what": "job_activity"})


async def test_the_end_cancels_the_trailing_change_and_announces_itself(make_rig, monkeypatch):
    monkeypatch.setattr("brain.jobs.ACTIVITY_NOTIFY_S", 0.2)
    steps = [{"text": "a"}, {"text": "b"}, {"end": "end_turn"}]
    rig = make_rig(FakeAsks(Answer("Plan")), steps)
    job_id = await rig.jobs.start("go", str(rig.folder))
    await finish(rig, job_id)
    count = activity_changes(rig)
    assert count >= 2
    await asyncio.sleep(0.4)
    assert activity_changes(rig) == count  # no late flush after the end


async def test_the_end_sends_exactly_one_notice_after_the_end_row(make_rig, monkeypatch):
    monkeypatch.setattr("brain.jobs.ACTIVITY_NOTIFY_S", 0)  # nothing throttled
    rig = make_rig(FakeAsks(Answer("Plan")), [{"text": "a"}, {"end": "end_turn"}])
    seen: list[bool] = []  # per job_activity notice: was the end row already written?
    real = rig.jobs._notify

    def spy(method, params):
        if params == {"what": "job_activity"}:
            rows = rig.memory.activity_after(job_id, 0, 1000)
            seen.append(any(e.kind == "end" for e in rows))
        real(method, params)

    job_id = await rig.jobs.start("go", str(rig.folder))
    rig.jobs._notify = spy
    await finish(rig, job_id)
    await asyncio.sleep(0.1)
    assert seen.count(True) == 1 and seen[-1] is True


# --- summary on wakes, failed steps (JM2) ---

FAIL_THEN_HANG = [
    {
        "tool": {
            "id": "t1",
            "title": "Run",
            "kind": "execute",
            "terminal": True,
            "input": {"command": "npm test"},
        }
    },
    {
        "tool_update": {
            "id": "t1",
            "status": "failed",
            "terminal": {"output": f"key {TOKEN}\nboom", "exit": 1},
        }
    },
    {"hang": True},
]


def masking_guards() -> Guards:
    guards = Guards()
    guards.add(mask_secrets(Masker(lambda: [TOKEN])))
    return guards


async def test_a_failed_step_emits_job_step_failed_with_command_exit_and_summary(
    make_rig, monkeypatch
):
    monkeypatch.setenv("FAKE_ACP_META_ONLY", "1")
    rig = make_rig(FakeAsks(Answer("Plan")), FAIL_THEN_HANG, guards=masking_guards())
    job_id = await rig.jobs.start("go", str(rig.folder))
    await until(lambda: rig.emitted)
    (event,) = rig.emitted
    assert (event.kind, event.key) == ("job_step_failed", f"job:{job_id}")
    assert (event.facts["job"], event.facts["step"], event.facts["exit"]) == (
        job_id,
        "npm test",
        1,
    )
    assert "failed: npm test (exit 1)" in event.facts["activity"]
    assert "boom" in event.facts["activity"]
    assert TOKEN not in str(event.facts)


async def test_the_failed_step_fact_is_one_clipped_line(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")))
    text = "a\nb " + "z" * 500
    entry = ActivityEntry(1, 1, "2026-01-01T00:00:00+00:00", "command", text, "failed", "s", 1)
    rig.jobs._step_failed("j1", entry)
    step = rig.emitted[-1].facts["step"]
    assert "\n" not in step and 0 < len(step) <= 200


async def test_job_end_drops_held_failed_and_quiet_events_for_that_job(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), [{"text": "ok"}])
    job_id = await rig.jobs.start("go", str(rig.folder))
    await finish(rig, job_id)
    await until(lambda: rig.finished)
    assert (("job_step_failed", f"job:{job_id}", 0)) in rig.dropped
    assert (("job_quiet", f"job:{job_id}", 0)) in rig.dropped  # dropped before on_finished ran


async def test_job_quiet_facts_include_the_activity_summary(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), STEP_THEN_HANG)
    job_id = await rig.jobs.start("fix it", str(rig.folder))
    await until(lambda: rig.jobs.running_steps() and rig.clock._waiters)
    await rig.clock.advance(1200)
    (event,) = rig.emitted
    assert "running: npm install" in event.facts["activity"]
    assert event.facts["job"] == job_id


async def test_job_ended_note_carries_the_activity_summary_beside_the_result(make_rig):
    rig = make_rig(
        FakeAsks(Answer("Plan")),
        [
            {"tool": {"id": "t", "title": "Run", "kind": "execute", "input": {"command": "ls"}}},
            {"text": "all done"},
        ],
    )
    job_id = await rig.jobs.start("go", str(rig.folder))
    await finish(rig, job_id)
    await until(lambda: rig.finished)
    note = rig.jobs.note(rig.finished[0])
    assert note.startswith(f"Job {job_id} ended.")
    assert "Result:" in note and "Activity:\nsteps: 1" in note


def test_job_note_without_facts_is_unchanged():
    job = Job(
        "a1", "claude_code", "t", "C:/x", "default", "done", "", "p", "r", "s", True, "t0", "t1"
    )
    assert "Activity:" not in job_note(job)
    assert job_note(job, {"activity": "steps: 1"}).endswith("Activity:\nsteps: 1")


async def test_wake_facts_masks_a_secret_in_the_summary(make_rig):
    rig = make_rig(FakeAsks(), guards=masking_guards())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    at = datetime.now(UTC).isoformat()
    rig.memory.save_activity(
        "j1", ActivityEntry(1, 1, at, "command", f"curl {TOKEN}", "failed", "s", 1)
    )
    facts = rig.jobs.wake_facts("j1")
    assert TOKEN not in facts["activity"] and "[secret]" in facts["activity"]


async def test_note_for_a_job_finished_before_a_restart_still_has_its_summary(make_rig):
    rig = make_rig(FakeAsks())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    rig.memory.update_job("j1", state="done", reason="", result="ok", ended_at="2026-01-01")
    at = datetime.now(UTC).isoformat()
    rig.memory.save_activity("j1", ActivityEntry(1, 1, at, "command", "make", "done", "s", 0))
    assert "steps: 1" in rig.jobs.note(rig.memory.get_job("j1"))


async def test_a_job_with_no_entries_gets_a_short_summary_not_an_error(make_rig):
    rig = make_rig(FakeAsks())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    assert rig.jobs.wake_facts("j1") == {"activity": "no activity recorded"}


# --- JM3: Scout's watch list -------------------------------------------------------------


def _items(n: int) -> list[dict]:
    return [{"text": f"item {i}", "done": False} for i in range(n)]


async def test_set_watch_saves_masks_and_notifies_job_activity(make_rig):
    rig = make_rig(FakeAsks(), guards=masking_guards())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    saved = rig.jobs.set_watch("j1", [{"text": f"uses {TOKEN}", "done": False}])
    assert TOKEN not in str(saved) and "[secret]" in saved[0]["text"]
    assert rig.memory.get_job("j1").watch == saved
    assert ("changed", {"what": "job_activity"}) in rig.notes


@pytest.mark.parametrize(
    "bad",
    [
        _items(11),
        [{"text": "x" * 201, "done": False}],
        [{"text": "", "done": False}],
        [{"text": "a", "done": "yes"}],
        "not a list",
        [{"done": True}],
        ["just text"],
    ],
)
async def test_set_watch_refuses_a_bad_list_and_keeps_the_old_one(make_rig, bad):
    rig = make_rig(FakeAsks())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    old = [{"text": "keep", "done": True}]
    rig.jobs.set_watch("j1", old)
    with pytest.raises(JobError):
        rig.jobs.set_watch("j1", bad)
    assert rig.memory.get_job("j1").watch == old


async def test_set_watch_accepts_ten_items_and_an_empty_list_clears(make_rig):
    rig = make_rig(FakeAsks())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    assert len(rig.jobs.set_watch("j1", _items(10))) == 10
    assert rig.jobs.set_watch("j1", []) == []
    assert rig.memory.get_job("j1").watch is None


async def test_set_watch_refuses_an_unknown_job(make_rig):
    rig = make_rig(FakeAsks())
    with pytest.raises(JobError, match="no job nope"):
        rig.jobs.set_watch("nope", _items(1))


async def test_wake_facts_has_watching_lines_in_order(make_rig):
    rig = make_rig(FakeAsks())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    assert "watching" not in rig.jobs.wake_facts("j1")
    rig.jobs.set_watch(
        "j1", [{"text": "tests pass", "done": True}, {"text": "README updated", "done": False}]
    )
    assert rig.jobs.wake_facts("j1")["watching"] == "[x] tests pass\n[ ] README updated"


async def test_job_ended_note_shows_the_watch_list_after_a_restart(make_rig):
    rig = make_rig(FakeAsks())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    rig.memory.update_job("j1", state="done", reason="", result="ok", ended_at="2026-01-01")
    rig.jobs.set_watch("j1", [{"text": "tests pass", "done": False}])
    assert "Watching:\n[ ] tests pass" in rig.jobs.note(rig.memory.get_job("j1"))


async def test_activity_page_carries_the_watch_list(make_rig):
    rig = make_rig(FakeAsks())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    assert rig.jobs.activity_page("j1", 0)["watch"] is None
    rig.jobs.set_watch("j1", _items(1))
    assert rig.jobs.activity_page("j1", 0)["watch"] == _items(1)


async def test_set_watch_saves_the_stripped_text_and_limits_the_stripped_text(make_rig):
    rig = make_rig(FakeAsks())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    saved = rig.jobs.set_watch("j1", [{"text": "  tests pass 	", "done": False}])
    assert saved == [{"text": "tests pass", "done": False}]
    padded = " " + "x" * 200 + " "
    assert rig.jobs.set_watch("j1", [{"text": padded, "done": False}])[0]["text"] == "x" * 200
    with pytest.raises(JobError):
        rig.jobs.set_watch("j1", [{"text": " " + "x" * 201, "done": False}])


async def test_two_quick_watch_changes_end_in_one_trailing_notice(make_rig, monkeypatch):
    monkeypatch.setattr("brain.jobs.ACTIVITY_NOTIFY_S", 0.2)
    rig = make_rig(FakeAsks())
    rig.memory.add_job("j1", "claude_code", "t", str(rig.folder), "default")
    rig.jobs.set_watch("j1", _items(1))
    rig.jobs.set_watch("j1", _items(2))
    rig.jobs.set_watch("j1", _items(3))
    assert activity_changes(rig) == 1  # the first goes at once
    await until(lambda: activity_changes(rig) == 2)  # the burst is one trailing notice
    await asyncio.sleep(0.3)
    assert activity_changes(rig) == 2
    assert rig.memory.get_job("j1").watch == _items(3)


async def test_ending_a_job_deletes_its_timers_and_rearms(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), [{"text": "ok"}])
    job_id = await rig.jobs.start("go", str(rig.folder))
    when = datetime.now(UTC) + timedelta(hours=1)
    rig.memory.add_timer("a", when, job_id=job_id)
    rig.memory.add_timer("b", when, repeat_s=600, job_id=job_id)
    await finish(rig, job_id)
    await until(lambda: rig.finished)
    assert rig.memory.list_timers() == []
    assert rig.timers_changed == 1


async def test_ending_a_job_drops_a_held_timer_event_for_it(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), [{"text": "ok"}])
    job_id = await rig.jobs.start("go", str(rig.folder))
    t = rig.memory.add_timer("a", datetime.now(UTC) + timedelta(hours=1), job_id=job_id)
    await finish(rig, job_id)
    await until(lambda: rig.finished)
    assert ("timer", f"timer:{t.id}", 0) in rig.dropped  # dropped before on_finished ran


async def test_ending_a_job_leaves_other_jobs_and_plain_timers(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), [{"text": "ok"}])
    job_id = await rig.jobs.start("go", str(rig.folder))
    when = datetime.now(UTC) + timedelta(hours=1)
    other = rig.memory.add_timer("o", when, job_id="someone-else")
    plain = rig.memory.add_timer("p", when)
    await finish(rig, job_id)
    await until(lambda: rig.finished)
    assert {t.id for t in rig.memory.list_timers()} == {other.id, plain.id}
    assert not any(kind == "timer" for kind, _key, _n in rig.dropped)


async def test_ending_a_job_without_timers_does_not_rearm(make_rig):
    rig = make_rig(FakeAsks(Answer("Plan")), [{"text": "ok"}])
    job_id = await rig.jobs.start("go", str(rig.folder))
    await finish(rig, job_id)
    await until(lambda: rig.finished)
    assert rig.timers_changed == 0


# --- a follow-up Scout starts goes through the preference rule (JM5) ---------------------


async def first_job(rig):
    job = await rig.jobs.start("one", str(rig.folder))
    await finish(rig, job)
    return str(job)


def continuing(make_rig, asks, side_check=None, **kw):
    steps = [{"text": "ok"}]
    return with_approvals(make_rig, asks, steps, side_check=side_check, load=True, **kw)


def hand_off_rows(rig):
    return [r for r in logged(rig) if r.tool == "hand_off"]


async def test_owner_asked_continue_shows_the_card_and_never_runs_the_chain(make_rig):
    check = FakeSideCheck(None)
    rig = continuing(make_rig, FakeAsks(Answer("Plan"), Answer("Auto")), check)
    first = await first_job(rig)
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first, owner_asked=True)
    assert check.facts == [] and hand_off_rows(rig) == []
    assert rig.memory.get_job(second).mode == "auto"


async def test_brain_started_continue_with_a_covering_preference_skips_the_card(make_rig):
    asks = FakeAsks(Answer("Plan"))  # no second answer: the owner is never asked
    check = FakeSideCheck()
    rig = continuing(make_rig, asks, check)
    check.result = pref_in(rig, "Nudging my jobs is fine")
    first = await first_job(rig)
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first, owner_asked=False)
    assert len(asks.opened) == 1  # only the first card
    assert rig.memory.get_job(second).mode == "plan" == rig.memory.get_job(first).mode
    [row] = hand_off_rows(rig)
    assert (row.outcome, row.decided_by, row.source) == ("approved", "scout", "claude_code")
    assert row.group_key == f"claude_code:{rig.folder}"
    [facts] = check.facts
    assert (facts.source, facts.tool, facts.group_key) == (
        "claude_code", "hand_off", f"claude_code:{rig.folder}",
    )  # fmt: skip


async def test_brain_started_continue_without_a_preference_shows_the_card(make_rig):
    check = FakeSideCheck(None)
    asks = FakeAsks(Answer("Plan"), Answer("Auto"))
    rig = continuing(make_rig, asks, check)
    rig.jobs._offers = offers = FakeOffers()
    first = await first_job(rig)
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first, owner_asked=False)
    assert len(asks.opened) == 2 and asks.opened[1]["tool"] == "hand_off"
    assert rig.memory.get_job(second).mode == "auto"  # the owner's pick, not the earlier mode
    [row] = hand_off_rows(rig)
    assert (row.outcome, row.decided_by) == ("approved", "person")
    group = f"claude_code:{rig.folder}"
    assert offers.considered == [(group, "claude_code", "hand_off")]


async def test_brain_started_continue_card_cancel_starts_nothing_and_records_no_row(make_rig):
    asks = FakeAsks(Answer("Plan"), Answer("cancel"))
    rig = continuing(make_rig, asks, FakeSideCheck(None))
    rig.jobs._offers = offers = FakeOffers()
    first = await first_job(rig)
    with pytest.raises(JobError, match="not started"):
        await rig.jobs.start("two", str(rig.folder), continue_job=first, owner_asked=False)
    assert hand_off_rows(rig) == [] and offers.considered == []
    assert len(rig.memory.list_jobs()) == 1


async def test_brain_started_continue_with_nobody_online_is_not_started_and_logs_no_one(make_rig):
    check = FakeSideCheck()
    asks = FakeAsks(Answer("Plan"))
    rig = continuing(make_rig, asks, check)
    check.result = pref_in(rig)
    first = await first_job(rig)
    asks.online = False
    with pytest.raises(JobError, match="not started"):
        await rig.jobs.start("two", str(rig.folder), continue_job=first, owner_asked=False)
    assert check.facts == []  # nobody online skips the side-check
    [row] = hand_off_rows(rig)
    assert (row.outcome, row.decided_by) == ("no_one", "none")
    assert len(rig.memory.list_jobs()) == 1


async def test_an_earlier_mode_missing_from_the_new_session_falls_back_to_the_card(make_rig):
    check = FakeSideCheck()
    asks = FakeAsks(Answer("Plan"), Answer("Auto"))
    rig = continuing(make_rig, asks, check)
    check.result = pref_in(rig)
    first = await first_job(rig)
    rig.memory.update_job(first, mode="gone")
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first, owner_asked=False)
    assert len(asks.opened) == 2  # the card was shown instead of crashing
    assert rig.memory.get_job(second).mode == "auto"


async def test_a_new_job_without_continue_always_shows_the_card_even_on_a_brain_turn(make_rig):
    check = FakeSideCheck()
    asks = FakeAsks(Answer("Plan"), Answer("Auto"))
    rig = continuing(make_rig, asks, check)
    check.result = pref_in(rig)
    await first_job(rig)
    second = await rig.jobs.start("two", str(rig.folder), owner_asked=False)
    assert check.facts == [] and hand_off_rows(rig) == []
    assert len(asks.opened) == 2 and rig.memory.get_job(second).mode == "auto"


async def test_a_side_check_error_on_a_follow_up_falls_back_to_the_card(make_rig):
    check = FakeSideCheck()

    async def boom(facts):
        raise RuntimeError("boom")

    check.decide = boom
    asks = FakeAsks(Answer("Plan"), Answer("Auto"))
    rig = continuing(make_rig, asks, check)
    first = await first_job(rig)
    second = await rig.jobs.start("two", str(rig.folder), continue_job=first, owner_asked=False)
    assert len(asks.opened) == 2 and rig.memory.get_job(second).mode == "auto"
    [row] = hand_off_rows(rig)
    assert row.decided_by == "person"
