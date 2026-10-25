"""Brain settings from environment variables, the optional .env file, and the session id.

The session id lives in a file so it survives restarts and every body sees one session.
It is informational: hello returns it and bodies never send it back.
"""

import math
import os
import uuid
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 47321
DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_DAILY_BUDGET_USD = 5.0
DEFAULT_STEP_CAP = 25


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    data_dir: Path
    model: str = DEFAULT_MODEL
    daily_budget_usd: float = DEFAULT_DAILY_BUDGET_USD
    step_cap: int = DEFAULT_STEP_CAP


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
