"""Snooze trigger: a loop the person put off with Later comes back at the time they chose.

Separate from `due`, which stays the real deadline. The service moves a ripe loop back to
held before it surfaces, so the time is used once.
"""

from datetime import datetime

from brain.loops.loop import Loop


def anchor(loop: Loop) -> str:
    return f"later:{loop.snoozed_until.isoformat()}" if loop.snoozed_until else ""


def pending(loops: list[Loop]) -> list[Loop]:
    return [lp for lp in loops if lp.status == "snoozed" and lp.snoozed_until]


def ripe(loops: list[Loop], now: datetime) -> list[Loop]:
    return [lp for lp in pending(loops) if lp.snoozed_until <= now]  # type: ignore[operator]
