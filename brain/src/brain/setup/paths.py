"""Where Tagalong keeps what it sets up, all under TAGALONG_HOME and nowhere else.

Its own Node, installed expert packages, the registry cache and the installed-experts list live
here so nothing touches the system Node, PATH or global npm.
"""

import uuid
from pathlib import Path


def node_dir(home: Path) -> Path:
    return home / "runtime" / "node"


def tools_dir(home: Path, expert_id: str) -> Path:
    return home / "tools" / expert_id


def cache_file(home: Path, name: str) -> Path:
    return home / "cache" / f"{name}-registry.json"


def experts_file(home: Path) -> Path:
    return home / "experts.json"


def login_done_file(home: Path, expert_id: str) -> Path:
    """Where a login window's wrapper writes the exit code when the window's command ends."""
    # unique per start, so a window left over from an earlier login cannot end a newer wait
    return home / "cache" / f"login-{expert_id}-{uuid.uuid4().hex[:8]}.done"
