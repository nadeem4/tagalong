"""Urgent trigger: the reader flagged a new loop as urgent; say so once, not on every read."""

from brain.loops.loop import Loop

ANCHOR = "urgent"


def fresh(loop: Loop, flagged: bool) -> bool:
    return flagged and ANCHOR not in loop.surfaced
