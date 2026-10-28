"""Event kinds Scout can be woken by, and the notes on how to weigh each.
A kind is data (batching, caps); the note is wording for the model, kept in
mind/events.md so code stays free of canned lines.
"""

from dataclasses import dataclass
from functools import cache
from importlib.resources import files


@dataclass(frozen=True)
class Event:
    kind: str
    facts: dict[str, str | int]
    # A newer pending event with the same kind and key replaces the older one.
    key: str | None = None


@dataclass(frozen=True)
class EventKind:
    name: str
    wakes: bool = True
    enabled: bool = True
    # None: never merged, one wake per event.
    batch_seconds: int | None = 0
    # None: exempt from the per-kind and the global cap.
    max_per_hour: int | None = None


_KINDS = (EventKind("job_ended", batch_seconds=30, max_per_hour=10),)
EVENT_KINDS: dict[str, EventKind] = {k.name: k for k in _KINDS}


@cache
def load_notes() -> dict[str, str]:
    """One `## <kind>` section per kind in mind/events.md, body stripped."""
    text = files("brain.mind").joinpath("events.md").read_text(encoding="utf-8")
    notes: dict[str, str] = {}
    for part in ("\n" + text).split("\n## ")[1:]:
        name, _, body = part.partition("\n")
        notes[name.strip()] = body.strip()
    return notes
