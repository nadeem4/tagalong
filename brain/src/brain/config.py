"""Brain settings from environment variables, the optional .env file, and the session id.

The session id lives in a file so it survives restarts and every body sees one session.
It is informational: hello returns it and bodies never send it back.
"""

import math
import os
import shlex
import uuid
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 47321
DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_DAILY_BUDGET_USD = 5.0
DEFAULT_READER_MODEL = "claude-haiku-5-5"
DEFAULT_READER_DAILY_USD = 0.5
DEFAULT_LOOP_POLL_S = 300  # how often a switched-on mail app is read for loops
DEFAULT_LOOP_STALE_DAYS = 7  # a held loop untouched this long goes to one stale wake
DEFAULT_STEP_CAP = 25
DEFAULT_LOOP_LAG_MS = 200  # a blocked event loop longer than this is logged
DEFAULT_JOB_QUIET_MIN = 20.0
DEFAULT_EXPERT_IDLE_S = 300.0
DEFAULT_TURN_TIMEOUT_S = 300.0
DEFAULT_WAKES_PER_HOUR = 12
DEFAULT_OFFER_MIN_APPROVALS = 3
DEFAULT_OFFER_WINDOW_DAYS = 14
DEFAULT_KEEP_ASKING_DAYS = 7
DEFAULT_TOOL_PREVIEW_CHARS = 4000
DEFAULT_JOB_STEPS_MAX_ENTRIES = 2000  # steps one job's log keeps
DEFAULT_JOB_STEPS_MAX_BYTES = 1_000_000  # text bytes one job's log keeps
DEFAULT_WORK_KEEP_DAYS = 30  # finished work is swept this many days after it ended
DEFAULT_OUTPUTS_KEEP = 200  # stored long tool results kept, beyond those work still points at
DEFAULT_RETRY_MAX = 3  # tries of a step that failed for a passing reason
DEFAULT_RETRY_BACKOFF_S = (30, 120, 600)  # waits before each retry; the last repeats


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    data_dir: Path
    model: str = DEFAULT_MODEL
    daily_budget_usd: float = DEFAULT_DAILY_BUDGET_USD
    step_cap: int = DEFAULT_STEP_CAP
    loop_lag_ms: int = DEFAULT_LOOP_LAG_MS
    reader_model: str = DEFAULT_READER_MODEL  # reads mail for loops; its own allowance
    reader_daily_usd: float = DEFAULT_READER_DAILY_USD
    loop_poll_s: int = DEFAULT_LOOP_POLL_S
    loop_stale_days: int = DEFAULT_LOOP_STALE_DAYS
    work_keep_days: int = DEFAULT_WORK_KEEP_DAYS
    outputs_keep: int = DEFAULT_OUTPUTS_KEEP
    retry_max: int = DEFAULT_RETRY_MAX
    retry_backoff_s: tuple[int, ...] = DEFAULT_RETRY_BACKOFF_S
    expert_cmd: list[str] = field(default_factory=list)  # the custom-expert override
    job_quiet_min: float = DEFAULT_JOB_QUIET_MIN
    expert_idle_s: float = DEFAULT_EXPERT_IDLE_S  # warm adapter after its last session
    turn_timeout: float = DEFAULT_TURN_TIMEOUT_S
    wakes_per_hour: int = DEFAULT_WAKES_PER_HOUR
    offer_min_approvals: int = DEFAULT_OFFER_MIN_APPROVALS
    offer_window_days: int = DEFAULT_OFFER_WINDOW_DAYS
    keep_asking_days: int = DEFAULT_KEEP_ASKING_DAYS
    tool_preview_chars: int = DEFAULT_TOOL_PREVIEW_CHARS  # per tool result shown to the model
    job_steps_max_entries: int = DEFAULT_JOB_STEPS_MAX_ENTRIES
    job_steps_max_bytes: int = DEFAULT_JOB_STEPS_MAX_BYTES
    build: str | None = None  # the app's version when packaged; None in a dev checkout
    started_by: Literal["desktop", "person"] = "person"  # who owns the process


def split_command(cmd: str, posix: bool | None = None) -> list[str]:
    # POSIX shlex eats backslashes, which mangles C:\Users\... paths. Non-POSIX mode keeps
    # them, but also keeps the quotes, so strip those.
    if posix is None:
        posix = os.name != "nt"
    parts = shlex.split(cmd, posix=posix)
    if posix:
        return parts
    return [p[1:-1] if len(p) > 1 and p[0] == p[-1] and p[0] in "\"'" else p for p in parts]


def _expert_cmd(text: str) -> list[str]:
    try:
        return split_command(text)
    except ValueError as err:  # shlex's own message names no variable
        raise ValueError(f"bad TAGALONG_EXPERT_CMD: {err}: {text!r}") from None


def load_config(env: Mapping[str, str] = os.environ) -> Config:
    host, port = DEFAULT_HOST, DEFAULT_PORT
    addr = env.get("TAGALONG_BRAIN_ADDR")
    if addr:
        host, _, port_text = addr.rpartition(":")
        try:
            port = int(port_text)
        except ValueError:
            raise ValueError(f"bad port in TAGALONG_BRAIN_ADDR: {addr!r}") from None
        if not 0 <= port <= 65535:
            raise ValueError(f"port out of range in TAGALONG_BRAIN_ADDR: {addr!r}")
    home = env.get("TAGALONG_HOME")
    data_dir = Path(home) if home else Path.home() / ".tagalong"
    return Config(
        host=host,
        port=port,
        data_dir=data_dir,
        model=env.get("TAGALONG_MODEL") or DEFAULT_MODEL,
        daily_budget_usd=_budget(env.get("TAGALONG_DAILY_BUDGET_USD")),
        step_cap=_step_cap(env.get("TAGALONG_STEP_CAP")),
        loop_lag_ms=_positive_int(env, "TAGALONG_LOOP_LAG_MS", DEFAULT_LOOP_LAG_MS),
        reader_model=env.get("TAGALONG_READER_MODEL") or DEFAULT_READER_MODEL,
        reader_daily_usd=_positive_usd(env, "TAGALONG_READER_DAILY_USD", DEFAULT_READER_DAILY_USD),
        loop_poll_s=_positive_int(env, "TAGALONG_LOOP_POLL_S", DEFAULT_LOOP_POLL_S),
        loop_stale_days=_positive_int(env, "TAGALONG_LOOP_STALE_DAYS", DEFAULT_LOOP_STALE_DAYS),
        work_keep_days=_positive_int(env, "TAGALONG_WORK_KEEP_DAYS", DEFAULT_WORK_KEEP_DAYS),
        outputs_keep=_positive_int(env, "TAGALONG_OUTPUTS_KEEP", DEFAULT_OUTPUTS_KEEP),
        retry_max=_positive_int(env, "TAGALONG_RETRY_MAX", DEFAULT_RETRY_MAX),
        retry_backoff_s=_backoff(env.get("TAGALONG_RETRY_BACKOFF_S")),
        expert_cmd=_expert_cmd(env.get("TAGALONG_EXPERT_CMD") or ""),
        job_quiet_min=_job_quiet_min(env.get("TAGALONG_JOB_QUIET_MIN")),
        expert_idle_s=_expert_idle(env.get("TAGALONG_EXPERT_IDLE_S")),
        turn_timeout=_turn_timeout(env.get("TAGALONG_TURN_TIMEOUT_S")),
        wakes_per_hour=_wakes_per_hour(env.get("TAGALONG_WAKES_PER_HOUR")),
        offer_min_approvals=_positive_int(
            env, "TAGALONG_OFFER_MIN_APPROVALS", DEFAULT_OFFER_MIN_APPROVALS
        ),
        offer_window_days=_positive_int(
            env, "TAGALONG_OFFER_WINDOW_DAYS", DEFAULT_OFFER_WINDOW_DAYS
        ),
        keep_asking_days=_positive_int(env, "TAGALONG_KEEP_ASKING_DAYS", DEFAULT_KEEP_ASKING_DAYS),
        tool_preview_chars=_positive_int(
            env, "TAGALONG_TOOL_PREVIEW_CHARS", DEFAULT_TOOL_PREVIEW_CHARS
        ),
        job_steps_max_entries=_positive_int(
            env, "TAGALONG_JOB_STEPS_MAX_ENTRIES", DEFAULT_JOB_STEPS_MAX_ENTRIES
        ),
        job_steps_max_bytes=_positive_int(
            env, "TAGALONG_JOB_STEPS_MAX_BYTES", DEFAULT_JOB_STEPS_MAX_BYTES
        ),
        build=env.get("TAGALONG_BUILD") or None,
        started_by="desktop" if env.get("TAGALONG_STARTED_BY") == "desktop" else "person",
    )


def _budget(text: str | None) -> float:
    if not text:
        return DEFAULT_DAILY_BUDGET_USD
    try:
        value = float(text)
    except ValueError:
        raise ValueError(f"bad TAGALONG_DAILY_BUDGET_USD: {text!r}") from None
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"TAGALONG_DAILY_BUDGET_USD must be positive: {text!r}")
    return value


def _positive_usd(env: Mapping[str, str], name: str, default: float) -> float:
    text = env.get(name)
    if not text:
        return default
    try:
        value = float(text)
    except ValueError:
        raise ValueError(f"bad {name}: {text!r}") from None
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be positive: {text!r}")
    return value


def _job_quiet_min(text: str | None) -> float:
    if not text:
        return DEFAULT_JOB_QUIET_MIN
    try:
        value = float(text)
    except ValueError:
        raise ValueError(f"bad TAGALONG_JOB_QUIET_MIN: {text!r}") from None
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"TAGALONG_JOB_QUIET_MIN must be positive: {text!r}")
    return value


def _expert_idle(text: str | None) -> float:
    if not text:
        return DEFAULT_EXPERT_IDLE_S
    try:
        value = float(text)
    except ValueError:
        raise ValueError(f"bad TAGALONG_EXPERT_IDLE_S: {text!r}") from None
    if not math.isfinite(value) or value < 0:  # 0 stops the adapter as soon as it is idle
        raise ValueError(f"TAGALONG_EXPERT_IDLE_S must be 0 or more: {text!r}")
    return value


def _turn_timeout(text: str | None) -> float:
    if not text:
        return DEFAULT_TURN_TIMEOUT_S
    try:
        value = float(text)
    except ValueError:
        raise ValueError(f"bad TAGALONG_TURN_TIMEOUT_S: {text!r}") from None
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"TAGALONG_TURN_TIMEOUT_S must be positive: {text!r}")
    return value


def _step_cap(text: str | None) -> int:
    if not text:
        return DEFAULT_STEP_CAP
    try:
        value = int(text)
    except ValueError:
        raise ValueError(f"bad TAGALONG_STEP_CAP: {text!r}") from None
    if value < 1:
        raise ValueError(f"TAGALONG_STEP_CAP must be at least 1: {text!r}")
    return value


def _wakes_per_hour(text: str | None) -> int:
    if not text:
        return DEFAULT_WAKES_PER_HOUR
    try:
        value = int(text)
    except ValueError:
        raise ValueError(f"bad TAGALONG_WAKES_PER_HOUR: {text!r}") from None
    if value < 1:
        raise ValueError(f"TAGALONG_WAKES_PER_HOUR must be at least 1: {text!r}")
    return value


def _positive_int(env: Mapping[str, str], name: str, default: int) -> int:
    text = env.get(name)
    if not text:
        return default
    try:
        value = int(text)
    except ValueError:
        raise ValueError(f"bad {name}: {text!r}") from None
    if value < 1:
        raise ValueError(f"{name} must be at least 1: {text!r}")
    return value


def _backoff(text: str | None) -> tuple[int, ...]:
    if not text:
        return DEFAULT_RETRY_BACKOFF_S
    try:
        waits = tuple(int(part) for part in text.split(","))
    except ValueError:
        raise ValueError(f"bad TAGALONG_RETRY_BACKOFF_S: {text!r}") from None
    if any(w < 1 for w in waits):
        raise ValueError(f"TAGALONG_RETRY_BACKOFF_S needs whole seconds of at least 1: {text!r}")
    return waits


def load_env_file(data_dir: Path, env: MutableMapping[str, str]) -> None:
    """Fill keys from data_dir/.env that env lacks; the real environment always wins."""
    path = data_dir / ".env"
    if not path.exists():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise ValueError(f"cannot read {path}: the file is not UTF-8 text") from None
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if not env.get(key):  # an empty variable counts as unset
            env[key] = value


def upsert_env_value(
    data_dir: Path, name: str, value: str, env: MutableMapping[str, str] = os.environ
) -> None:
    """Set one NAME=value line; see upsert_env_values."""
    upsert_env_values(data_dir, {name: value}, env)


def upsert_env_values(
    data_dir: Path, values: dict[str, str], env: MutableMapping[str, str] = os.environ
) -> None:
    """Set NAME=value lines in data_dir/.env in one read and one write, keeping every other
    line, comment and line ending. Written to a temp file and renamed over, so a crash never
    leaves half a file and several values land together or not at all. The running
    environment changes only after the file is saved."""
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / ".env"
    text = path.read_bytes().decode("utf-8") if path.exists() else ""
    eol = "\r\n" if "\r\n" in text else "\n"
    lines = text.splitlines(keepends=True)
    for name, value in values.items():
        new = f"{name}={value}"
        for i, line in enumerate(lines):
            if "=" in line and line.partition("=")[0].strip() == name:
                lines[i] = new + line[len(line.rstrip("\r\n")) :]
                break
        else:
            if lines and not lines[-1].endswith(("\n", "\r")):
                lines[-1] += eol
            lines.append(new + eol)
    tmp = data_dir / ".env.tmp"
    try:
        # Owner-only from creation, so the key is never briefly world-readable.
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write("".join(lines).encode("utf-8"))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise
    env.update(values)


def session_id(data_dir: Path) -> str:
    path = data_dir / "session"
    if path.exists():
        existing = path.read_text().strip()
        if existing:
            return existing
    data_dir.mkdir(parents=True, exist_ok=True)
    new = uuid.uuid4().hex
    path.write_text(new)
    return new
