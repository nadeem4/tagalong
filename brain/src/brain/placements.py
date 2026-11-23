"""Where an expert or app runs: the brain, one body's node, or both with a preference.

`resolve_placement` is the whole decision and knows nothing of permissions: rules stay keyed by
app and tool, so a tool asks the same wherever it runs.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass

Location = str  # "brain" or a body id


class Unavailable(Exception):
    """The only place it may run is a node that is not connected."""

    def __init__(self, body_id: str) -> None:
        super().__init__(body_id)
        self.body_id = body_id


class Choose(Exception):
    """Both places can run it and the person is to say which."""

    def __init__(self, body_id: str) -> None:
        super().__init__(body_id)
        self.body_id = body_id


@dataclass(frozen=True)
class Placement:
    mode: str  # brain | body | both
    body_id: str | None = None
    prefer: str | None = None  # body | brain | ask, for both

    def __post_init__(self) -> None:
        if self.mode not in ("brain", "body", "both"):
            raise ValueError("mode must be brain, body or both.")
        if self.mode != "brain" and not self.body_id:
            raise ValueError("body and both need a body.")
        if self.mode == "both" and self.prefer not in ("body", "brain", "ask"):
            raise ValueError("both needs prefer body, brain or ask.")


def resolve_placement(
    placement: Placement | None, online: Callable[[str], bool], brain_can_run: bool = True
) -> Location:
    """Where one call runs. No placement means the brain."""
    if placement is None or placement.mode == "brain":
        return "brain"
    body = placement.body_id or ""
    up = online(body)
    if placement.mode == "body":
        if up:
            return body
        raise Unavailable(body)
    if placement.prefer == "ask" and up and brain_can_run:
        raise Choose(body)
    first, second = (body, "brain") if placement.prefer == "body" else ("brain", body)
    ready = {"brain": brain_can_run, body: up}
    for where in (first, second):
        if ready[where]:
            return where
    raise Unavailable(body)


class Placements:
    def __init__(self, db: sqlite3.Connection) -> None:
        self._db = db

    def get(self, kind: str, target_id: str) -> Placement | None:
        row = self._db.execute(
            "SELECT mode, body_id, prefer FROM placements WHERE target_kind=? AND target_id=?",
            (kind, target_id),
        ).fetchone()
        return None if row is None else Placement(*row)

    def set(self, kind: str, target_id: str, placement: Placement) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO placements(target_kind, target_id, mode, body_id, prefer)"
            " VALUES (?, ?, ?, ?, ?)",
            (kind, target_id, placement.mode, placement.body_id, placement.prefer),
        )

    def all(self, kind: str) -> dict[str, Placement]:
        rows = self._db.execute(
            "SELECT target_id, mode, body_id, prefer FROM placements WHERE target_kind=?", (kind,)
        )
        return {r[0]: Placement(*r[1:]) for r in rows}
