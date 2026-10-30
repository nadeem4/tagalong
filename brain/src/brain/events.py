"""Event kinds Scout can be woken by, and the notes on how to weigh each.
A kind is data (batching, caps); the note is wording for the model, kept in
mind/events.md so code stays free of canned lines.
"""

from dataclasses import dataclass
from functools import cache
from importlib.resources import files

from pydantic import ValidationError

from brain.protocol import BackData, FocusData


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


_KINDS = (
    EventKind("timer", batch_seconds=0, max_per_hour=6),
    EventKind("job_ended", batch_seconds=30, max_per_hour=10),
    EventKind("body_online", batch_seconds=0, max_per_hour=2),
    EventKind("back", batch_seconds=0, max_per_hour=2),
    EventKind("job_question", batch_seconds=None, max_per_hour=None),
    EventKind("focus", wakes=False),
)
EVENT_KINDS: dict[str, EventKind] = {k.name: k for k in _KINDS}

# A body that returns sooner than this was just reconnecting, not away.
BODY_ONLINE_MIN_AWAY_S = 600


def from_body(body_id: str, name: str, data: object) -> Event | None:
    """An event a body reported, or None for an unknown name or data of the wrong shape.

    Bodies are untrusted input: nothing here may raise on a bad frame.
    """
    try:
        if name == "back":
            back = BackData.model_validate(data)
            return Event(
                "back", {"body": body_id, "idle_seconds": back.idle_seconds}, key=f"back:{body_id}"
            )
        if name == "focus":
            focus = FocusData.model_validate(data)
            facts = {"body": body_id, "app": focus.app, "title": focus.title[:200]}
            return Event("focus", facts, key=body_id)
    except ValidationError:
        return None
    return None


def from_connect(body_id: str, away_seconds: float | None, kind: str | None = None) -> Event | None:
    """Wake only when a body that was seen earlier comes back after a real absence.

    A browser opens and closes all day and is not the owner arriving, so it never wakes.
    """
    if kind == "browser" or away_seconds is None or away_seconds < BODY_ONLINE_MIN_AWAY_S:
        return None
    return Event(
        "body_online",
        {"body": body_id, "offline_seconds": int(away_seconds)},
        key=f"body_online:{body_id}",
    )


@cache
def load_notes() -> dict[str, str]:
    """One `## <kind>` section per kind in mind/events.md, body stripped."""
    text = files("brain.mind").joinpath("events.md").read_text(encoding="utf-8")
    notes: dict[str, str] = {}
    for part in ("\n" + text).split("\n## ")[1:]:
        name, _, body = part.partition("\n")
        notes[name.strip()] = body.strip()
    return notes
