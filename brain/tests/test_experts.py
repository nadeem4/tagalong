"""Checks ExpertRun against the scripted fake ACP agent (no Node, no network, no Claude).

Each test spawns tests/fake_acp_agent.py as the adapter. The fake logs every frame the
runner sends, so tests read that log to see the prompts, mode and replies that arrived.
"""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fake_clock import FakeClock

from brain.experts import (
    ExpertError,
    ExpertHost,
    ExpertHosts,
    ExpertRun,
    Question,
    kill_tree,
)

AGENT = Path(__file__).parent / "fake_acp_agent.py"


class Harness:
    """Collects callbacks; answers asks from fields the test sets."""

    def __init__(self) -> None:
        self.permissions: list = []
        self.questions: list = []
        self.progress: list[str] = []
        self.updates: list = []
        self.ended: asyncio.Future = asyncio.get_running_loop().create_future()
        self.permission_answer: str | None = "allow-once"
        self.question_answer: dict | None = {"question_0": "Red"}
        self.run: ExpertRun | None = None
        self.ends: list[tuple] = []
        self.gone_at_end: list[bool] = []
        self.end_hook = None

    async def on_permission(self, request):
        self.permissions.append(request)
        return self.permission_answer

    async def on_question(self, question: Question):
        self.questions.append(question)
        return self.question_answer

    async def on_progress(self, text: str) -> None:
        self.progress.append(text)

    async def on_update(self, update) -> None:
        self.updates.append(update)

    async def on_end(self, state: str, reason: str, result: str | None) -> None:
        self.ends.append((state, reason, result))
        process = self.run.process
        self.gone_at_end.append(process is not None and process.returncode is not None)
        if not self.ended.done():
            self.ended.set_result((state, reason, result))
        if self.end_hook:
            await self.end_hook()


def make_run(
    h: Harness,
    tmp_path: Path,
    steps,
    command=None,
    expert_id: str = "custom",
    path_first=None,
    grace: float = 2,
    startup_timeout: float = 60,
) -> ExpertRun:
    script = tmp_path / "script.json"
    script.write_text(json.dumps(steps))
    # The fake reads its script and log from the environment it inherits through the runner.
    patch.setenv("FAKE_ACP_SCRIPT", str(script))
    patch.setenv("FAKE_ACP_LOG", str(tmp_path / "log.jsonl"))
    # idle_s=0: the adapter dies with the one session, as these tests expect.
    host = ExpertHost(
        command or [sys.executable, str(AGENT)],
        expert_id,
        path_first,
        idle_s=0,
        grace=grace,
        startup_timeout=startup_timeout,
    )
    h.run = ExpertRun(
        host=host,
        on_permission=h.on_permission,
        on_question=h.on_question,
        on_progress=h.on_progress,
        on_end=h.on_end,
        on_update=h.on_update,
        grace=grace,
    )
    return h.run


patch = pytest.MonkeyPatch()


@pytest.fixture(autouse=True)
def undo_env():
    yield
    patch.undo()


async def until(condition, timeout: float = 10) -> None:
    """Wait for a condition; a broken run fails the test instead of hanging it."""

    async def poll() -> None:
        while not condition():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(poll(), timeout)


def frames(tmp_path: Path) -> list[dict]:
    lines = (tmp_path / "log.jsonl").read_text().splitlines()
    return [json.loads(line) for line in lines]


def prompts(tmp_path: Path) -> list[str]:
    return [
        f["params"]["prompt"][0]["text"]
        for f in frames(tmp_path)
        if f.get("method") == "session/prompt"
    ]


async def finished(h: Harness, timeout: float = 15):
    return await asyncio.wait_for(h.ended, timeout)


async def test_start_returns_the_modes_and_begin_sends_task_and_mode(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [{"text": "ok"}])
    try:
        modes = await run.start(tmp_path)
        assert [m.id for m in modes] == [
            "default",
            "acceptEdits",
            "plan",
            "auto",
            "bypassPermissions",
        ]
        assert run.session_id == "sess-1"
        await run.begin("plan", "fix the bug")
        await finished(h)
    finally:
        await run.close()
    sent = frames(tmp_path)
    assert (
        next(f for f in sent if f.get("method") == "session/set_mode")["params"]["modeId"] == "plan"
    )
    assert prompts(tmp_path) == ["fix the bug"]


async def test_progress_result_and_done(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [{"text": "Hel"}, {"text": "lo."}, {"end": "end_turn"}])
    try:
        await run.start(tmp_path)
        await run.begin("default", "hi")
        state = await finished(h)
    finally:
        await run.close()
    assert state == ("done", "end_turn", "Hello.")
    assert h.progress[-1] == "Hello."
    assert run.progress == "Hello." and run.result == "Hello."


async def test_permission_goes_to_the_callback_and_the_option_id_comes_back(tmp_path):
    h = Harness()
    steps = [{"permission": {"title": "ls -la", "kind": "execute", "input": {"command": "ls"}}}]
    run = make_run(h, tmp_path, steps)
    try:
        await run.start(tmp_path)
        await run.begin("default", "go")
        await finished(h)
    finally:
        await run.close()
    request = h.permissions[0]
    assert (request.title, request.kind) == ("ls -la", "execute")
    assert [o.id for o in request.options] == ["allow-once", "reject"]
    reply = next(f for f in frames(tmp_path) if "outcome" in f.get("result", {}))
    assert reply["result"]["outcome"] == {"outcome": "selected", "optionId": "allow-once"}


async def test_permission_none_sends_the_cancelled_outcome(tmp_path):
    h = Harness()
    h.permission_answer = None
    run = make_run(h, tmp_path, [{"permission": {"title": "rm x"}}])
    try:
        await run.start(tmp_path)
        await run.begin("default", "go")
        await finished(h)
    finally:
        await run.close()
    reply = next(f for f in frames(tmp_path) if "outcome" in f.get("result", {}))
    assert reply["result"]["outcome"] == {"outcome": "cancelled"}


async def test_question_goes_to_the_callback_and_the_answer_reaches_the_agent(tmp_path):
    h = Harness()
    steps = [
        {"question": {"message": "Which colour?", "options": ["Red", "Blue"], "header": "Hue"}}
    ]
    run = make_run(h, tmp_path, steps)
    try:
        await run.start(tmp_path)
        await run.begin("default", "go")
        await finished(h)
    finally:
        await run.close()
    question = h.questions[0]
    assert question.message == "Which colour?"
    assert [(f.key, f.title, f.options) for f in question.fields] == [
        ("question_0", "Hue", ["Red", "Blue"])
    ]
    reply = next(f for f in frames(tmp_path) if f.get("result", {}).get("action"))
    assert reply["result"] == {"action": "accept", "content": {"question_0": "Red"}}


async def test_two_multi_select_questions_keep_their_text_and_the_list_answer_passes_through(
    tmp_path,
):
    h = Harness()
    h.question_answer = {"question_0": ["Red", "Blue"], "question_1": "Large"}
    steps = [
        {
            "question": {
                "message": "Please answer the following questions.",
                "questions": [
                    {
                        "header": "Colours",
                        "description": "Which colours do you like?",
                        "options": ["Red", "Blue", "Green"],
                        "multi": True,
                    },
                    {
                        "header": "Size",
                        "description": "Which size?",
                        "options": ["Small", "Large"],
                    },
                ],
            }
        }
    ]
    run = make_run(h, tmp_path, steps)
    try:
        await run.start(tmp_path)
        await run.begin("default", "go")
        await finished(h)
    finally:
        await run.close()
    fields = h.questions[0].fields
    assert [(f.key, f.title, f.description, f.multi, f.options) for f in fields] == [
        ("question_0", "Colours", "Which colours do you like?", True, ["Red", "Blue", "Green"]),
        ("question_1", "Size", "Which size?", False, ["Small", "Large"]),
    ]
    reply = next(f for f in frames(tmp_path) if f.get("result", {}).get("action"))
    assert reply["result"]["content"] == {"question_0": ["Red", "Blue"], "question_1": "Large"}


async def test_question_none_cancels(tmp_path):
    h = Harness()
    h.question_answer = None
    run = make_run(h, tmp_path, [{"question": {"message": "?", "options": ["A"]}}])
    try:
        await run.start(tmp_path)
        await run.begin("default", "go")
        await finished(h)
    finally:
        await run.close()
    reply = next(f for f in frames(tmp_path) if f.get("result", {}).get("action"))
    assert reply["result"]["action"] == "cancel"


async def test_note_during_a_turn_becomes_the_next_prompt_and_the_job_waits_for_it(tmp_path):
    h = Harness()
    steps = [[{"text": "first"}, {"sleep": 0.5}], [{"text": "second"}]]
    run = make_run(h, tmp_path, steps)
    try:
        await run.start(tmp_path)
        await run.begin("default", "task")
        await until(lambda: h.progress)
        assert run.note("and also this") is True
        state = await finished(h)
    finally:
        await run.close()
    assert prompts(tmp_path) == ["task", "and also this"]
    assert state == ("done", "end_turn", "second")
    assert run.note("too late") is False
    assert prompts(tmp_path) == ["task", "and also this"]


async def test_stop_cancels_and_leaves_no_process(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [{"text": "working"}, {"hang": True}])
    try:
        await run.start(tmp_path)
        process = run.process
        await run.begin("default", "go")
        await until(lambda: h.progress)
        await run.stop()
        state = await finished(h)
    finally:
        await run.close()
    assert state[0] == "stopped"
    assert process.returncode is not None
    assert any(f.get("method") == "session/cancel" for f in frames(tmp_path))


async def test_adapter_crash_ends_in_error(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [{"text": "about to die"}, {"crash": 3}])
    try:
        await run.start(tmp_path)
        process = run.process
        await run.begin("default", "go")
        state = await finished(h)
    finally:
        await run.close()
    assert state[0] == "error"
    assert state[2] == "about to die"
    assert process.returncode is not None


async def test_child_env_drops_the_two_key_variables_and_keeps_the_rest(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-x")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok")
    h = Harness()
    run = make_run(h, tmp_path, [])
    try:
        await run.start(tmp_path)
    finally:
        await run.close()
    first = json.loads((tmp_path / "log.jsonl").read_text().splitlines()[0])["env"]
    assert first["ANTHROPIC_API_KEY"] is None
    assert first["ANTHROPIC_AUTH_TOKEN"] is None
    assert first["PATH_set"] is True


async def test_missing_command_is_a_fact_with_the_exe_and_no_install_hint(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [], command=["tagalong-no-such-adapter"])
    with pytest.raises(ExpertError) as err:
        await run.start(tmp_path)
    assert str(err.value) == "command not found: tagalong-no-such-adapter"


@pytest.mark.parametrize(
    ("expert_id", "gone", "kept"),
    [
        ("claude-acp", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"),
        ("codex-acp", "OPENAI_API_KEY", "GEMINI_API_KEY"),
        ("codex-acp", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"),
        ("codex-acp", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY"),
        ("gemini", "GEMINI_API_KEY", "OPENAI_API_KEY"),
        ("gemini", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"),
        ("custom", "ANTHROPIC_API_KEY", None),
        ("custom", "OPENAI_API_KEY", None),
    ],
)
async def test_each_expert_loses_its_own_keys_and_the_anthropic_pair(
    tmp_path, monkeypatch, expert_id, gone, kept
):
    for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.setenv(key, "secret")
    h = Harness()
    run = make_run(h, tmp_path, [], expert_id=expert_id)
    try:
        await run.start(tmp_path)
    finally:
        await run.close()
    env = json.loads((tmp_path / "log.jsonl").read_text().splitlines()[0])["env"]
    assert env[gone] is None
    if kept:
        assert env[kept] == "secret"


async def test_a_private_node_dir_goes_first_on_the_child_path_only(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", "/usr/bin")
    h = Harness()
    node_dir = tmp_path / "node"
    run = make_run(h, tmp_path, [], path_first=node_dir)
    try:
        await run.start(tmp_path)
    finally:
        await run.close()
    env = json.loads((tmp_path / "log.jsonl").read_text().splitlines()[0])["env"]
    assert env["PATH"] == str(node_dir) + os.pathsep + "/usr/bin"
    assert os.environ["PATH"] == "/usr/bin"


def test_the_factory_puts_a_private_nodes_dir_first_and_leaves_others_alone(tmp_path):
    from brain.setup.store import InstalledExpert

    def run_for(node):
        expert = InstalledExpert(
            "x", "x", "1", [str(tmp_path / "n" / "node.exe")], "registry", True, node
        )
        return ExpertHosts()(
            expert, on_permission=None, on_question=None, on_progress=None, on_end=None
        )

    assert run_for("private")._host._path_first == tmp_path / "n"
    assert run_for("system")._host._path_first is None
    assert run_for(None)._host._path_first is None


async def test_kill_tree_ends_a_process_that_ignores_stdin_close():
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "import time; time.sleep(60)",
        stdin=subprocess.PIPE,
    )
    await kill_tree(process)
    await asyncio.wait_for(process.wait(), 10)
    assert process.returncode is not None


async def test_close_from_inside_on_end_returns_at_once(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [{"text": "hi"}])

    async def close_it():
        await asyncio.wait_for(run.close(), 5)

    h.end_hook = close_it
    await run.start(tmp_path)
    await run.begin("default", "go")
    await finished(h)
    await asyncio.wait_for(run._task, 5)
    assert h.ends == [("done", "end_turn", "hi")]


async def test_start_gives_up_on_an_adapter_that_never_answers(tmp_path):
    h = Harness()
    patch.setenv("FAKE_ACP_HANG_INIT", "1")
    run = make_run(h, tmp_path, [], startup_timeout=0.5)
    with pytest.raises(ExpertError, match="did not answer"):
        await run.start(tmp_path)
    assert run.process.returncode is not None


async def test_stop_of_an_adapter_that_ignores_cancel_ends_once_after_the_process_is_gone(
    tmp_path,
):
    h = Harness()
    run = make_run(h, tmp_path, [{"text": "stuck"}, {"stubborn": True}], grace=0.5)
    await run.start(tmp_path)
    await run.begin("default", "go")
    await until(lambda: h.progress)
    await asyncio.wait_for(asyncio.gather(run.stop(), run.stop()), 15)
    assert run.process.returncode is not None
    await finished(h)
    await asyncio.sleep(0.2)
    assert h.ends == [("stopped", "stopped", "stuck")]
    assert h.gone_at_end == [True]


async def test_stop_while_a_permission_is_pending_answers_cancelled(tmp_path):
    h = Harness()
    never = asyncio.Event()

    async def wait_forever(request):
        h.permissions.append(request)
        await never.wait()

    h.on_permission = wait_forever
    run = make_run(h, tmp_path, [{"permission": {"title": "rm x"}}])
    await run.start(tmp_path)
    await run.begin("default", "go")
    await until(lambda: h.permissions)
    await asyncio.wait_for(run.stop(), 15)
    assert (await finished(h))[0] == "stopped"
    replies = [f for f in frames(tmp_path) if "outcome" in f.get("result", {})]
    assert replies and replies[0]["result"]["outcome"] == {"outcome": "cancelled"}


async def test_stop_while_a_question_is_pending_answers_cancel(tmp_path):
    h = Harness()
    never = asyncio.Event()

    async def wait_forever(question):
        h.questions.append(question)
        await never.wait()

    h.on_question = wait_forever
    run = make_run(h, tmp_path, [{"question": {"message": "?", "options": ["A"]}}])
    await run.start(tmp_path)
    await run.begin("default", "go")
    await until(lambda: h.questions)
    await asyncio.wait_for(run.stop(), 15)
    assert (await finished(h))[0] == "stopped"
    replies = [f for f in frames(tmp_path) if f.get("result", {}).get("action")]
    assert replies and replies[0]["result"]["action"] == "cancel"


async def test_stopping_a_stubborn_run_still_reports_stopped(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [{"stubborn": True}], grace=2)
    await run.start(tmp_path)
    await run.begin("default", "go")
    await asyncio.sleep(0.1)
    await asyncio.wait_for(run.stop(), 15)
    assert h.ends[0][:2] == ("stopped", "stopped")


async def test_on_end_failure_is_logged_not_raised_and_shutdown_failure_still_ends(tmp_path):
    h = Harness()

    async def boom():
        raise RuntimeError("callback bug")

    h.end_hook = boom
    run = make_run(h, tmp_path, [{"text": "x"}])
    await run.start(tmp_path)
    await run.begin("default", "go")
    await finished(h)
    await asyncio.wait_for(run.close(), 5)  # must not re-raise the callback's error

    h2 = Harness()
    run2 = make_run(h2, tmp_path, [{"text": "y"}])
    await run2.start(tmp_path)

    async def failing():
        raise OSError("teardown broke")

    run2._host._do_shutdown = failing
    await run2.begin("default", "go")
    await finished(h2)
    assert h2.ends[0][0] == "done"
    run2.process.kill()


async def test_spawn_failure_reports_the_real_error(tmp_path, monkeypatch):
    h = Harness()
    bad = tmp_path / "not-an-executable"
    bad.write_text("x")
    # which() would reject the file; the OS refusing to run it is the failure under test.
    monkeypatch.setattr("brain.experts.shutil.which", lambda name: str(bad))
    run = make_run(h, tmp_path, [], command=[str(bad)])
    with pytest.raises(OSError):
        await run.start(tmp_path)


async def test_note_is_refused_once_stopping(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [{"text": "a"}, {"hang": True}])
    await run.start(tmp_path)
    await run.begin("default", "go")
    await until(lambda: h.progress)
    stopping = asyncio.ensure_future(run.stop())
    await asyncio.sleep(0)
    assert run.note("late") is False
    await asyncio.wait_for(stopping, 15)


TOOL = {"tool": {"id": "t1", "title": "Run", "kind": "execute", "input": {"command": "ls"}}}


async def test_updates_before_begin_are_not_forwarded(tmp_path):
    h = Harness()
    patch.setenv("FAKE_ACP_LOAD", "1")
    patch.setenv("FAKE_ACP_REPLAY", "1")
    run = make_run(h, tmp_path, [TOOL])
    await run.start(tmp_path, resume="sess-old")  # the adapter replays an old tool call here
    await asyncio.sleep(0.2)
    assert h.updates == []
    await run.begin("default", "go")
    await finished(h)
    assert [u.tool_call_id for u in h.updates] == ["t1"]


async def test_update_is_dropped_while_the_run_is_not_active(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [TOOL])
    await run._update(object())
    assert h.updates == []
    run._active = True
    u = object()
    await run._update(u)
    assert h.updates == [u]


async def test_two_runs_on_one_adapter_get_only_their_own_updates(tmp_path):
    ha, hb = Harness(), Harness()
    script = tmp_path / "script.json"
    steps = [
        [{"sleep": 0.3}, {"tool": {"id": "a", "title": "a", "kind": "execute"}}],
        [{"tool": {"id": "b", "title": "b", "kind": "execute"}}],
    ]
    script.write_text(json.dumps(steps))  # one list per prompt
    patch.setenv("FAKE_ACP_SCRIPT", str(script))
    patch.setenv("FAKE_ACP_LOG", str(tmp_path / "log.jsonl"))
    host = ExpertHost([sys.executable, str(AGENT)], "custom", idle_s=0, grace=2)

    def run_for(h):
        h.run = ExpertRun(
            host=host,
            on_permission=h.on_permission,
            on_question=h.on_question,
            on_progress=h.on_progress,
            on_end=h.on_end,
            on_update=h.on_update,
            grace=2,
        )
        return h.run

    a, b = run_for(ha), run_for(hb)
    await a.start(tmp_path)
    await b.start(tmp_path)
    await a.begin("default", "first")
    await b.begin("default", "second")  # both prompts are in flight together
    await finished(ha)
    await finished(hb)
    assert [u.tool_call_id for u in ha.updates] == ["a"]
    assert [u.tool_call_id for u in hb.updates] == ["b"]


# --- the quiet clock: unit tests on a stub host and a fake clock, no subprocess ---


class StubHost:
    def __init__(self) -> None:
        self.process = SimpleNamespace(returncode=None)


async def quiet_run(clock: FakeClock, facts: list, quiet_s: float = 1200.0) -> ExpertRun:
    async def on_quiet(f):
        facts.append(f)

    async def noop(*a):
        return None

    run = ExpertRun(
        host=StubHost(),
        on_permission=noop,
        on_question=noop,
        on_progress=noop,
        on_end=noop,
        on_quiet=on_quiet,
        quiet_s=quiet_s,
        sleep=clock.sleep,
        clock=clock.clock,
    )
    run._active = True
    run._start_quiet()
    await asyncio.sleep(0)  # the sleeper registers its wait before the test moves time
    return run


def tool(id_, status="pending", **kw):
    return SimpleNamespace(
        session_update="tool_call",
        tool_call_id=id_,
        status=status,
        content=None,
        raw_output=None,
        **kw,
    )


def tool_update(id_, status="in_progress", content=None, raw_output=None, field_meta=None):
    return SimpleNamespace(
        session_update="tool_call_update",
        tool_call_id=id_,
        status=status,
        content=content,
        raw_output=raw_output,
        field_meta=field_meta,
    )


async def test_quiet_fires_after_the_threshold_with_no_activity():
    clock, facts = FakeClock(), []
    run = await quiet_run(clock, facts)
    await clock.advance(1199)
    assert facts == []
    await clock.advance(1)
    assert [(f.quiet_s, f.adapter_alive) for f in facts] == [(1200.0, True)]
    await run._stop_quiet()


async def test_heartbeat_updates_do_not_reset_the_clock():
    clock, facts = FakeClock(), []
    run = await quiet_run(clock, facts)
    await run._update(tool("a"))  # a step at t=0
    for _ in range(10):
        await clock.advance(100)
        await run._update(tool_update("a", "pending"))  # same status, no content
    await clock.advance(200)
    assert len(facts) == 1
    await run._stop_quiet()


@pytest.mark.parametrize(
    "update",
    [
        tool("b"),
        tool_update("a", "completed"),
        tool_update("a", "pending", content=[object()]),
        tool_update("a", "pending", raw_output="out"),
        SimpleNamespace(session_update="agent_message_chunk"),
        SimpleNamespace(session_update="plan"),
    ],
)
async def test_real_activity_resets_the_clock(update):
    clock, facts = FakeClock(), []
    run = await quiet_run(clock, facts)
    await run._update(tool("a"))
    await clock.advance(1000)
    await run._update(update)
    await clock.advance(200)  # t=1200: the first deadline passes, the reset one has not
    assert facts == []
    await clock.advance(1000)  # t=2200
    assert len(facts) == 1
    await run._stop_quiet()


async def test_it_rearms_a_full_threshold_after_the_emit():
    clock, facts = FakeClock(), []
    run = await quiet_run(clock, facts)
    await clock.advance(1200)
    assert len(facts) == 1
    await clock.advance(1199)
    assert len(facts) == 1
    await clock.advance(1)
    assert len(facts) == 2
    await run._stop_quiet()


async def test_it_does_not_fire_while_an_ask_is_open():
    clock, facts = FakeClock(), []
    run = await quiet_run(clock, facts)
    release = asyncio.Event()

    async def waiting(_):
        await release.wait()

    asking = asyncio.ensure_future(run._ask(waiting, None))
    await asyncio.sleep(0)
    await clock.advance(1200)
    await clock.advance(1199)  # t=2399: the ask is still open
    assert facts == []
    release.set()  # answered at t=2399, one second before a check
    await asking
    await clock.advance(1)  # t=2400: the check finds the answer only just given
    assert facts == []
    await clock.advance(1198)  # t=3598
    assert facts == []
    await clock.advance(1)  # t=3599: a full threshold after the answer at 2399
    assert len(facts) == 1
    await run._stop_quiet()


async def test_the_sleeper_is_cancelled_when_the_run_ends():
    clock, facts = FakeClock(), []
    run = await quiet_run(clock, facts)
    task = run._quiet_task
    await run._stop_quiet()
    assert task.done()
    await clock.advance(5000)
    assert facts == []


async def test_adapter_alive_reflects_the_process():
    clock, facts = FakeClock(), []
    run = await quiet_run(clock, facts)
    run._host.process.returncode = 1
    await clock.advance(1200)
    assert facts[0].adapter_alive is False
    await run._stop_quiet()


async def test_a_failing_on_quiet_is_logged_and_the_clock_keeps_running():
    clock = FakeClock()
    calls = []

    async def boom(f):
        calls.append(f)
        raise RuntimeError("bug")

    async def noop(*a):
        return None

    run = ExpertRun(
        host=StubHost(),
        on_permission=noop,
        on_question=noop,
        on_progress=noop,
        on_end=noop,
        on_quiet=boom,
        quiet_s=10,
        sleep=clock.sleep,
        clock=clock.clock,
    )
    run._active = True
    run._start_quiet()
    await asyncio.sleep(0)
    await clock.advance(10)
    await clock.advance(10)
    assert len(calls) == 2
    await run._stop_quiet()


async def test_a_run_without_on_quiet_starts_no_sleeper():
    async def noop(*a):
        return None

    run = ExpertRun(
        host=StubHost(), on_permission=noop, on_question=noop, on_progress=noop, on_end=noop
    )
    run._start_quiet()
    assert run._quiet_task is None


async def test_cancelling_the_run_does_not_leak_the_sleeper():
    clock, facts = FakeClock(), []
    run = await quiet_run(clock, facts)

    async def hang(**kw):
        await asyncio.Event().wait()

    run._host.conn = SimpleNamespace(prompt=hang)
    sleeper = run._quiet_task
    driving = asyncio.ensure_future(run._drive("go"))
    await asyncio.sleep(0)
    driving.cancel()
    with pytest.raises(asyncio.CancelledError):
        await driving
    assert sleeper.done()
