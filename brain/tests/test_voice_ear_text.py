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
    ("$3.2B", "three point two billion dollars"),
    ("$5k", "five thousand dollars"),
    ("$1.5", "one point five dollars"),
    ("$12.5M", "twelve point five million dollars"),
    ("$3.50", "three dollars fifty"),
    ("$5abc", "$5abc"),
    ("1.2.3", "1.2.3"),
    ("2.5x", "2.5x"),
    ("file_v1.2.txt", "file_v1.2.txt"),
    ("Version v1.2.3 is out.", "Version one point two point three is out."),
    ("-5", "minus five"),
    ("It was −3 degrees", "It was minus three degrees"),
    ("10-20", "ten to twenty"),
    ("5-10%", "five to ten percent"),
    ("3–5", "three to five"),
    ("555-1234", "555-1234"),
    ("COVID-19", "COVID-19"),
    ("well-known", "well-known"),
    ("60mph", "sixty miles per hour"),
    ("007", "007"),
    ("2026-13-01", "2026-13-01"),
    ("2026-02-30", "2026-02-30"),
    ("25:00", "25:00"),
    ("1999", "nineteen ninety nine"),
    ("1850", "eighteen fifty"),
    ("etc. Then", "and so on. Then"),
]


@pytest.mark.parametrize(("raw", "spoken"), CASES)
def test_for_the_ear(raw: str, spoken: str) -> None:
    assert for_the_ear(raw) == spoken


@pytest.mark.parametrize("spoken", [s for _, s in CASES])
def test_idempotent(spoken: str) -> None:
    assert for_the_ear(spoken) == spoken
