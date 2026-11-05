"""Quiet trigger: someone owes the person a reply and has gone quiet past the agreed time.

A reply cancels it through the reader: it closes the loop or turns it into one the person
owes, so only a still-waiting loop reaches here.
"""

from datetime import datetime

from brain.loops.loop import Loop


def anchor(loop: Loop) -> str:
    return f"quiet:{loop.quiet_after.isoformat()}" if loop.quiet_after else ""


def pending(loops: list[Loop]) -> list[Loop]:
    """Waiting-on loops whose quiet time is set and not yet announced."""
    return [
        lp
        for lp in loops
        if lp.direction == "they_owe" and lp.quiet_after and anchor(lp) not in lp.surfaced
    ]


def ripe(loops: list[Loop], now: datetime) -> list[Loop]:
    return [lp for lp in pending(loops) if lp.quiet_after <= now]  # type: ignore[operator]
