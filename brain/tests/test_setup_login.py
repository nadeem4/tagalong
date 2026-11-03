"""Checks expert login on fakes only: the fake ACP agent and a fake terminal opener.

No real window, browser, network or login. The fake opener records what it was asked to run and
writes the done file the way the real window's wrapper does.
"""

import asyncio
import json
import os
import shutil
import sys
from pathlib import Path

import pytest

from brain.events import Event
from brain.protocol import RpcError
from brain.setup.env import expert_env
from brain.setup.login import (
    Failed,
    LoggedIn,
    LoginDriver,
    NotLoggedIn,
    Unknown,
    Waiting,
    pick_method,
)
from brain.setup.store import ExpertStore, InstalledExpert
from brain.setup.terminal import NoTerminal, real_open_terminal, terminal_line

FAKE = str(Path(__file__).parent / "fake_acp_agent.py")
TERMINAL = {
    "id": "claude-ai-login",
    "name": "Claude subscription",
    "type": "terminal",
    "args": ["--cli", "auth"],
}
KEY = {"id": "api-key", "name": "API key", "type": "terminal", "args": ["--key"]}
BROWSER = {"id": "chat-gpt", "name": "ChatGPT"}
GPT_KEY = {"id": "api-key", "name": "API key"}


def expert(command=None, id="claude-acp") -> InstalledExpert:
    cmd = command or [sys.executable, FAKE]
    return InstalledExpert(id, "Claude Code", "1", cmd, "registry", None)


class Window:
    """A fake OpenTerminal: remembers the call, writes the done file, may finish a login."""

    def __init__(self, marker: Path | None = None, code: str = "0", write: bool = True) -> None:
        self.calls: list[tuple[list[str], dict, Path]] = []
        self.marker, self.code, self.write = marker, code, write

    async def __call__(self, argv, env, done_file: Path) -> None:
        self.calls.append((argv, dict(env), done_file))
        if self.marker:
            self.marker.write_text("x")
        if self.write:
            done_file.write_text(self.code)


@pytest.fixture
def env(tmp_path, monkeypatch):
    marker = tmp_path / "logged-in"
    monkeypatch.setenv("FAKE_ACP_LOGIN_FILE", str(marker))
    monkeypatch.delenv("FAKE_ACP_LOGGED_IN", raising=False)
    monkeypatch.setenv("FAKE_ACP_AUTH", json.dumps([TERMINAL, KEY]))
    return marker


def driver(
    tmp_path, window, timeout_s=10.0, notify=None
) -> tuple[LoginDriver, list[Event], ExpertStore]:
    store = ExpertStore(tmp_path)
    store.add(expert())
    events: list[Event] = []
    return (
        LoginDriver(
            tmp_path, store, window, events.append, timeout_s=timeout_s, poll_s=0.01, notify=notify
        ),
        events,
        store,
    )


async def until(condition, timeout: float = 15) -> None:
    async with asyncio.timeout(timeout):
        while not condition():
            await asyncio.sleep(0.02)


async def test_already_logged_in_is_detected_without_opening_anything(tmp_path, env, monkeypatch):
    env.write_text("x")
    window = Window()
    d, events, store = driver(tmp_path, window)
    assert await d.check(expert()) == LoggedIn()
    assert await d.start(expert()) == LoggedIn()
    assert window.calls == [] and events == []
    assert store.get("claude-acp").logged_in is True


async def test_a_temp_folder_that_will_not_delete_does_not_hide_a_logged_in_check(
    tmp_path, env, monkeypatch
):
    # Windows: the adapter still holds the scratch folder, so cleanup raises WinError 32.
    env.write_text("x")

    def locked(path, *args, **kwargs):
        # What the real rmtree does: hand the PermissionError to the caller's handler.
        err = PermissionError(32, "in use")
        handler = kwargs.get("onexc") or kwargs.get("onerror")
        if handler is None:
            raise err
        handler(os.unlink, path, err if "onexc" in kwargs else (PermissionError, err, None))

    monkeypatch.setattr(shutil, "rmtree", locked)
    d, _, _ = driver(tmp_path, Window())
    assert await d.check(expert()) == LoggedIn()


async def test_start_when_already_logged_in_tells_the_ui_and_opens_nothing(tmp_path, env):
    env.write_text("x")
    window, told = Window(), []
    d, _, store = driver(tmp_path, window, notify=lambda *a: told.append(a))
    assert await d.start(expert()) == LoggedIn()
    assert window.calls == [] and store.get("claude-acp").logged_in is True
    assert told == [("changed", {"what": "setup"})]


async def test_the_end_of_a_login_tells_the_ui_to_reload(tmp_path, env):
    told = []
    d, events, _ = driver(tmp_path, Window(marker=env), notify=lambda *a: told.append(a))
    await d.start(expert())
    await until(lambda: events)
    assert told == [("changed", {"what": "setup"})]


async def test_a_login_tool_reports_already_logged_in(tmp_path, env):
    env.write_text("x")
    d, _, _ = driver(tmp_path, Window())
    _, handler = login_tools(tmp_path, d)[0]
    assert json.loads(await handler({"id": "claude-acp"})) == {"state": "logged_in"}


async def test_terminal_method_opens_the_window_with_adapter_command_args_and_env(
    tmp_path, env, monkeypatch
):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-secret")
    window = Window(marker=env)
    d, events, _ = driver(tmp_path, window)
    assert await d.start(expert()) == Waiting("terminal")
    await until(lambda: events)
    argv, window_env, done_file = window.calls[0]
    assert argv == [sys.executable, FAKE, "--cli", "auth"]
    assert "ANTHROPIC_API_KEY" not in window_env and "PATH" in window_env
    assert done_file.parent == tmp_path / "cache"


async def test_after_the_window_closes_the_login_is_rechecked_and_recorded(tmp_path, env):
    d, events, store = driver(tmp_path, Window(marker=env))
    await d.start(expert())
    await until(lambda: events)
    assert events == [
        Event("setup_login", {"expert": "claude-acp", "state": "logged_in"}, key="claude-acp")
    ]
    assert store.get("claude-acp").logged_in is True


async def test_a_window_closed_before_login_records_not_logged_in_with_failed_facts(tmp_path, env):
    d, events, store = driver(tmp_path, Window(code="1"))
    await d.start(expert())
    await until(lambda: events)
    facts = events[0].facts
    assert facts["state"] == "failed" and "1" in str(facts["detail"])
    assert store.get("claude-acp").logged_in is False


async def test_a_browser_method_calls_authenticate_and_records_the_result(
    tmp_path, env, monkeypatch
):
    monkeypatch.setenv("FAKE_ACP_AUTH", json.dumps([GPT_KEY, BROWSER]))
    window = Window()
    d, events, store = driver(tmp_path, window)
    assert await d.start(expert()) == Waiting("browser")
    await until(lambda: events)
    assert env.read_text() == "chat-gpt"  # the fake's authenticate got the browser method id
    assert events[0].facts["state"] == "logged_in" and window.calls == []
    assert store.get("claude-acp").logged_in is True


async def test_an_api_key_method_is_never_picked(tmp_path, env, monkeypatch):
    monkeypatch.setenv("FAKE_ACP_AUTH", json.dumps([GPT_KEY]))
    d, events, _ = driver(tmp_path, Window())
    state = await d.start(expert())
    assert isinstance(state, Failed) and events == []
    methods = (await d.check(expert())).methods
    assert pick_method(methods) is None


async def test_no_terminal_raises_the_command_for_the_person_to_run(tmp_path, env):
    async def nowhere(argv, env, done_file):
        raise NoTerminal(argv)

    d, events, _ = driver(tmp_path, nowhere)
    with pytest.raises(NoTerminal) as err:
        await d.start(expert())
    assert FAKE in err.value.command and "--cli" in err.value.command
    assert events == []


async def test_a_second_login_for_the_same_expert_cancels_the_first(tmp_path, env):
    window = Window(write=False)  # the first window never closes
    d, events, _ = driver(tmp_path, window)
    await d.start(expert())
    window.write, window.marker = True, env
    await d.start(expert())
    await until(lambda: events)
    await asyncio.sleep(0.1)
    assert len(events) == 1 and events[0].facts["state"] == "logged_in"


async def test_no_methods_and_a_failing_adapter_reports_unknown(tmp_path):
    d, _, _ = driver(tmp_path, Window())
    bad = expert([sys.executable, "-c", "pass"])
    assert await d.check(bad) == Unknown()
    assert await d.start(bad) == Unknown()


async def test_login_required_with_no_methods_is_not_logged_in_without_methods(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("FAKE_ACP_AUTH", "[]")
    monkeypatch.delenv("FAKE_ACP_LOGGED_IN", raising=False)
    d, _, _ = driver(tmp_path, Window())
    assert await d.check(expert()) == NotLoggedIn([])
    assert isinstance(await d.start(expert()), Failed)


async def test_the_done_file_wait_times_out_and_emits_one_event(tmp_path, env):
    d, events, store = driver(tmp_path, Window(write=False), timeout_s=0.2)
    await d.start(expert())
    await until(lambda: events)
    await asyncio.sleep(0.1)
    assert len(events) == 1 and events[0].facts["state"] == "failed"
    assert events[0].facts["detail"] == "timeout"
    assert store.get("claude-acp").logged_in is None


async def test_the_check_strips_the_expert_keys_from_the_child(tmp_path, env, monkeypatch):
    log = tmp_path / "frames.jsonl"
    monkeypatch.setenv("FAKE_ACP_LOG", str(log))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-secret")
    d, _, _ = driver(tmp_path, Window())
    await d.check(expert())
    first = json.loads(log.read_text().splitlines()[0])
    assert first["env"]["ANTHROPIC_API_KEY"] is None and first["env"]["PATH_set"] is True


async def test_stop_cancels_a_waiting_login(tmp_path, env):
    d, events, _ = driver(tmp_path, Window(write=False))
    await d.start(expert())
    await d.stop()
    assert events == []


def test_expert_env_strips_per_expert_and_unknown_ids_get_every_key():
    base = {"PATH": "p", "ANTHROPIC_API_KEY": "a", "OPENAI_API_KEY": "o", "GEMINI_API_KEY": "g"}
    assert expert_env("claude-acp", base) == {
        "PATH": "p",
        "OPENAI_API_KEY": "o",
        "GEMINI_API_KEY": "g",
    }
    assert expert_env("codex-acp", base) == {"PATH": "p", "GEMINI_API_KEY": "g"}
    assert expert_env("someone-else", base) == {"PATH": "p"}


def test_terminal_line_waits_for_the_command_and_writes_its_exit_code():
    line = terminal_line(["C:\\Program Files\\node.exe", "cli.js", "login"], Path("C:/h/done.txt"))
    assert '"C:\\Program Files\\node.exe" cli.js login' in line
    assert "!errorlevel!" in line and line.rstrip().endswith('"')


async def test_real_opener_refuses_where_there_is_no_window(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    with pytest.raises(NoTerminal) as err:
        await real_open_terminal(["tool", "login"], os.environ, tmp_path / "d")
    assert err.value.command == "tool login"


# --- the Scout tool -----------------------------------------------------------------------


async def test_login_tool_is_a_change_that_asks_and_shows_the_method(tmp_path, env):
    window = Window(marker=env)
    d, events, _ = driver(tmp_path, window)
    tools = login_tools(tmp_path, d)
    spec, handler = tools[0]
    assert spec.name == "login_expert" and spec.effect == "change" and spec.person_only
    assert await spec.card({"id": "claude-acp"}) == {
        "expert": "claude-acp",
        "method": "claude-ai-login",
        "opens": "terminal window",
    }
    result = json.loads(await handler({"id": "claude-acp"}))
    assert result == {"state": "waiting", "kind": "terminal"}
    await until(lambda: events)


async def test_login_tool_says_no_terminal_with_the_command(tmp_path, env):
    async def nowhere(argv, env, done_file):
        raise NoTerminal(argv)

    d, _, _ = driver(tmp_path, nowhere)
    _, handler = login_tools(tmp_path, d)[0]
    out = json.loads(await handler({"id": "claude-acp"}))
    assert out["error"] == "no_terminal" and "--cli" in out["command"]


async def test_login_tool_card_refuses_an_unknown_expert_and_a_finished_login(tmp_path, env):
    d, _, _ = driver(tmp_path, Window())
    spec, _ = login_tools(tmp_path, d)[0]
    with pytest.raises(RpcError):
        await spec.card({"id": "nobody"})
    env.write_text("x")
    with pytest.raises(RpcError):
        await spec.card({"id": "claude-acp"})


async def test_a_card_that_finds_the_login_done_records_it_and_tells_the_ui(tmp_path, env):
    # Home's Log in opens the card first; an already-done login must still flip the chip.
    env.write_text("x")
    told = []
    d, _, store = driver(tmp_path, Window(), notify=lambda *a: told.append(a))
    store.set_login("claude-acp", None)
    spec, _ = login_tools(tmp_path, d)[0]
    with pytest.raises(RpcError, match="already_logged_in"):
        await spec.card({"id": "claude-acp"})
    assert store.get("claude-acp").logged_in is True
    assert told == [("changed", {"what": "setup"})]


def login_tools(tmp_path, d):
    from brain.setup.expert_tools import login_tools as make

    return make(tmp_path, d)


# --- review fixes -------------------------------------------------------------------------


def test_terminal_line_refuses_characters_cmd_would_act_on():
    with pytest.raises(NoTerminal):
        terminal_line(["tool", "login"], Path("C:/R&D/done.txt"))
    with pytest.raises(NoTerminal):
        terminal_line(["tool", "100%"], Path("C:/h/done.txt"))


async def test_closing_the_window_writes_a_closed_marker(tmp_path, monkeypatch):
    class FakeProc:
        def wait(self):
            return 1  # the window went away without cmd writing the done file

    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr("brain.setup.terminal.subprocess.Popen", lambda *a, **k: FakeProc())
    done = tmp_path / "cache" / "d.done"
    await real_open_terminal(["tool", "login"], os.environ, done)
    await until(lambda: done.exists() and done.read_text() == "closed", timeout=5)


async def test_a_closed_window_ends_the_login_as_failed(tmp_path, env):
    d, events, _ = driver(tmp_path, Window(code="closed"))
    await d.start(expert())
    await until(lambda: events)
    assert events[0].facts["state"] == "failed" and "closed" in str(events[0].facts["detail"])


async def test_each_start_gets_its_own_done_file(tmp_path, env):
    window = Window(write=False)
    d, _, _ = driver(tmp_path, window)
    await d.start(expert())
    await d.start(expert())
    assert window.calls[0][2] != window.calls[1][2]
    await d.stop()


async def test_a_failed_second_start_leaves_the_first_login_running(tmp_path, env):
    window = Window(write=False)
    d, events, _ = driver(tmp_path, window)
    await d.start(expert())
    d._open = _no_terminal
    with pytest.raises(NoTerminal):
        await d.start(expert())
    env.write_text("x")  # the person logs in
    window.calls[0][2].write_text("0")
    await until(lambda: events)
    assert events[0].facts["state"] == "logged_in"


async def _no_terminal(argv, env, done_file):
    raise NoTerminal(argv)


async def test_a_store_failure_ends_the_login_as_failed(tmp_path, env, monkeypatch):
    d, events, store = driver(tmp_path, Window(marker=env))

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(store, "set_login", boom)
    await d.start(expert())
    await until(lambda: events)
    assert events[0].facts["state"] == "failed" and "disk full" in str(events[0].facts["detail"])


async def test_login_card_says_unknown_when_the_check_is_unknown(tmp_path):
    d, _, _ = driver(tmp_path, Window())
    ExpertStore(tmp_path).add(expert([sys.executable, "-c", "pass"], id="broken"))
    spec, _ = login_tools(tmp_path, d)[0]
    with pytest.raises(RpcError) as err:
        await spec.card({"id": "broken"})
    assert "unknown" in str(err.value) and "no_login_method" not in str(err.value)


async def test_an_empty_done_file_is_waited_on_not_read_as_success(tmp_path):
    # The writer creates the file before its text lands; an empty read must not pass as code 0.
    d, _, _ = driver(tmp_path, Window())
    done = tmp_path / "d.done"
    done.write_text("")

    async def fill() -> None:
        await asyncio.sleep(0.05)
        done.write_text("closed")

    filler = asyncio.ensure_future(fill())
    assert await d._wait_window(done) == "the window ended with exit code closed"
    await filler
