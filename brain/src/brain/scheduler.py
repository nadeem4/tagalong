"""Scheduler for event wakes; this part builds the message Scout wakes to.
Facts come from outside (job reports, window titles), so the whole body is
fenced and cannot close its own <data> tag.
"""

from datetime import datetime

from brain.events import Event, EventKind
from brain.tools import _fence_safe


def wake_text(kind: EventKind, events: list[tuple[Event, datetime]], note: str) -> str:
    lines = [f"Event: {kind.name}", f"How to weigh it: {note}"]
    for event, at in events:
        lines.append(f"- at {at.strftime('%Y-%m-%d %H:%M %z')}")
        for name, value in event.facts.items():
            first, *rest = str(value).split("\n")
            lines.append(f"  {name}: {first}")
            lines.extend(f"    {r}" for r in rest)
    return f'<data kind="event">\n{_fence_safe(chr(10).join(lines))}\n</data>'
