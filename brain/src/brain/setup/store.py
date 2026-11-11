"""The list of installed experts: one JSON file under TAGALONG_HOME.

Read afresh on every call because the CLI writes the same file (no watcher). Writes are atomic,
and a corrupt file is kept as `.bad` and read as empty, so a bad file never blocks setup.
"""

import json
import os
from collections.abc import Sequence
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Literal

from brain.setup.paths import experts_file


@dataclass(frozen=True)
class InstalledExpert:
    id: str
    name: str
    version: str
    command: list[str]
    source: Literal["registry", "custom"]
    logged_in: bool | None  # None: not checked yet
    # Which Node the command runs on, so a later change of the system Node can be re-checked;
    # None for an expert that needs no Node (a binary, a custom command).
    node: Literal["private", "system"] | None = None


def _row(raw: dict) -> InstalledExpert:
    if raw["source"] not in ("registry", "custom") or raw["logged_in"] not in (True, False, None):
        raise ValueError("bad row")
    command = raw["command"]
    if not isinstance(command, list) or not all(isinstance(c, str) for c in command):
        raise ValueError("bad command")
    if not isinstance(raw["id"], str):
        raise ValueError("bad id")
    if raw.get("node") not in ("private", "system", None):
        raise ValueError("bad node")
    return InstalledExpert(
        raw["id"],
        str(raw["name"]),
        str(raw["version"]),
        list(command),
        raw["source"],
        raw["logged_in"],
        raw.get("node"),
    )


def all_experts(store: "ExpertStore", custom_cmd: list[str]) -> list[InstalledExpert]:
    """Installed experts plus the TAGALONG_EXPERT_CMD override as one expert called "custom"."""
    custom = [InstalledExpert("custom", "Custom command", "", custom_cmd, "custom", None)]
    return [*store.list(), *(custom if custom_cmd else [])]


class ExpertStore:
    def __init__(self, home: Path) -> None:
        self._path = experts_file(home)

    def list(self) -> list[InstalledExpert]:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            rows = data["experts"]
            if not isinstance(rows, list):
                raise ValueError("experts is not a list")
        except FileNotFoundError:
            return []
        except (OSError, ValueError, KeyError, TypeError):
            self._keep_bad()
            return []
        out = []
        for raw in rows:
            try:
                out.append(_row(raw))
            except (KeyError, TypeError, ValueError):
                continue  # one bad row never hides the rest
        return out

    def get(self, expert_id: str) -> InstalledExpert | None:
        return next((e for e in self.list() if e.id == expert_id), None)

    def add(self, expert: InstalledExpert) -> None:
        rest = [e for e in self.list() if e.id != expert.id]
        self._write([*rest, expert])

    def set_login(self, expert_id: str, state: bool | None) -> None:
        rows = self.list()
        if any(e.id == expert_id for e in rows):
            self._write([replace(e, logged_in=state) if e.id == expert_id else e for e in rows])

    def remove(self, expert_id: str) -> None:
        self._write([e for e in self.list() if e.id != expert_id])

    def _write(self, rows: Sequence[InstalledExpert]) -> None:
        part = self._path.with_name(self._path.name + ".part")
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            part.write_text(json.dumps({"experts": [asdict(e) for e in rows]}), encoding="utf-8")
            os.replace(part, self._path)
        except BaseException:
            part.unlink(missing_ok=True)
            raise

    def _keep_bad(self) -> None:
        try:
            os.replace(self._path, self._path.with_name(self._path.name + ".bad"))
        except OSError:
            pass
