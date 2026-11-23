"""`tagalong`: set Tagalong up from a terminal, for a brain machine with no screen.

A thin front end over the brain's own setup package (facts, registry, install, login, store,
apps). It reads and writes the same files under TAGALONG_HOME and talks to no running brain
(except `stop`, which ends it by its pid file); the brain re-reads those files when it next
needs them. Keys are never printed or taken
from the command line.
"""

import argparse
import asyncio
import getpass
import os
import re
import sys
import time
from collections.abc import Awaitable, Callable, MutableMapping
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import NoReturn, TextIO
from urllib.parse import urlsplit

from brain.apps import AppError, TokenFile, split_secrets
from brain.config import load_config, load_env_file, upsert_env_value
from brain.devices import Devices
from brain.discovery import lan_address
from brain.events import Event
from brain.identity import load_or_create_identity
from brain.lifecycle import pid_path, stop_real_brain
from brain.memory import Memory
from brain.node.allowlist import Allowlist, NotRunnable
from brain.node.main import HelloRefused
from brain.node.main import run_node as real_run_node
from brain.open_items import OpenItems
from brain.pairing import PAIR_KINDS, build_pairing, render_qr
from brain.protocol import PipeSpec
from brain.service import Service, ServiceError, real_service
from brain.setup.apps import add_registry_app, app_card
from brain.setup.facts import Machine, RunCmd, inspect, real_run_cmd
from brain.setup.install import (
    NPM_TIMEOUT_S,
    InstallError,
    install_card,
    install_expert,
)
from brain.setup.login import LOGIN_TIMEOUT_S, LoginDriver
from brain.setup.net import GetJson, http_fetch, real_get_json
from brain.setup.registry import Registry, RegistryEntry, RegistryUnavailable
from brain.setup.store import ExpertStore, all_experts
from brain.setup.terminal import OpenTerminal, real_open_terminal
from brain.store.db import open_db, utc_now_text
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
    perf = sub.add_parser("perf", help="how long the brain's steps take, from its log")
    perf.add_argument("--since", default="1h", help="how far back to look: 30m, 1h, 2d (1h)")
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
    pair = sub.add_parser("pair", help="make a one-time code to pair another machine")
    pair.add_argument("--kind", choices=sorted(PAIR_KINDS), default="desktop")
    service = sub.add_parser("service", help="run the brain at logon, without the desktop")
    service.add_argument("sub", choices=["install", "remove", "status"])
    serve = sub.add_parser("serve", help="run the brain here for other devices, with a pairing QR")
    serve.add_argument(
        "--install-service", action="store_true", help="start it at logon instead of running it"
    )
    sub.add_parser("update", help="upgrade the brain installed by the install script")
    node = sub.add_parser("node", help="run tools for a brain on another machine").add_subparsers(
        dest="sub", required=True
    )
    node.add_parser("run", help="connect to the paired brain and serve its pipes")
    allow = node.add_parser("allow", help="let the brain run this command or open this URL here")
    allow.add_argument("command", nargs="?")
    allow.add_argument("args", nargs=argparse.REMAINDER, help="its arguments, after --")
    allow.add_argument("--url", help="an HTTP MCP server's exact address, instead of a command")
    allow.add_argument(
        "--secret-env",
        action="append",
        default=[],
        metavar="NAME",
        help="an environment variable whose value is typed here and kept on this machine",
    )
    allow.add_argument(
        "--url-secret",
        action="store_true",
        help="a secret query string for the URL, typed here and kept on this machine",
    )
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
    now: Callable[[], float] = time.time,
    host_addr: Callable[[], str] = lan_address,
    service_for: Callable[[Path], Service] = real_service,
    run_brain: Callable[[], None] | None = None,
    run_node: Callable[[MutableMapping[str, str], Allowlist], Awaitable[None]] = real_run_node,
) -> int:
    """Every outside thing is a parameter, so tests run on fakes. Exits 0 ok, 1 failed, 2 usage."""
    args = _parser().parse_args(argv)  # a usage error exits 2 here
    env = os.environ if env is None else env
    config = load_config(env)
    home = config.data_dir
    if args.cmd != "node":  # a node's children must not inherit the brain's keys
        load_env_file(home, env)  # the brain reads the same .env
    config = load_config(env)
    run = run or partial(real_run_cmd, timeout=NPM_TIMEOUT_S)
    machine = inspect_fn or partial(inspect, home, run)
    reg = Registry(home, get_json)
    stdin = stdin or sys.stdin

    async def go() -> None:
        if args.cmd == "doctor":
            await _doctor(home, env, reg, machine, out)
        elif args.cmd == "stop":
            _stop(home, stop, out)
        elif args.cmd == "perf":
            _perf(home, args.since, now(), out)
        elif args.cmd == "pair":
            _pair(config, args.kind, host_addr, out)
        elif args.cmd == "service":
            _service(args.sub, service_for(home), home, env, out)
            if args.sub == "install":
                out("Pair a device with `tagalong pair`.")
        elif args.cmd == "serve":
            _serve(args.install_service, config, service_for(home), env, host_addr, out)
        elif args.cmd == "node":
            await _node(args, home, env, run_node, secret, out)
        elif args.cmd == "update":
            await _update(run, env, out)
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
        if args.cmd == "serve" and not args.install_service:
            if run_brain is None:
                from brain.main import main as run_brain
            run_brain()
    except _Fail as err:
        out(str(err))
        return 1
    except (InstallError, RegistryUnavailable, AppError) as err:
        out(_fact(err))
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


_UNIT_S = {"m": 60, "h": 3600, "d": 86400}
_FIELDS = re.compile(r"(\w+)=(\S*)")


def _perf(home: Path, since: str, now: float, out) -> None:
    """Latest timings the brain wrote to brain.log in the window, and how many asks were
    closed by a cancel. The brain writes `perf` and `ask.closed` lines (see telemetry.py)."""
    m = re.fullmatch(r"(\d+)([mhd])", since)
    if m is None:
        raise _Fail("--since is a number and m, h or d, like 30m or 2h.")
    start = now - int(m[1]) * _UNIT_S[m[2]]
    log = home / "brain.log"
    if not log.exists():
        raise _Fail(f"No brain.log in {home}: start the brain first.")
    steps: dict[str, dict[str, str]] = {}  # the last line per step: the timings only grow
    cancelled = 0
    for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
        kind = line.split(" ", 1)[0]
        if kind not in ("perf", "ask.closed"):
            continue
        try:  # a truncated or junk line is skipped, not fatal
            f = dict(_FIELDS.findall(line))
            if float(f["t"]) < start:
                continue
            if kind == "perf":
                for key in ("step", "n", "p50", "p95", "max"):
                    f[key]
                steps[f["step"]] = f
            elif f.get("why") == "cancelled":
                cancelled += 1
        except (KeyError, ValueError):
            continue
    out(f"{'step':<12}{'n':>6}{'p50 s':>9}{'p95 s':>9}{'max s':>9}")
    for step, f in sorted(steps.items()):
        out(f"{step:<12}{f['n']:>6}{f['p50']:>9}{f['p95']:>9}{f['max']:>9}")
    if not steps:
        out(f"No timings in the last {since}.")
    out(f"asks closed by cancel: {cancelled}")


def _pair(config, kind: str, host_addr: Callable[[], str], out) -> None:
    if kind != "browser" and not config.network:
        raise _Fail(
            "Network access is off, so no other machine can reach this brain. Set "
            f"TAGALONG_NETWORK=1 (in {config.data_dir / '.env'} or the environment), start the "
            "brain, then run this again."
        )
    db = open_db(config.data_dir / "tagalong.db")

    _, pairing = build_pairing(
        db,
        load_or_create_identity(config.data_dir),
        config.public_host,
        config.network_port,
        host_addr,
    )
    offer = pairing.make_code(kind)
    if kind == "browser":  # redeemed on this machine only, so a code and no address
        out(f"Browser code: {offer.secret}")
        out("Valid for 10 minutes, one use. Type it into the add-on's popup.")
        return
    if out is print:  # the QR is block characters that a Windows code page cannot print
        sys.stdout.reconfigure(encoding="utf-8")
    out(render_qr(offer.link))
    out(offer.link)
    out("Valid for 10 minutes, one use. Open it on the other machine's Tagalong.")


def _serve(install, config, service: Service, env, host_addr, out) -> None:
    if install:
        _service("install", service, config.data_dir, env, out)
    else:
        upsert_env_value(config.data_dir, "TAGALONG_NETWORK", "1", env)
    config = load_config(env)
    if Devices(open_db(config.data_dir / "tagalong.db"), utc_now_text).list():
        out("Pair another device with `tagalong pair`.")
    else:
        _pair(config, "desktop", host_addr, out)


NODE_ENV = ("TAGALONG_NODE_ADDR", "TAGALONG_NODE_FP", "TAGALONG_NODE_TOKEN", "TAGALONG_NODE_ID")


def _node_allow(args, allowlist: Allowlist, secret: Callable[[str], str], out) -> None:
    if (args.url is None) == (args.command is None):
        raise _Fail("Give a command, or --url with an address, not both.")
    if args.url is not None:
        parts = urlsplit(args.url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise _Fail("The address must be an http or https URL.")
        if args.secret_env:
            raise _Fail("--secret-env is for a command; a URL takes --url-secret.")
        if split_secrets("", {"url": args.url}, "http")[1]:
            raise _Fail("Leave the secret out of the address and give it with --url-secret.")
        spec = PipeSpec(url=args.url)
        shown = args.url
    else:
        if args.url_secret:
            raise _Fail("--url-secret is for a URL.")
        spec = PipeSpec(
            command=args.command, args=args.args[1:] if args.args[:1] == ["--"] else args.args
        )
        shown = " ".join([args.command, *spec.args])
    env = {name: secret(f"Value for {name} (hidden): ") for name in args.secret_env}
    query = (
        secret("Secret query for the URL, like key=value (hidden): ") if args.url_secret else None
    )
    try:
        allowlist.allow(spec, secret_env=env or None, url_query=query or None)
    except NotRunnable as err:
        raise _Fail(str(err)) from None
    out(f"The brain may now {'open' if args.url else 'run'}: {shown}")
    if env or query:
        out("The secrets stay on this machine; the brain never sees them.")


async def _node(args, home: Path, env, run_node, secret, out) -> None:
    allowlist = Allowlist(home / "node" / "allowlist.json")
    if args.sub == "allow":
        _node_allow(args, allowlist, secret, out)
        return
    missing = [name for name in NODE_ENV if not env.get(name)]
    if missing:
        raise _Fail(f"A node needs {', '.join(missing)}; the desktop sets them when it starts one.")
    try:
        await run_node(env, allowlist)
    except HelloRefused as err:
        raise _Fail(f"The brain refused this node ({err}). Pair this device again.") from None


async def _update(run: RunCmd, env, out) -> None:
    done = await run(["uv", "tool", "upgrade", "brain"], env, None)
    if done.code != 0:
        raise _Fail(f"The update failed: {(done.err or done.out).strip()}")
    out("Updated. A running brain uses the new version after `tagalong stop` and a restart.")


def _service(action: str, service: Service, home: Path, env, out) -> None:
    if action == "status":
        out("installed" if service.installed() else "not installed")
    elif action == "remove":
        service.remove()
        out("Removed. The brain no longer starts at logon; network access stays as it was.")
    else:
        # The brain reads this when the service starts it, so it must be saved first.
        env_file = home / ".env"
        before = env_file.read_bytes() if env_file.exists() else None
        upsert_env_value(home, "TAGALONG_NETWORK", "1", env)
        try:
            service.install()
        except ServiceError as err:
            if before is None:
                env_file.unlink(missing_ok=True)
            else:
                env_file.write_bytes(before)
            raise _Fail(f"failed: {err}") from None
        out("Installed: the brain starts at logon, with network access on for other devices.")
        out("Turned the network listener on (TAGALONG_NETWORK=1 in .env).")
        out("A brain already running gets the network listener when it restarts.")


def _stop(home: Path, stop: Callable[[Path], str], out) -> None:
    pid = pid_path(home).read_text().strip() if pid_path(home).exists() else "?"
    try:
        result = stop(home)
    except OSError:  # never a traceback for the person
        result = "failed"
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
    if yes:
        return True
    try:
        return ask("Go ahead? [y/N] ").strip().lower() in ("y", "yes")
    except EOFError:  # no terminal to answer on
        raise _Fail("Run again with --yes to go ahead without a prompt.") from None


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
        what = f"runs {card['package']}@{card['version']} ({card['runner']})"
    out(f"add app {entry.id}: {what}")
    out(
        "  official"
        if card["official"]
        else f"  community, made by {card['publisher']} (not the service itself)"
    )
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

    # The command has no brain to keep items for it: a throwaway in-memory set holds the flight.
    items = OpenItems(open_db(":memory:"), lambda: datetime.now(UTC))
    driver = LoginDriver(home, store, open_terminal, emit, items)
    driver.start(expert)
    out(f"checking {expert_id}; if it needs a login, finish it in the window or browser that opens")
    try:
        await asyncio.wait_for(ended.wait(), LOGIN_TIMEOUT_S + LOGIN_GRACE_S)
    except TimeoutError as err:
        raise _Fail("failed: login timeout") from err
    finally:
        await driver.stop()
    facts = result[0].payload
    if facts.get("detail") == "no_terminal":
        raise _Fail(
            f"no window can open here; run this on the machine the brain runs on, then "
            f"`tagalong doctor`:\n  "
            f"{facts['command']}"
        )
    if facts["state"] != "logged_in":
        raise _Fail(f"failed: login {facts['state']}: {facts.get('detail', '')}")
    out(f"{expert_id} is logged in")
