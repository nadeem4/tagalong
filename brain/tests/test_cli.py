"""Checks the `tagalong` CLI on fakes only: fake registry bytes, fake downloads, fake runner,
fake terminal and the fake ACP agent. No network, install, window or API call happens here.
"""

import asyncio
import io
import json
import shutil
import socket
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from brain import cli
from brain.memory import Memory
from brain.setup import install as install_mod
from brain.setup.facts import CmdResult, Machine, NodePaths, ToolVersion
from brain.setup.paths import cache_file, node_dir
from brain.setup.store import ExpertStore, InstalledExpert
from brain.setup.terminal import NoTerminal

FIX = Path(__file__).parent / "fixtures"
ACP = (FIX / "acp-registry.sample.json").read_bytes()
NODE_INDEX = (FIX / "node-index.sample.json").read_bytes()
FAKE = str(Path(__file__).parent / "fake_acp_agent.py")
MCP = json.dumps(
    {
        "servers": [
            {
                "server": {
                    "name": "acme/cloud",
                    "title": "cloud",
                    "version": "1.0",
                    "remotes": [{"type": "streamable-http", "url": "https://c.test/mcp"}],
                }
            },
            {
                "server": {
                    "name": "acme/notes",
                    "title": "notes",
                    "version": "1.2.3",
                    "packages": [
                        {
                            "registryType": "npm",
                            "identifier": "@acme/notes",
                            "version": "1.2.3",
                            "environmentVariables": [{"name": "ACME_KEY", "isRequired": True}],
                        }
                    ],
                }
            },
        ]
    }
).encode()
LOGIN_AUTH = json.dumps(
    [{"id": "claude-ai-login", "name": "C", "type": "terminal", "args": ["--a"]}]
)


def machine(node=None) -> Machine:
    return Machine("windows", "x64", node, None, None, ToolVersion("2.4.0", "git"), None)


class Rig:
    """Everything main() needs, faked, plus the lines it printed and the answers it was given."""

    def __init__(self, tmp_path, answers=(), offline=False, mach=None):
        self.home = tmp_path
        self.lines: list[str] = []
        self.answers = list(answers)
        self.asked: list[str] = []
        self.offline = offline
        self.mach = mach or machine()

    async def get_json(self, url: str) -> bytes:
        if self.offline:
            raise OSError("offline")
        if url.endswith("index.json"):
            return NODE_INDEX
        return MCP if "modelcontextprotocol" in url else ACP

    async def run(self, argv, env, cwd):
        return CmdResult(0, "", "")

    async def inspect_fn(self):
        private = node_dir(self.home) / "node.exe"  # a fake download leaves this behind
        if private.exists():
            return replace(self.mach, private_node=ToolVersion("22.12.0", str(private)))
        return self.mach

    def out(self, line="") -> None:
        self.lines.append(str(line))

    def ask(self, prompt: str) -> str:
        self.asked.append(prompt)
        return self.answers.pop(0)

    def go(self, *argv, stdin="", env=None, **kw) -> int:
        async def no_fetch(url):
            raise AssertionError("no download in this test")
            yield b""

        return cli.main(
            list(argv),
            env={"TAGALONG_HOME": str(self.home), **(env or {})},
            run=kw.pop("run", self.run),
            fetch=kw.pop("fetch", no_fetch),
            get_json=self.get_json,
            inspect_fn=self.inspect_fn,
            out=self.out,
            ask=self.ask,
            stdin=io.StringIO(stdin),
            **kw,
        )

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


# ---- doctor ----


def test_doctor_lists_node_npm_git_and_experts_on_a_fake_machine(tmp_path):
    node, npm = ToolVersion("22.5.0", "/n/node"), ToolVersion("10.1", "/n/npm")
    rig = Rig(tmp_path, mach=Machine("linux", "arm64", node, None, npm, None, None))
    ExpertStore(tmp_path).add(
        InstalledExpert("claude-acp", "Claude Agent", "0.99.1", ["x"], "registry", True)
    )
    assert rig.go("doctor") == 0
    assert "linux arm64" in rig.text
    assert "node 22.5.0" in rig.text and "npm 10.1" in rig.text and "git: not found" in rig.text
    assert "claude-acp 0.99.1 logged in" in rig.text


def test_doctor_reports_no_key_and_no_expert(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("doctor") == 0
    assert "no Anthropic key" in rig.text
    assert "no expert installed" in rig.text


def test_doctor_names_an_expert_that_is_not_logged_in(tmp_path):
    ExpertStore(tmp_path).add(InstalledExpert("codex-acp", "Codex", "2", ["x"], "registry", False))
    rig = Rig(tmp_path)
    rig.go("doctor", env={"ANTHROPIC_API_KEY": "sk-ant-secret"})
    assert "codex-acp 2 not logged in" in rig.text
    assert "no Anthropic key" not in rig.text
    assert "sk-ant-secret" not in rig.text


def test_doctor_reads_the_key_from_the_env_file(tmp_path):
    (tmp_path / ".env").write_text("ANTHROPIC_API_KEY=sk-ant-filed\n")
    rig = Rig(tmp_path)
    rig.go("doctor")
    assert "Anthropic key: set" in rig.text and "sk-ant-filed" not in rig.text


def test_doctor_offline_uses_the_registry_cache(tmp_path):
    cache_file(tmp_path, "acp").parent.mkdir(parents=True)
    cache_file(tmp_path, "acp").write_text(json.dumps({"fetched_at": 1.0, "data": json.loads(ACP)}))
    rig = Rig(tmp_path, offline=True)
    assert rig.go("doctor") == 0
    assert "claude-acp" in rig.text and "cached" in rig.text


def test_doctor_offline_with_no_cache_says_so_and_still_exits_0(tmp_path):
    rig = Rig(tmp_path, offline=True)
    assert rig.go("doctor") == 0
    assert "registry unavailable" in rig.text


def test_unknown_subcommand_exits_2(tmp_path):
    with pytest.raises(SystemExit) as stop:
        Rig(tmp_path).go("frobnicate")
    assert stop.value.code == 2


def test_the_key_is_never_accepted_as_an_argument(tmp_path, capsys):
    with pytest.raises(SystemExit) as stop:
        Rig(tmp_path).go("key", "set", "sk-ant-oops")
    assert stop.value.code == 2
    assert "sk-ant-oops" not in capsys.readouterr().err  # the usage error must not echo it


# ---- key set ----


def test_key_set_writes_the_env_and_prints_nothing_secret(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("key", "set", "--stdin", stdin="sk-ant-abc123\n") == 0
    assert "ANTHROPIC_API_KEY=sk-ant-abc123" in (tmp_path / ".env").read_text()
    assert rig.text and "sk-ant-abc123" not in rig.text


def test_key_set_prompts_hidden_when_not_stdin(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("key", "set", secret=lambda prompt: "sk-ant-hidden") == 0
    assert "sk-ant-hidden" in (tmp_path / ".env").read_text()


def test_key_set_refuses_a_key_with_spaces(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("key", "set", "--stdin", stdin="not a key\n") == 1
    assert not (tmp_path / ".env").exists()


# ---- install ----


class Npm:
    async def __call__(self, argv, env, cwd):
        prefix = Path(argv[argv.index("--prefix") + 1])
        pkg = prefix / "node_modules" / "@agentclientprotocol" / "claude-agent-acp"
        (pkg / "dist").mkdir(parents=True)
        (pkg / "package.json").write_text(json.dumps({"bin": {"claude-agent-acp": "dist/i.js"}}))
        (pkg / "dist" / "i.js").write_text("//")
        return CmdResult(0, "", "")


@pytest.fixture
def no_node_download(monkeypatch):
    async def ensure(home, min_major, fetch, get_json, os_name, arch, on_progress):
        root = node_dir(home)
        node, npm = root / "node.exe", root / "node_modules" / "npm" / "bin" / "npm-cli.js"
        npm.parent.mkdir(parents=True, exist_ok=True)
        node.write_text("")
        npm.write_text("")
        return NodePaths(node, npm)

    monkeypatch.setattr(install_mod, "ensure_node", ensure)


def test_install_names_the_node_download_before_asking(tmp_path, no_node_download):
    rig = Rig(tmp_path, answers=["n"])
    rig.go("install", "claude-acp", run=Npm())
    assert "claude-acp" in rig.text and "0.99.1" in rig.text and "Node" in rig.text
    assert rig.asked and "[y/N]" in rig.asked[0]


def test_install_without_yes_asks_and_a_no_installs_nothing(tmp_path, no_node_download):
    rig = Rig(tmp_path, answers=["no"])
    assert rig.go("install", "claude-acp", run=Npm()) == 0
    assert ExpertStore(tmp_path).list() == []
    assert not node_dir(tmp_path).exists()


def test_install_with_yes_records_the_expert_for_a_later_brain(tmp_path, no_node_download):
    rig = Rig(tmp_path)
    assert rig.go("install", "claude-acp", "--yes", run=Npm()) == 0
    assert rig.asked == []
    assert ExpertStore(tmp_path).get("claude-acp").version == "0.99.1"  # a fresh read, no restart
    assert "installed" in rig.text


def test_a_typed_y_is_the_ok(tmp_path, no_node_download):
    rig = Rig(tmp_path, answers=["y"])
    rig.go("install", "claude-acp", run=Npm())
    assert ExpertStore(tmp_path).get("claude-acp") is not None


def test_a_failure_prints_facts_and_exits_1(tmp_path, no_node_download):
    async def bad(argv, env, cwd):
        return CmdResult(1, "", "npm ERR! network")

    rig = Rig(tmp_path)
    assert rig.go("install", "claude-acp", "--yes", run=bad) == 1
    assert "npm_failed" in rig.text and "npm ERR! network" in rig.text
    assert ExpertStore(tmp_path).list() == []


def test_an_unknown_expert_exits_1(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("install", "nope", "--yes") == 1
    assert "unknown_expert" in rig.text


# ---- apps add ----


def test_apps_add_maps_a_registry_entry_and_writes_the_app_row(tmp_path):
    rig = Rig(tmp_path, answers=["y"])
    assert rig.go("apps", "add", "acme/cloud") == 0
    rows = Memory(tmp_path / "tagalong.db").list_apps()
    assert [(r.name, r.transport, r.auth) for r in rows] == [("cloud", "http", "oauth")]
    assert "c.test" in rig.text  # the host is on the card
    assert "https://c.test/mcp" not in rig.text  # the host only, like the Allow card
    assert "sign in" in rig.text.lower()  # the CLI cannot open the sign-in itself


def test_apps_add_no_adds_nothing(tmp_path):
    rig = Rig(tmp_path, answers=["n"])
    assert rig.go("apps", "add", "acme/cloud") == 0
    assert Memory(tmp_path / "tagalong.db").list_apps() == []


def test_apps_add_twice_is_a_fact_not_a_second_row(tmp_path):
    Rig(tmp_path).go("apps", "add", "acme/cloud", "--yes")
    rig = Rig(tmp_path)
    assert rig.go("apps", "add", "acme/cloud", "--yes") == 1
    assert "already_added" in rig.text


def test_apps_add_npx_twice_never_downloads_again(tmp_path, monkeypatch):
    calls = []

    async def ensure(home, min_major, fetch, get_json, os_name, arch, on_progress):
        calls.append(1)
        root = node_dir(home)
        node, npm = root / "node.exe", root / "node_modules" / "npm" / "bin" / "npm-cli.js"
        npm.parent.mkdir(parents=True, exist_ok=True)
        node.write_text("")
        npm.write_text("")
        return NodePaths(node, npm)

    monkeypatch.setattr(install_mod, "ensure_node", ensure)
    first = Rig(tmp_path)
    assert first.go("apps", "add", "acme/notes", "--yes") == 0, first.text
    shutil.rmtree(node_dir(tmp_path))  # Node gone again: a repeat must still not fetch it
    rig = Rig(tmp_path)
    assert rig.go("apps", "add", "acme/notes", "--yes") == 1
    assert "already_added" in rig.text
    assert len(calls) == 1


def test_apps_add_lists_only_env_names_not_already_set(tmp_path, no_node_download):
    rig = Rig(tmp_path)
    assert rig.go("apps", "add", "acme/notes", "--yes") == 0
    assert "ACME_KEY" in rig.text
    rig = Rig(tmp_path / "b")
    (tmp_path / "b").mkdir()
    assert rig.go("apps", "add", "acme/notes", "--yes", env={"ACME_KEY": "x"}) == 0
    assert "ACME_KEY" not in rig.text


def test_apps_add_says_community_and_who_made_it(tmp_path):
    rig = Rig(tmp_path, answers=["n"])
    assert rig.go("apps", "add", "acme/cloud") == 0
    assert "community, made by acme (not the service itself)" in rig.text


# ---- login ----


def seed_expert(tmp_path):
    ExpertStore(tmp_path).add(
        InstalledExpert("claude-acp", "Claude", "1", [sys.executable, FAKE], "registry", None)
    )


def test_login_opens_the_window_waits_and_records_logged_in(tmp_path, monkeypatch):
    marker = tmp_path / "logged-in"
    monkeypatch.setenv("FAKE_ACP_LOGIN_FILE", str(marker))
    monkeypatch.delenv("FAKE_ACP_LOGGED_IN", raising=False)
    monkeypatch.setenv("FAKE_ACP_AUTH", LOGIN_AUTH)
    seed_expert(tmp_path)
    calls = []

    async def window(argv, env, done_file):
        calls.append(argv)
        marker.write_text("x")
        done_file.write_text("0")

    rig = Rig(tmp_path)
    assert rig.go("login", "claude-acp", open_terminal=window) == 0
    assert len(calls) == 1
    assert ExpertStore(tmp_path).get("claude-acp").logged_in is True
    assert "logged in" in rig.text


def test_login_where_no_window_can_open_prints_the_command(tmp_path, monkeypatch):
    monkeypatch.delenv("FAKE_ACP_LOGGED_IN", raising=False)
    monkeypatch.setenv("FAKE_ACP_AUTH", LOGIN_AUTH)
    seed_expert(tmp_path)

    async def none(argv, env, done_file):
        raise NoTerminal(argv)

    rig = Rig(tmp_path)
    assert rig.go("login", "claude-acp", open_terminal=none) == 1
    assert "run this yourself" in rig.text and "--a" in rig.text


def test_login_that_times_out_is_a_fact_not_a_traceback(tmp_path, monkeypatch):
    monkeypatch.delenv("FAKE_ACP_LOGGED_IN", raising=False)
    monkeypatch.setenv("FAKE_ACP_AUTH", LOGIN_AUTH)
    monkeypatch.setattr(cli, "LOGIN_TIMEOUT_S", 0.05)
    monkeypatch.setattr(cli, "LOGIN_GRACE_S", 0.0)
    seed_expert(tmp_path)

    async def window(argv, env, done_file):
        await asyncio.sleep(5)  # the person never finishes

    rig = Rig(tmp_path)
    assert rig.go("login", "claude-acp", open_terminal=window) == 1
    assert "login timeout" in rig.text


def test_login_for_an_expert_not_installed_exits_1(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("login", "claude-acp") == 1
    assert "unknown_expert" in rig.text


# ---- never a running brain ----


def test_the_cli_never_opens_a_socket(tmp_path, monkeypatch, no_node_download):
    def boom(*a, **k):
        raise AssertionError("the CLI must not talk to a running brain")

    # Not socket.connect itself: Windows asyncio opens a loopback pair for its own use.
    monkeypatch.setattr(socket, "create_connection", boom)
    monkeypatch.setattr(asyncio.BaseEventLoop, "create_connection", boom)
    rig = Rig(tmp_path)
    assert rig.go("doctor") == 0
    assert rig.go("install", "claude-acp", "--yes", run=Npm()) == 0


# ---- stop ----


def test_stop_says_stopped(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("stop", stop=lambda home: "stopped") == 0
    assert rig.text == "Stopped the brain."


def test_stop_when_not_running_exits_zero(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("stop", stop=lambda home: "not_running") == 0
    assert rig.text == "The brain is not running."


def test_stop_failure_exits_one(tmp_path):
    (tmp_path / "brain.pid").write_text("777")
    rig = Rig(tmp_path)
    assert rig.go("stop", stop=lambda home: "failed") == 1
    assert rig.text == "The brain did not stop (pid 777)."


def test_stop_that_raises_oserror_prints_a_message_not_a_traceback(tmp_path):
    def boom(home):
        raise OSError("nope")

    rig = Rig(tmp_path)
    assert rig.go("stop", stop=boom) == 1
    assert "did not stop" in rig.text


def test_install_without_a_tty_or_yes_says_to_pass_yes(tmp_path):
    rig = Rig(tmp_path)

    def no_tty(prompt: str) -> str:
        raise EOFError

    rig.ask = no_tty
    assert rig.go("install", "claude-acp") == 1
    assert rig.lines[-1] == "Run again with --yes to go ahead without a prompt."


# ---- perf ----


def test_perf_prints_summary_from_log(tmp_path):
    now = 10_000.0
    (tmp_path / "brain.log").write_text(
        f"perf t={now - 7200} step=turn n=1 p50=9.000 p95=9.000 max=9.000\n"
        f"perf t={now - 60} step=turn n=4 p50=1.500 p95=3.000 max=4.000\n"
        f"ask.closed t={now - 30} id=a1 by=brain why=cancelled\n"
        f"ask.closed t={now - 20} id=a2 by=brain why=timeout\n"
        f"ask.closed t={now - 7200} id=a3 by=brain why=cancelled\n"
    )
    rig = Rig(tmp_path)
    assert rig.go("perf", "--since", "1h", now=lambda: now) == 0
    assert "turn" in rig.text and "1.500" in rig.text and "3.000" in rig.text
    assert "9.000" not in rig.text
    assert "asks closed by cancel: 1" in rig.text


def test_perf_without_a_log_says_so(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("perf", now=lambda: 1.0) == 1
    assert "brain.log" in rig.text
