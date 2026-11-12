"""What a get-to-know-me run reports: each source's state and gap, and the portrait at the end.

Plain data; `params()` is the shape of the `know_me_status` frame, with unset values left out.
"""

from dataclasses import dataclass, field
from typing import Literal

SourceState = Literal["waiting", "reading", "done", "failed"]


@dataclass
class SourceProgress:
    name: str
    state: SourceState = "waiting"
    gap: str | None = None


@dataclass
class KnowMeStatus:
    sources: list[SourceProgress] = field(default_factory=list)
    done: bool = False
    portrait: str | None = None

    def params(self) -> dict:
        sources = []
        for s in self.sources:
            item = {"name": s.name, "state": s.state}
            if s.gap is not None:
                item["gap"] = s.gap
            sources.append(item)
        out: dict = {"sources": sources, "done": self.done}
        if self.portrait is not None:
            out["portrait"] = self.portrait
        return out
