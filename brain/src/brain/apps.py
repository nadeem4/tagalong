"""Connected apps (MCP servers): the row type, slug and env helpers, and param validation.

The store lives in memory.py. Secrets never enter a row: `${VAR}` refs stay verbatim here and
are expanded only at connect time, and tokens go to their own file (never through validate_app).
"""

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

# Ids the brain's own bodies use; an app slug must never shadow them.
RESERVED_IDS = frozenset({"desktop", "extension", "brain"})
SLUG_MAX = 24
TRANSPORTS = ("stdio", "http")
AUTHS = ("none", "token", "oauth")
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_ENV_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


class AppError(Exception):
    """A refusal as one plain line the model or user can read and act on."""


@dataclass(frozen=True)
class AppRow:
    id: str
    name: str
    transport: str
    config: dict[str, Any]
    auth: str
    enabled: bool


def slug_for(name: str, taken: set[str] | frozenset[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:SLUG_MAX].strip("-") or "app"
    blocked = set(taken) | RESERVED_IDS
    if base not in blocked:
        return base
    n = 2
    while True:
        suffix = f"-{n}"
        slug = base[: SLUG_MAX - len(suffix)].rstrip("-") + suffix
        if slug not in blocked:
            return slug
        n += 1


def expand_env(value: str, env: dict[str, str] | Any) -> str:
    """Replace ${VAR} and ${VAR:-default}; an unset variable raises naming only the variable."""

    def sub(m: re.Match[str]) -> str:
        name, default = m.group(1), m.group(2)
        if name in env:
            return env[name]
        if default is not None:
            return default
        raise AppError(f"needs {name} set in brain's environment")

    return _ENV_REF.sub(sub, value)


def _check_stdio(config: dict[str, Any]) -> dict[str, Any]:
    command = config.get("command")
    if not isinstance(command, str) or not command.strip():
        raise AppError("a stdio app needs a command.")
    args = config.get("args", [])
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        raise AppError("args must be a list of strings.")
    env = config.get("env", {})
    if not isinstance(env, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in env.items()
    ):
        raise AppError("env must map names to strings.")
    return {"command": command, "args": args, "env": env}


def _check_http(config: dict[str, Any]) -> dict[str, Any]:
    url = config.get("url")
    if not isinstance(url, str) or not url.strip():
        raise AppError("an http app needs a url.")
    parts = urlparse(url)
    local = parts.hostname in _LOCAL_HOSTS
    if parts.scheme != "https" and not (parts.scheme == "http" and local):
        raise AppError("the url must use https (http is only allowed for localhost).")
    return {"url": url}


def validate_app(params: dict[str, Any], taken: set[str] | frozenset[str] = frozenset()) -> AppRow:
    if "token" in params:
        raise AppError("a token is never part of an app; it is stored separately.")
    name = params.get("name")
    if not isinstance(name, str) or not name.strip():
        raise AppError("the app needs a name.")
    transport = params.get("transport")
    if transport not in TRANSPORTS:
        raise AppError(f"transport must be one of: {', '.join(TRANSPORTS)}.")
    auth = params.get("auth", "none")
    if auth not in AUTHS:
        raise AppError(f"auth must be one of: {', '.join(AUTHS)}.")
    config = params.get("config")
    if not isinstance(config, dict):
        raise AppError("the app needs a config.")
    checked = _check_stdio(config) if transport == "stdio" else _check_http(config)
    name = name.strip()
    return AppRow(slug_for(name, taken), name, transport, checked, auth, True)
