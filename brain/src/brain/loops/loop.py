"""The shape of one loop: something open, who owes it, and when it matters.

A plain dataclass; the store owns persistence and the service owns timing. Text fields
may come from mail, so they are untrusted data wherever they reach the model.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

Direction = Literal["i_owe", "they_owe"]
# Derived from the work row: planned is held (or snoozed while a Later time is set), done stays
# done, cancelled reads as dropped and expired as stale. Surfacing is an event, not a status.
Status = Literal["held", "snoozed", "done", "dropped", "stale"]


@dataclass
class Loop:
    source: str  # the connected app id the loop came from
    ref: str  # the source's own id (a thread id), so a repeat updates instead of duplicating
    title: str
    asks: str
    direction: Direction = "i_owe"
    people: list[str] = field(default_factory=list)
    due: datetime | None = None
    quiet_after: datetime | None = None
    # Window titles, files or pages that mean "you are working on this" (matched later).
    anchors: list[str] = field(default_factory=list)
    status: Status = "held"
    id: str = ""
    # anchor -> the local day it last surfaced, so one anchor surfaces once a day.
    surfaced: dict[str, str] = field(default_factory=dict)
    history: list[dict] = field(default_factory=list)
    created: datetime | None = None
    updated: datetime | None = None
    # Set while status is snoozed: when it comes back (Later). `due` stays the real deadline.
    snoozed_until: datetime | None = None
