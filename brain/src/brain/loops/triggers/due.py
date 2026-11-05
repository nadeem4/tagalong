"""Due trigger: a held or snoozed loop whose deadline has not yet been announced.

The announcement is recorded under a key made from the due time, so moving a deadline lets
it fire again and a restart never repeats it.
"""

from brain.loops.loop import Loop


def anchor(loop: Loop) -> str:
    return f"due:{loop.due.isoformat()}" if loop.due else ""


def pending(loops: list[Loop]) -> list[Loop]:
    """Loops with a due time not yet announced, earliest first."""
    return sorted(
        (lp for lp in loops if lp.due and anchor(lp) not in lp.surfaced),
        key=lambda lp: lp.due,  # type: ignore[arg-type, return-value]
    )
