"""Checks ExpertRun against the scripted fake ACP agent (no Node, no network, no Claude).

Each test spawns tests/fake_acp_agent.py as the adapter. The fake logs every frame the
runner sends, so tests read that log to see the prompts, mode and replies that arrived.
"""

import asyncio
import json
import subprocess
import sys
from pathlib import Path

import pytest

from brain.experts import ExpertError, ExpertRun, Question, kill_tree

AGENT = Path(__file__).parent / "fake_acp_agent.py"


class Harness:
    """Collects callbacks; answers asks from fields the test sets."""

    def __init__(self) -> None:
        self.permissions: list = []
        self.questions: list = []
        self.progress: list[str] = []
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

    async def on_end(self, state: str, reason: str, result: str | None) -> None:
        self.ends.append((state, reason, result))
        process = self.run.process
        self.gone_at_end.append(process is not None and process.returncode is not None)
        if not self.ended.done():
            self.ended.set_result((state, reason, result))
        if self.end_hook:
            await self.end_hook()


def make_run(
    h: Harness, tmp_path: Path, steps, timeout: float = 30, command=None, **options
) -> ExpertRun:
    script = tmp_path / "script.json"
    script.write_text(json.dumps(steps))
    # The fake reads its script and log from the environment it inherits through the runner.
    patch.setenv("FAKE_ACP_SCRIPT", str(script))
    patch.setenv("FAKE_ACP_LOG", str(tmp_path / "log.jsonl"))
    options = {"grace": 2, **options}
    h.run = ExpertRun(
        command=command or [sys.executable, str(AGENT)],
        timeout=timeout,
        on_permission=h.on_permission,
        on_question=h.on_question,
        on_progress=h.on_progress,
        on_end=h.on_end,
        **options,
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


async def test_timeout_ends_in_error_and_the_process_is_gone(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [{"hang": True}], timeout=0.5)
    try:
        await run.start(tmp_path)
        process = run.process
        await run.begin("default", "go")
        state = await finished(h)
    finally:
        await run.close()
    assert state[:2] == ("error", "timeout")
    assert process.returncode is not None


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


async def test_missing_command_names_it_and_the_install_step(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [], command=["tagalong-no-such-adapter"])
    with pytest.raises(ExpertError) as err:
        await run.start(tmp_path)
    text = str(err.value)
    assert "tagalong-no-such-adapter" in text
    assert "npm install -g @agentclientprotocol/claude-agent-acp" in text


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


async def test_timeout_during_the_stop_grace_still_reports_stopped(tmp_path):
    h = Harness()
    run = make_run(h, tmp_path, [{"stubborn": True}], timeout=0.5, grace=2)
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

    run2._do_shutdown = failing
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
