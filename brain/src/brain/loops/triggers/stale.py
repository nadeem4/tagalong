"""Stale trigger: a held loop nobody touched for N days is handed to one batched wake.

The model decides keep or drop; code only finds them, so Held does not fill up for ever.
"""

from datetime import datetime, timedelta

from brain.loops.loop import Loop


def ripe(loops: list[Loop], now: datetime, days: int) -> list[Loop]:
    cutoff = now - timedelta(days=days)
    return [lp for lp in loops if lp.status == "held" and lp.updated and lp.updated <= cutoff]
