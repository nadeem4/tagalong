"""What this machine lets the brain run: command, args and the executable's SHA-256, kept in
one file the person approves entries into here. A spec that does not match an entry exactly is
refused, however genuine the brain asking; the brain never adds to this list.
"""

import hashlib
import json
import os
import shutil
from pathlib import Path

from brain.protocol import PipeSpec


class NotRunnable(Exception):
    pass


def _resolve(command: str) -> Path | None:
    found = shutil.which(command)
    return Path(found).resolve() if found else None


def _sha256(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


class Allowlist:
    def __init__(self, path: Path) -> None:
        self._path = path

    def allow(self, spec: PipeSpec) -> None:
        exe = _resolve(spec.command)
        digest = _sha256(exe) if exe else None
        if exe is None or digest is None:
            raise NotRunnable(f"{spec.command} is not a program on this machine.")
        entries = [e for e in self._entries() if not _same_spec(e, spec)]
        entries.append(
            {"command": spec.command, "args": spec.args, "path": str(exe), "sha256": digest}
        )
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(entries, indent=2), encoding="utf-8")
        os.replace(tmp, self._path)

    def permits(self, spec: PipeSpec) -> str | None:
        """The file to run when an entry matches the spec and the file is unchanged."""
        found = shutil.which(spec.command)
        if found is None:
            return None
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

    def _entries(self) -> list[dict]:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        return [e for e in data if isinstance(e, dict)] if isinstance(data, list) else []


def _same_spec(entry: dict, spec: PipeSpec) -> bool:
    return entry.get("command") == spec.command and entry.get("args") == spec.args
