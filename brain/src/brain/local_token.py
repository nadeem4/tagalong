"""The token a body on this machine reads from the home folder to prove it is local."""

import secrets
from pathlib import Path

from brain.private_file import write_private


def load_or_create_local_token(home: Path) -> str:
    path = home / "local-token"
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    token = secrets.token_urlsafe(32)
    write_private(path, token)
    return token
