"""Brain settings from environment variables, plus the persistent session id.

The session id lives in a file so it survives restarts: bodies compare it to tell a
restarted brain (new id) from a reconnect to the same one.
"""

import os
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 47321


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    data_dir: Path


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
    return Config(host=host, port=port, data_dir=data_dir)


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
