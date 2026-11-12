"""The attention framework replaced these paths; none of their names may come back.

A name left behind is a second way to do the same thing. The scan covers the brain's source and
the bodies' source. `Session._inbox` is deliberately not listed: it is the live way a say joins
the turn that is still reading (see docs/brain.md), not a leftover of the old design.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REMOVED = ["PARK_AFTER_S", "CLOSED_LINE", "MANY_LINE", "bargeIn", "WaitingAsks"]
SKIP = {"node_modules", "dist", "out", ".venv", "__pycache__"}


def _hits(pattern: str, base: Path, suffixes: tuple[str, ...]) -> list[str]:
    rx = re.compile(pattern)
    return [
        str(p.relative_to(ROOT))
        for p in base.rglob("*")
        if p.is_file()
        and p.suffix in suffixes
        and not SKIP & set(p.parts)
        and rx.search(p.read_text(encoding="utf-8", errors="ignore"))
    ]


def test_removed_names_are_gone_from_the_brain():
    for name in REMOVED:
        assert _hits(rf"\b{name}\b", ROOT / "brain" / "src", (".py", ".md")) == [], name


def test_removed_names_are_gone_from_the_bodies():
    for name in REMOVED:
        for body in (ROOT / "bodies").glob("*/src"):
            assert _hits(rf"\b{name}\b", body, (".ts", ".tsx")) == [], name


def test_the_scheduler_module_is_gone_and_nothing_imports_it():
    src = ROOT / "brain" / "src" / "brain"
    assert not (src / "scheduler.py").exists()
    assert _hits(r"\bscheduler\b", src, (".py",)) == []


def test_the_waiting_module_and_park_path_are_gone():
    src = ROOT / "brain" / "src" / "brain"
    assert not (src / "waiting.py").exists()
    assert _hits(r"def park|\.park\(", src, (".py",)) == []
