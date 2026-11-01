"""Where Tagalong keeps what it sets up, all under TAGALONG_HOME and nowhere else.

Its own Node, installed expert packages, the registry cache and the installed-experts list live
here so nothing touches the system Node, PATH or global npm.
"""

from pathlib import Path


def node_dir(home: Path) -> Path:
    return home / "runtime" / "node"


def tools_dir(home: Path, expert_id: str) -> Path:
    return home / "tools" / expert_id


def cache_file(home: Path, name: str) -> Path:
    return home / "cache" / f"{name}-registry.json"


def experts_file(home: Path) -> Path:
    return home / "experts.json"
