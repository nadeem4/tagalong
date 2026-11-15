"""Tests for for_the_ear: times, money, dates and symbols rewritten as words, idempotently."""

import pytest

from brain.voice.ear_text import for_the_ear

CASES = [
    ("Meet at 3:30", "Meet at three thirty"),
    ("at 3:30pm", "at three thirty p m"),
    ("at 9:00", "at nine o'clock"),
    ("at 14:05", "at fourteen oh five"),
    ("It costs $5", "It costs five dollars"),
    ("$4.50", "four dollars fifty"),
    ("£1,200", "one thousand two hundred pounds"),
    ("€3", "three euros"),
    ("50%", "fifty percent"),
    ("3.5%", "three point five percent"),
    ("the 1st and 22nd", "the first and twenty second"),
    ("3rd", "third"),
    ("v1.2.3", "version one point two point three"),
    ("3.5", "three point five"),
    ("1,000", "one thousand"),
    ("2026", "twenty twenty six"),
    ("1234567", "1234567"),
    ("2026-11-14", "November fourteenth, twenty twenty six"),
    ("e.g. this", "for example this"),
    ("i.e. that", "that is that"),
    ("etc.", "and so on"),
    ("vs.", "versus"),
    ("Dr. Smith", "Doctor Smith"),
    ("R&D", "R and D"),
    ("this & that", "this and that"),
    ("and/or", "and or"),
    ("a -> b", "a to b"),
    ("a → b", "a to b"),
    ("100km/h", "one hundred kilometres per hour"),
    ("Great 🎉 job", "Great job"),
    ("Fine (see the docs) today", "Fine today"),
    ("", ""),
    ("   ", ""),
    ("I am fine.", "I am fine."),
    ("I had 40 cats and 7 dogs.", "I had forty cats and seven dogs."),
]


@pytest.mark.parametrize(("raw", "spoken"), CASES)
def test_for_the_ear(raw: str, spoken: str) -> None:
    assert for_the_ear(raw) == spoken


@pytest.mark.parametrize("spoken", [s for _, s in CASES])
def test_idempotent(spoken: str) -> None:
    assert for_the_ear(spoken) == spoken
