"""Text rewritten for the ear: times, money, dates, numbers and symbols said as words.

A voice engine reads "3:30" or "$4.50" badly, so each sentence goes through for_the_ear before it
is spoken. Our own small ordered rules, no library: the table in tests/test_voice_ear_text.py is
the requirement. Order matters (dates and versions, then times, money, percent, units, plain
numbers). Pure and idempotent on text that is already words.
"""

import re
from datetime import date

_ONES = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen"
).split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
_MONTHS = (
    "January February March April May June July August September October November December"
).split()
_ORDINAL_WORD = {
    "one": "first",
    "two": "second",
    "three": "third",
    "five": "fifth",
    "eight": "eighth",
    "nine": "ninth",
    "twelve": "twelfth",
}
_SCALE = {"k": "thousand", "K": "thousand", "M": "million", "B": "billion", "bn": "billion"}
_MAX_SPOKEN = 999_999  # larger numbers stay digits for the engine
_CURRENCY = {"$": ("dollar", "dollars"), "£": ("pound", "pounds"), "€": ("euro", "euros")}
_EMOJI = re.compile("[\U0001f000-\U0001faff☀-➿⬀-⯿️‍]")


def _cardinal(n: int) -> str:
    """0 to 999,999 in words."""
    if n < 20:
        return _ONES[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        return _TENS[tens] + (f" {_ONES[ones]}" if ones else "")
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        return f"{_ONES[hundreds]} hundred" + (f" {_cardinal(rest)}" if rest else "")
    thousands, rest = divmod(n, 1000)
    return f"{_cardinal(thousands)} thousand" + (f" {_cardinal(rest)}" if rest else "")


def _ordinal(n: int) -> str:
    words = _cardinal(n).split(" ")
    last = words[-1]
    if last in _ORDINAL_WORD:
        words[-1] = _ORDINAL_WORD[last]
    elif last.endswith("y"):
        words[-1] = last[:-1] + "ieth"
    else:
        words[-1] = last + "th"
    return " ".join(words)


def _two_digits(n: int) -> str:
    """Minutes, cents and the end of a year: 5 is "oh five"."""
    return f"oh {_ONES[n]}" if n < 10 else _cardinal(n)


def _year(n: int) -> str:
    if 2000 <= n <= 2009:
        return "two thousand" + (f" {_ONES[n - 2000]}" if n > 2000 else "")
    head, tail = divmod(n, 100)
    return f"{_cardinal(head)} " + ("hundred" if tail == 0 else _two_digits(tail))


def _number(text: str, year: bool = True) -> str:
    """A plain, comma-grouped or decimal number as words; digits again when too large. A whole
    number from 1100 to 2099 reads as a year unless `year` is off (an amount)."""
    whole, _, fraction = text.partition(".")
    comma = "," in whole
    digits = whole.replace(",", "")
    if len(digits) > 1 and digits.startswith("0") and not fraction:
        return text  # an id or code, not a quantity
    n = int(digits)
    if n > _MAX_SPOKEN:
        spoken = digits
    elif year and not comma and not fraction and 1100 <= n <= 2099:
        spoken = _year(n)
    else:
        spoken = _cardinal(n)
    if fraction:
        spoken += " point " + " ".join(_ONES[int(d)] for d in fraction)
    return spoken


def _date(m: re.Match) -> str:
    year, month, day = int(m[1]), int(m[2]), int(m[3])
    try:
        date(year, month, day)
    except ValueError:
        return m[0]  # not a real day: left as written
    return f"{_MONTHS[month - 1]} {_ordinal(day)}, {_number(str(year))}"


def _version(m: re.Match) -> str:
    # "Version v1.2" keeps its own word; a bare "v1.2" gets one.
    return (m[1] or "version ") + " point ".join(_cardinal(int(p)) for p in m[2].split("."))


def _time(m: re.Match) -> str:
    hour, minute, suffix = int(m[1]), int(m[2]), m[3]
    if hour > 24 or minute > 59:
        return m[0]
    spoken = _cardinal(hour) + (" o'clock" if minute == 0 else f" {_two_digits(minute)}")
    return f"{spoken} {suffix[0].lower()} m" if suffix else spoken


def _money(m: re.Match) -> str:
    one, many = _CURRENCY[m[1]]
    whole, fraction, scale = m[2], m[3] or "", m[4]
    # Exactly two digits after a plain amount are cents; anything else is a decimal.
    cents = len(fraction) == 2 and not scale
    amount = _number(whole if cents or not fraction else f"{whole}.{fraction}", year=False)
    spoken = f"{amount} {_SCALE[scale]}" if scale else amount
    unit = one if whole == "1" and not fraction and not scale else many
    tail = f" {_two_digits(int(fraction))}" if cents and int(fraction) else ""
    return f"{spoken} {unit}{tail}"


# Each rule is (pattern, replacement); applied in this order.
_RULES: list[tuple[re.Pattern, object]] = [
    (re.compile(r"\s*\([^)]*\)"), ""),  # a bracketed aside is for the eye
    (re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)"), _date),
    (re.compile(r"(?<!\w)([Vv]ersion\s+)?v(\d+(?:\.\d+)+)(?!\w|\.\w)"), _version),
    # 10-20 is a range; longer runs of digits (phone numbers, codes) are left alone.
    (re.compile(r"(?<![\w-])(\d{1,3})\s?[-–]\s?(\d{1,3})(?![\w-])"), lambda m: f"{m[1]} to {m[2]}"),
    (re.compile(r"(?<!\w)[-−](?=\d)"), "minus "),
    (re.compile(r"(?<!\d)(\d{1,2}):(\d{2})(?:\s?([AaPp])[Mm])?(?![A-Za-z0-9])"), _time),
    (re.compile(r"([$£€])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(k|K|M|B|bn)?(?![\w])"), _money),
    (re.compile(r"(\d[\d,]*(?:\.\d+)?)%"), lambda m: f"{_number(m[1])} percent"),
    (
        re.compile(r"(\d+(?:\.\d+)?)\s?(km/h|mph)"),
        lambda m: _number(m[1]) + (" kilometres per hour" if m[2] == "km/h" else " miles per hour"),
    ),
    (
        re.compile(r"(?<![A-Za-z0-9])(\d+)(?:st|nd|rd|th)(?![A-Za-z0-9])"),
        lambda m: _ordinal(int(m[1])) if int(m[1]) <= _MAX_SPOKEN else m[0],
    ),
    (
        re.compile(
            r"(?<![\w.:])(?<!\d-)(?<![A-Za-z]-)(\d{1,3}(?:,\d{3})+|\d+)((?:\.\d+)?)(?![A-Za-z0-9])(?!\.\d|:\d|-\d)"
        ),
        lambda m: _number(m[1] + m[2]),
    ),
    (re.compile(r"(?<!\w)e\.g\."), "for example"),
    (re.compile(r"(?<!\w)i\.e\."), "that is"),
    (re.compile(r"(?<!\w)etc\.(?=\s+[A-Z])"), "and so on."),  # keeps the sentence mark
    (re.compile(r"(?<!\w)etc\."), "and so on"),
    (re.compile(r"(?<!\w)vs\."), "versus"),
    (re.compile(r"(?<!\w)Dr\."), "Doctor"),
    (re.compile(r"\band/or\b"), "and or"),
    (re.compile(r"\s*(?:->|→)\s*"), " to "),
    (re.compile(r"\s*&\s*"), " and "),
]


def for_the_ear(text: str) -> str:
    """`text` with numbers, times, money, dates and symbols written the way they are said."""
    out = _EMOJI.sub("", text)
    for pattern, repl in _RULES:
        out = pattern.sub(repl, out)  # type: ignore[arg-type]
    return re.sub(r"\s+", " ", out).strip()
