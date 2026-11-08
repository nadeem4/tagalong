"""`tagalong`: set Tagalong up from a terminal, for a brain machine with no screen.

A thin front end over the brain's own setup package (facts, registry, install, login, store,
apps). It reads and writes the same files under TAGALONG_HOME and never talks to a running
brain; the brain re-reads those files when it next needs them. Keys are never printed or taken
from the command line.
"""

import argparse
import asyncio
import getpass
import os
import sys
from collections.abc import Awaitable, Callable, MutableMapping
from functools import partial
from pathlib import Path
from typing import NoReturn, TextIO

from brain.apps import AppError, TokenFile
from brain.config import load_config, load_env_file, upsert_env_value
from brain.events import Event
from brain.lifecycle import pid_path, stop_real_brain
from brain.memory import Memory
from brain.setup.apps import add_registry_app, app_card
from brain.setup.facts import Machine, RunCmd, inspect, real_run_cmd
from brain.setup.install import (
    NPM_TIMEOUT_S,
    InstallError,
    install_card,
    install_expert,
)
from brain.setup.login import LOGIN_TIMEOUT_S, Failed, LoggedIn, LoginDriver, Unknown
from brain.setup.net import GetJson, http_fetch, real_get_json
from brain.setup.registry import Registry, RegistryEntry, RegistryUnavailable
from brain.setup.store import ExpertStore, all_experts
from brain.setup.terminal import NoTerminal, OpenTerminal, real_open_terminal
from brain.tools import KEY_NAME, clean_key
from brain.voice.models import Fetch

LOGIN_GRACE_S = 5.0  # past the driver's own wait, so its timeout event arrives first


class _Fail(Exception):
    """One fact line for the person; exits 1."""


def _no_echo_error(parser: argparse.ArgumentParser) -> Callable[[str], NoReturn]:
    """A usage error that never repeats stray arguments (a key must not be echoed)."""

    def error(message: str) -> NoReturn:
        if message.startswith("unrecognized arguments"):
            message = "unrecognized arguments (a key is never taken as an argument)"
        parser.print_usage(sys.stderr)
        parser.exit(2, f"{parser.prog}: error: {message}\n")

    return error


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="tagalong", description="Set up Tagalong on this machine.")
    p.error = _no_echo_error(p)  # type: ignore[method-assign]
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor", help="show what this machine has and what is missing")
    sub.add_parser("stop", help="stop the brain the desktop left running")
    key = sub.add_parser("key", help="the Anthropic key").add_subparsers(dest="sub", required=True)
    setter = key.add_parser("set", help="save the key (read from a hidden prompt or stdin)")
    setter.add_argument("--stdin", action="store_true", help="read the key from standard input")
    install = sub.add_parser("install", help="install an expert from the ACP registry")
    install.add_argument("expert_id")
    install.add_argument("--yes", action="store_true", help="skip the question")
    apps = sub.add_parser("apps", help="connected apps").add_subparsers(dest="sub", required=True)
    add = apps.add_parser("add", help="add an app from the MCP registry")
    add.add_argument("app_id")
    add.add_argument("--yes", action="store_true", help="skip the question")
    login = sub.add_parser("login", help="log an installed expert in")
    login.add_argument("expert_id")
    return p


def main(
    argv: list[str] | None = None,
    *,
    env: MutableMapping[str, str] | None = None,
    run: RunCmd | None = None,
    fetch: Fetch = http_fetch,
    get_json: GetJson = real_get_json,
    inspect_fn: Callable[[], Awaitable[Machine]] | None = None,
    open_terminal: OpenTerminal = real_open_terminal,
    out: Callable[[str], None] = print,
    ask: Callable[[str], str] = input,
    secret: Callable[[str], str] = getpass.getpass,
    stdin: TextIO | None = None,
    stop: Callable[[Path], str] = stop_real_brain,
) -> int:
    """Every outside thing is a parameter, so tests run on fakes. Exits 0 ok, 1 failed, 2 usage."""
    args = _parser().parse_args(argv)  # a usage error exits 2 here
    env = os.environ if env is None else env
    home = load_config(env).data_dir
    load_env_file(home, env)  # the brain reads the same .env
    run = run or partial(real_run_cmd, timeout=NPM_TIMEOUT_S)
    machine = inspect_fn or partial(inspect, home, run)
    reg = Registry(home, get_json)
    stdin = stdin or sys.stdin

    async def go() -> None:
        if args.cmd == "doctor":
            await _doctor(home, env, reg, machine, out)
        elif args.cmd == "stop":
            _stop(home, stop, out)
        elif args.cmd == "key":
            _key(home, env, args.stdin, stdin, secret, out)
        elif args.cmd == "install":
            await _install(args, home, reg, machine, run, fetch, get_json, ask, out)
        elif args.cmd == "apps":
            await _app_add(args, home, env, reg, machine, fetch, get_json, ask, out)
        else:
            await _login(args.expert_id, home, open_terminal, out)

    try:
        asyncio.run(go())
    except _Fail as err:
        out(str(err))
        return 1
    except (InstallError, RegistryUnavailable, AppError) as err:
        out(_fact(err))
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


def _stop(home: Path, stop: Callable[[Path], str], out) -> None:
    pid = pid_path(home).read_text().strip() if pid_path(home).exists() else "?"
    result = stop(home)
    if result == "stopped":
        out("Stopped the brain.")
    elif result == "not_running":
        out("The brain is not running.")
    else:
        raise _Fail(f"The brain did not stop (pid {pid}).")


def _fact(err: Exception) -> str:
    if isinstance(err, InstallError):
        return f"failed: {err.kind}: {err.detail}"
    if isinstance(err, RegistryUnavailable):
        return f"failed: registry unavailable: {err}"
    return f"failed: {err}"


def _confirm(ask: Callable[[str], str], yes: bool) -> bool:
    """The typed `y` (or --yes) is the OK, the same as the Allow card."""
    return yes or ask("Go ahead? [y/N] ").strip().lower() in ("y", "yes")


async def _doctor(home: Path, env, reg: Registry, machine, out) -> None:
    m = await machine()
    out(f"this machine: {m.os} {m.arch}")
    for name, tool in (
        ("node", m.node),
        ("private node", m.private_node),
        ("npm", m.npm),
        ("git", m.git),
        ("claude", m.claude_code),
    ):
        out(f"  {name} {tool.version}" if tool else f"  {name}: not found")
    has_key = bool(env.get(KEY_NAME))
    out("Anthropic key: set" if has_key else "no Anthropic key: run `tagalong key set`")
    experts = all_experts(ExpertStore(home), load_config(env).expert_cmd)
    if not experts:
        out("no expert installed: run `tagalong install claude-acp`")
    for e in experts:
        state = {True: "logged in", False: "not logged in", None: "login not checked"}[e.logged_in]
        out(f"  {e.id} {e.version} {state}")
        if e.logged_in is False:
            out(f"    run `tagalong login {e.id}`")
    try:
        found = await reg.acp_agents()
        note = " (cached: the registry could not be reached)" if found.stale else ""
        out("experts you can install" + note + ": " + ", ".join(a.id for a in found.entries))
    except RegistryUnavailable:
        out("registry unavailable: nothing cached yet")


def _key(home: Path, env, from_stdin: bool, stdin: TextIO, secret, out) -> None:
    raw = stdin.readline() if from_stdin else secret("Anthropic key: ")
    key = clean_key(raw)
    if key is None:
        raise _Fail("that is not a key: nothing saved")
    # Not checked against the API here (that costs a call); the brain checks it when it uses it.
    upsert_env_value(home, KEY_NAME, key, env)
    out(f"saved the key to {home / '.env'}; restart the brain to use it")


async def _entry(items: Awaitable, wanted: str, kind: str) -> RegistryEntry:
    found = await items
    entry = next((e for e in found.entries if e.id == wanted), None)
    if entry is None:
        raise InstallError(f"unknown_{kind}", wanted)
    return entry


async def _install(args, home, reg, machine, run, fetch, get_json, ask, out) -> None:
    entry = await _entry(reg.acp_agents(), args.expert_id, "expert")
    m = await machine()
    card = await install_card(entry, home, m, get_json)
    out(f"install {card['expert']} {card['version']} into {card['installs_into']}")
    node = card["node_download"]
    out(
        f"  downloads Tagalong's own Node {node['version']} into {node['into']}"
        if node
        else "  uses the Node already here"
    )
    if not _confirm(ask, args.yes):
        out("nothing installed")
        return
    seen: set[tuple] = set()

    def progress(step: dict) -> None:
        quarter = (step.get("percent") or 0) // 25  # a line per quarter, not per chunk
        mark = (step["stage"], quarter)
        if mark not in seen:
            seen.add(mark)
            out(f"  {step['stage']}" + (f" {step['percent']}%" if "percent" in step else ""))

    expert = await install_expert(entry, home, m, run, fetch, get_json, ExpertStore(home), progress)
    out(f"installed {expert.id} {expert.version}; next: `tagalong login {expert.id}`")


class _NoConnect:
    """The CLI never connects an app (no brain here); the brain does when it starts."""

    async def restart(self, app_id: str) -> None:
        pass


async def _app_add(args, home, env, reg, machine, fetch, get_json, ask, out) -> None:
    try:
        entry = await _entry(reg.mcp_servers(None), args.app_id, "app")
    except InstallError:  # not on the first page: ask the registry's search
        entry = await _entry(reg.mcp_servers(args.app_id), args.app_id, "app")
    card = await app_card(entry, home, await machine(), get_json)
    if card["transport"] == "http":
        what = f"talks to {card['host']}"
    else:
        what = f"runs {card['package']}@{card['version']} ({card['runs']})"
    out(f"add app {entry.id}: {what}")
    node = card["node_download"]
    out(
        f"  downloads Tagalong's own Node {node['version']} into {node['into']}"
        if node
        else "  no download"
    )
    if not _confirm(ask, args.yes):
        out("nothing added")
        return
    memory = Memory(home / "tagalong.db")
    row = await add_registry_app(
        entry, home, machine, fetch, get_json, _NoConnect(), memory, TokenFile(home), _ignore
    )
    out(f"added {row.name}; it connects the next time the brain starts")
    if row.auth == "oauth":
        out("  it needs a sign in: do that from the Tagalong app, which opens a browser")
    missing = [n for n in row.config.get("env", {}) if n != "PATH" and n not in env]
    if missing:
        out(f"  set these in {home / '.env'}: {', '.join(missing)}")


def _ignore(*_args) -> None:
    pass


async def _login(expert_id: str, home: Path, open_terminal: OpenTerminal, out) -> None:
    store = ExpertStore(home)
    expert = store.get(expert_id)
    if expert is None:
        raise _Fail(f"failed: unknown_expert: {expert_id}")
    ended = asyncio.Event()
    result: list[Event] = []

    def emit(event: Event) -> None:
        result.append(event)
        ended.set()

    driver = LoginDriver(home, store, open_terminal, emit)
    try:
        state = await driver.start(expert)
    except NoTerminal as err:
        raise _Fail(
            f"no window can open here; run this yourself, then `tagalong doctor`:\n  {err.command}"
        ) from err
    if isinstance(state, LoggedIn):
        out(f"{expert_id} is already logged in")
        return
    if isinstance(state, Failed):
        raise _Fail(f"failed: {state.detail}")
    if isinstance(state, Unknown):
        raise _Fail("failed: could not tell whether the expert is logged in")
    out(f"finish signing in to {expert_id} in the {state.kind} that opened; waiting")
    try:
        await asyncio.wait_for(ended.wait(), LOGIN_TIMEOUT_S + LOGIN_GRACE_S)
    except TimeoutError as err:
        raise _Fail("failed: login timeout") from err
    finally:
        await driver.stop()
    facts = result[0].facts if result else {}
    if facts.get("state") != "logged_in":
        raise _Fail(f"failed: login {facts.get('state', 'timeout')}: {facts.get('detail', '')}")
    out(f"{expert_id} is logged in")
