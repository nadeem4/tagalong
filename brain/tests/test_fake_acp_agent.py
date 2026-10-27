"""Checks the scripted fake ACP agent that every expert test talks to.

Each test spawns tests/fake_acp_agent.py with the acp package's client side, the way
the runner will spawn the real adapter, so a passing run means the fake speaks ACP.
"""

import asyncio
import json
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import acp
import pytest
from acp.schema import (
    AcceptElicitationResponse,
    AllowedOutcome,
    CancelElicitationResponse,
    ClientCapabilities,
    DeniedOutcome,
    ElicitationCapabilities,
    ElicitationFormCapabilities,
    RequestPermissionResponse,
    TextContentBlock,
)

AGENT = Path(__file__).parent / "fake_acp_agent.py"


class Recorder:
    """A client that records updates and answers asks from queued replies."""

    def __init__(self, permission=None, elicitation=None) -> None:
        self.updates: list = []
        self.permission = permission or RequestPermissionResponse(
            outcome=AllowedOutcome(outcome="selected", option_id="allow-once")
        )
        self.elicitation = elicitation or AcceptElicitationResponse(
            action="accept", content={"question_0": "Red"}
        )

    def on_connect(self, conn) -> None:
        pass

    async def session_update(self, session_id, update, **kw) -> None:
        self.updates.append(update)

    async def request_permission(self, session_id, tool_call, options, **kw):
        return self.permission

    async def create_elicitation(self, message, mode, **kw):
        return self.elicitation

    async def ext_method(self, method, params):
        return {}

    async def ext_notification(self, method, params) -> None:
        pass

    def texts(self) -> list[str]:
        return [u.content.text for u in self.updates if u.session_update == "agent_message_chunk"]


@asynccontextmanager
async def running(tmp_path: Path, steps: list[dict], client: Recorder | None = None):
    script = tmp_path / "script.json"
    script.write_text(json.dumps(steps))
    log = tmp_path / "log.jsonl"
    client = client or Recorder()
    async with acp.spawn_agent_process(
        client,
        sys.executable,
        str(AGENT),
        env={"FAKE_ACP_SCRIPT": str(script), "FAKE_ACP_LOG": str(log)},
        use_unstable_protocol=True,
    ) as (conn, process):
        caps = ClientCapabilities(
            elicitation=ElicitationCapabilities(form=ElicitationFormCapabilities())
        )
        await conn.initialize(protocol_version=1, client_capabilities=caps)
        yield conn, process, client, log


def logged(log: Path) -> list[dict]:
    return [f for f in _all_lines(log) if "env" not in f]


def _all_lines(log: Path) -> list[dict]:
    return [json.loads(line) for line in log.read_text().splitlines()]


def prompt_blocks(text: str) -> list[TextContentBlock]:
    return [TextContentBlock(type="text", text=text)]


async def test_new_session_lists_the_five_modes(tmp_path):
    async with running(tmp_path, []) as (conn, _process, _client, _log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        assert session.modes.current_mode_id == "default"
        assert [m.id for m in session.modes.available_modes] == [
            "default",
            "acceptEdits",
            "plan",
            "auto",
            "bypassPermissions",
        ]


async def test_prompt_replays_text_steps_and_stop_reason(tmp_path):
    steps = [{"text": "Hel"}, {"text": "lo."}, {"end": "end_turn"}]
    async with running(tmp_path, steps) as (conn, _process, client, _log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        result = await conn.prompt(prompt=prompt_blocks("say hi"), session_id=session.session_id)
        assert client.texts() == ["Hel", "lo."]
        assert result.stop_reason == "end_turn"


async def test_log_holds_the_prompt_text_and_the_set_mode(tmp_path):
    async with running(tmp_path, [{"end": "end_turn"}]) as (conn, _process, _client, log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        await conn.set_session_mode(mode_id="plan", session_id=session.session_id)
        await conn.prompt(prompt=prompt_blocks("do the thing"), session_id=session.session_id)
    frames = logged(log)
    methods = [f.get("method") for f in frames]
    assert methods[:2] == ["initialize", "session/new"]
    assert (
        next(f for f in frames if f.get("method") == "session/set_mode")["params"]["modeId"]
        == "plan"
    )
    sent = next(f for f in frames if f.get("method") == "session/prompt")
    assert sent["params"]["prompt"][0]["text"] == "do the thing"


async def test_permission_step_waits_for_the_reply_and_logs_it(tmp_path):
    steps = [
        {"permission": {"title": "ls -la", "kind": "execute"}},
        {"text": "done"},
        {"end": "end_turn"},
    ]
    async with running(tmp_path, steps) as (conn, _process, client, log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        await conn.prompt(prompt=prompt_blocks("go"), session_id=session.session_id)
        assert client.texts() == ["done"]
    reply = next(f for f in logged(log) if "result" in f and "outcome" in f["result"])
    assert reply["result"]["outcome"] == {"outcome": "selected", "optionId": "allow-once"}


async def test_rejected_permission_is_logged_too(tmp_path):
    denied = RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))
    steps = [{"permission": {"title": "rm x"}}, {"end": "end_turn"}]
    async with running(tmp_path, steps, Recorder(permission=denied)) as (conn, _p, _c, log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        await conn.prompt(prompt=prompt_blocks("go"), session_id=session.session_id)
    reply = next(f for f in logged(log) if "result" in f and "outcome" in f["result"])
    assert reply["result"]["outcome"] == {"outcome": "cancelled"}


async def test_question_step_sends_a_form_elicitation_and_logs_the_answer(tmp_path):
    steps = [
        {"question": {"message": "Which colour?", "options": ["Red", "Blue"]}},
        {"end": "end_turn"},
    ]
    seen = {}

    class Asked(Recorder):
        async def create_elicitation(self, message, mode, **kw):
            seen["message"] = message
            seen["properties"] = mode.requested_schema.properties
            return await super().create_elicitation(message, mode, **kw)

    async with running(tmp_path, steps, Asked()) as (conn, _process, _client, log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        await conn.prompt(prompt=prompt_blocks("go"), session_id=session.session_id)
    assert seen["message"] == "Which colour?"
    assert set(seen["properties"]) == {"question_0", "question_0_custom"}
    reply = next(f for f in logged(log) if f.get("result", {}).get("action"))
    assert reply["result"] == {"action": "accept", "content": {"question_0": "Red"}}


async def test_declined_question_is_logged(tmp_path):
    steps = [{"question": {"message": "?", "options": ["A"]}}, {"end": "end_turn"}]
    cancelled = CancelElicitationResponse(action="cancel")
    async with running(tmp_path, steps, Recorder(elicitation=cancelled)) as (conn, _p, _c, log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        await conn.prompt(prompt=prompt_blocks("go"), session_id=session.session_id)
    reply = next(f for f in logged(log) if f.get("result", {}).get("action"))
    assert reply["result"]["action"] == "cancel"


async def test_cancel_ends_a_running_prompt_with_cancelled(tmp_path):
    steps = [{"text": "working"}, {"hang": True}, {"text": "never"}, {"end": "end_turn"}]
    async with running(tmp_path, steps) as (conn, _process, client, log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        pending = asyncio.ensure_future(
            conn.prompt(prompt=prompt_blocks("go"), session_id=session.session_id)
        )
        while not client.texts():
            await asyncio.sleep(0.01)
        await conn.cancel(session_id=session.session_id)
        result = await asyncio.wait_for(pending, 10)
        assert result.stop_reason == "cancelled"
        assert client.texts() == ["working"]
    assert any(f.get("method") == "session/cancel" for f in logged(log))


async def test_fake_exits_when_stdin_closes(tmp_path):
    async with running(tmp_path, []) as (_conn, process, _client, _log):
        process.stdin.close()
        code = await asyncio.wait_for(process.wait(), 10)
        assert code == 0


async def test_no_script_means_prompts_end_immediately(tmp_path):
    # A bare fake still completes a turn, so tests that only need a handshake stay short.
    log = tmp_path / "log.jsonl"
    async with acp.spawn_agent_process(
        Recorder(), sys.executable, str(AGENT), env={"FAKE_ACP_LOG": str(log)}
    ) as (conn, _process):
        await conn.initialize(protocol_version=1)
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        result = await conn.prompt(prompt=prompt_blocks("x"), session_id=session.session_id)
        assert result.stop_reason == "end_turn"


async def test_crash_step_kills_the_process_mid_prompt(tmp_path):
    steps = [{"text": "about to die"}, {"crash": 3}, {"text": "never"}]
    async with running(tmp_path, steps) as (conn, process, client, _log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        with pytest.raises(ConnectionError):
            await conn.prompt(prompt=prompt_blocks("go"), session_id=session.session_id)
        assert await asyncio.wait_for(process.wait(), 10) == 3
        assert client.texts() == ["about to die"]


async def test_first_log_line_reports_key_variables_and_inherited_path(tmp_path):
    script = tmp_path / "script.json"
    script.write_text("[]")
    log = tmp_path / "log.jsonl"
    env = {
        "FAKE_ACP_SCRIPT": str(script),
        "FAKE_ACP_LOG": str(log),
        "ANTHROPIC_API_KEY": "sk-x",
        "ANTHROPIC_AUTH_TOKEN": "tok",
    }
    async with acp.spawn_agent_process(Recorder(), sys.executable, str(AGENT), env=env) as (
        conn,
        _process,
    ):
        await conn.initialize(protocol_version=1)
    first = _all_lines(log)[0]["env"]
    assert first["ANTHROPIC_API_KEY"] == "sk-x"
    assert first["ANTHROPIC_AUTH_TOKEN"] == "tok"
    assert first["PATH_set"] is True


async def test_list_of_lists_script_gives_each_prompt_its_own_steps(tmp_path):
    steps = [[{"text": "one"}], [{"text": "two"}, {"sleep": 0.05}]]
    async with running(tmp_path, steps) as (conn, _process, client, _log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        for _ in range(3):
            await conn.prompt(prompt=prompt_blocks("go"), session_id=session.session_id)
        assert client.texts() == ["one", "two", "two"]


async def test_a_late_cancel_does_not_cancel_the_next_prompt(tmp_path):
    steps = [{"text": "again"}, {"end": "end_turn"}]
    async with running(tmp_path, steps) as (conn, _process, client, _log):
        session = await conn.new_session(cwd=str(tmp_path), mcp_servers=[])
        await conn.prompt(prompt=prompt_blocks("one"), session_id=session.session_id)
        await conn.cancel(session_id=session.session_id)
        result = await conn.prompt(prompt=prompt_blocks("two"), session_id=session.session_id)
        assert result.stop_reason == "end_turn"
        assert client.texts() == ["again", "again"]
