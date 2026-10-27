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

    async def on_permission(self, request):
        self.permissions.append(request)
        return self.permission_answer

    async def on_question(self, question: Question):
        self.questions.append(question)
        return self.question_answer

    async def on_progress(self, text: str) -> None:
        self.progress.append(text)

    async def on_end(self, state: str, reason: str, result: str | None) -> None:
        self.ended.set_result((state, reason, result))


def make_run(h: Harness, tmp_path: Path, steps, timeout: float = 30, command=None) -> ExpertRun:
    script = tmp_path / "script.json"
    script.write_text(json.dumps(steps))
    # The fake reads its script and log from the environment it inherits through the runner.
    patch.setenv("FAKE_ACP_SCRIPT", str(script))
    patch.setenv("FAKE_ACP_LOG", str(tmp_path / "log.jsonl"))
    return ExpertRun(
        command=command or [sys.executable, str(AGENT)],
        timeout=timeout,
        grace=2,
        on_permission=h.on_permission,
        on_question=h.on_question,
        on_progress=h.on_progress,
        on_end=h.on_end,
    )


patch = pytest.MonkeyPatch()


@pytest.fixture(autouse=True)
def undo_env():
    yield
    patch.undo()


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
        while not h.progress:
            await asyncio.sleep(0.01)
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
        while not h.progress:
            await asyncio.sleep(0.01)
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
