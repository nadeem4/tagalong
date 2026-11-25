"""What this machine lets the brain run: command, args and the executable's SHA-256, or the exact
URL of an HTTP MCP server, kept in one file the person approves entries into here. A spec that
does not match an entry exactly is refused, however genuine the brain asking; the brain never
adds to this list. An entry also holds the secrets the person typed here for it (environment
values, a URL's secret query, a bearer token), so they never travel through the brain; the file
is owner-only. OAuth tokens from `tagalong node signin` sit beside it under `app-oauth/`.
"""

import hashlib
import json
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import NamedTuple

from brain.app_oauth import FileTokenStorage
from brain.private_file import write_private
from brain.protocol import PipeSpec


class NotRunnable(Exception):
    pass


class NotInstalled(Exception):
    pass


def resolve(command: str) -> Path | None:
    found = shutil.which(command)
    return Path(found).resolve() if found else None


def _sha256(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


class Secrets(NamedTuple):
    env: dict[str, str]
    url_query: str | None
    bearer: str | None


def oauth_storage(node_dir: Path, url: str) -> FileTokenStorage:
    return FileTokenStorage(node_dir, hashlib.sha256(url.encode()).hexdigest()[:24])


class Allowlist:
    def __init__(self, path: Path) -> None:
        self._path = path

    def allow(
        self,
        spec: PipeSpec,
        secret_env: dict[str, str] | None = None,
        url_query: str | None = None,
        bearer: str | None = None,
    ) -> None:
        """Approve a spec. Approving one again (after an update) keeps its secrets unless new
        ones are given."""
        existing = self._entries()
        entries = [e for e in existing if not _same_spec(e, spec)]
        prior = next((e for e in existing if _same_spec(e, spec)), {})
        env = secret_env if secret_env is not None else prior.get("secret_env")
        query = url_query if url_query is not None else prior.get("url_query")
        token = bearer if bearer is not None else prior.get("bearer")
        if spec.url is not None:
            entry: dict = {"url": spec.url}
        else:
            command = spec.command or ""
            exe = resolve(command)
            digest = _sha256(exe) if exe else None
            if exe is None or digest is None:
                raise NotRunnable(f"{command} is not a program on this machine.")
            entry = {"command": command, "args": spec.args, "path": str(exe), "sha256": digest}
        entry["at"] = prior.get("at") or datetime.now(UTC).isoformat(timespec="seconds")
        if env:
            entry["secret_env"] = env
        if query:
            entry["url_query"] = query
        if token:
            entry["bearer"] = token
        entries.append(entry)
        self._write(entries)

    def listing(self) -> list[dict]:
        """Each approval as the person sees it: a key to revoke it by, what it allows and when;
        never the secrets kept with it."""
        shown = ("command", "args", "url", "path", "at")
        return [{"key": _key(e), **{k: e[k] for k in shown if k in e}} for e in self._entries()]

    def revoke(self, key: str) -> bool:
        entries = self._entries()
        kept = [e for e in entries if _key(e) != key]
        if len(kept) == len(entries):
            return False
        self._write(kept)
        return True

    def secrets(self, spec: PipeSpec) -> Secrets:
        entry = next((e for e in self._entries() if _same_spec(e, spec)), {})
        return Secrets(
            dict(entry.get("secret_env", {})), entry.get("url_query"), entry.get("bearer")
        )

    @property
    def node_dir(self) -> Path:
        return self._path.parent

    def permits(self, spec: PipeSpec) -> str | None:
        """The file to run (or the url to relay to) when an entry matches the spec and the file
        is unchanged. A command that is not on the path at all raises NotInstalled."""
        if spec.url is not None:
            return spec.url if any(_same_spec(e, spec) for e in self._entries()) else None
        found = shutil.which(spec.command or "")
        if found is None:
            raise NotInstalled(spec.command)
        exe = Path(found).resolve()
        digest = _sha256(exe)
        for entry in self._entries():
            if (
                _same_spec(entry, spec)
                and entry.get("path") == str(exe)
                and digest is not None
                and entry.get("sha256") == digest
            ):
                # The link, not its target: a venv's python is a link and only finds the venv
                # when started through it. The target's hash is what was approved.
                return found
        return None

    def _write(self, entries: list[dict]) -> None:
        tmp = self._path.with_suffix(".tmp")
        write_private(tmp, json.dumps(entries, indent=2))
        os.replace(tmp, self._path)

    def _entries(self) -> list[dict]:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        return [e for e in data if isinstance(e, dict)] if isinstance(data, list) else []


def _key(entry: dict) -> str:
    spec = [entry.get("command"), entry.get("args", []), entry.get("url")]
    return hashlib.sha256(json.dumps(spec).encode()).hexdigest()[:16]


def _same_spec(entry: dict, spec: PipeSpec) -> bool:
    return (
        entry.get("command") == spec.command
        and entry.get("args", []) == spec.args
        and entry.get("url") == spec.url
    )
