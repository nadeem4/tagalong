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

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 47321
DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_DAILY_BUDGET_USD = 5.0
DEFAULT_STEP_CAP = 25
DEFAULT_EXPERT_CMD = "claude-agent-acp"
DEFAULT_EXPERT_TIMEOUT_S = 1800.0
DEFAULT_TURN_TIMEOUT_S = 300.0
DEFAULT_WAKES_PER_HOUR = 12
DEFAULT_OFFER_MIN_APPROVALS = 3
DEFAULT_OFFER_WINDOW_DAYS = 14
DEFAULT_KEEP_ASKING_DAYS = 7


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    data_dir: Path
    model: str = DEFAULT_MODEL
    daily_budget_usd: float = DEFAULT_DAILY_BUDGET_USD
    step_cap: int = DEFAULT_STEP_CAP
    expert_cmd: list[str] = field(default_factory=lambda: [DEFAULT_EXPERT_CMD])
    expert_timeout: float = DEFAULT_EXPERT_TIMEOUT_S
    turn_timeout: float = DEFAULT_TURN_TIMEOUT_S
    wakes_per_hour: int = DEFAULT_WAKES_PER_HOUR
    offer_min_approvals: int = DEFAULT_OFFER_MIN_APPROVALS
    offer_window_days: int = DEFAULT_OFFER_WINDOW_DAYS
    keep_asking_days: int = DEFAULT_KEEP_ASKING_DAYS


def split_command(cmd: str, posix: bool | None = None) -> list[str]:
    # POSIX shlex eats backslashes, which mangles C:\Users\... paths. Non-POSIX mode keeps
    # them, but also keeps the quotes, so strip those.
    if posix is None:
        posix = os.name != "nt"
    parts = shlex.split(cmd, posix=posix)
    if posix:
        return parts
    return [p[1:-1] if len(p) > 1 and p[0] == p[-1] and p[0] in "\"'" else p for p in parts]


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
        expert_cmd=split_command(env.get("TAGALONG_EXPERT_CMD") or DEFAULT_EXPERT_CMD),
        expert_timeout=_expert_timeout(env.get("TAGALONG_EXPERT_TIMEOUT_S")),
        turn_timeout=_turn_timeout(env.get("TAGALONG_TURN_TIMEOUT_S")),
        wakes_per_hour=_wakes_per_hour(env.get("TAGALONG_WAKES_PER_HOUR")),
        offer_min_approvals=_positive_int(
            env, "TAGALONG_OFFER_MIN_APPROVALS", DEFAULT_OFFER_MIN_APPROVALS
        ),
        offer_window_days=_positive_int(
            env, "TAGALONG_OFFER_WINDOW_DAYS", DEFAULT_OFFER_WINDOW_DAYS
        ),
        keep_asking_days=_positive_int(env, "TAGALONG_KEEP_ASKING_DAYS", DEFAULT_KEEP_ASKING_DAYS),
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


def _expert_timeout(text: str | None) -> float:
    if not text:
        return DEFAULT_EXPERT_TIMEOUT_S
    try:
        value = float(text)
    except ValueError:
        raise ValueError(f"bad TAGALONG_EXPERT_TIMEOUT_S: {text!r}") from None
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"TAGALONG_EXPERT_TIMEOUT_S must be positive: {text!r}")
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


def load_env_file(data_dir: Path, env: MutableMapping[str, str]) -> None:
    """Fill keys from data_dir/.env that env lacks; the real environment always wins."""
    path = data_dir / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        env.setdefault(key, value)


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
