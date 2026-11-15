"""What Scout says aloud: Markdown stripped, show-only blocks left out, split into sentences.

The model decides what is said; this only shapes it for the voice. Contains to_speakable,
find_sentence_end, DIVIDER and SpokenStream (a streaming reply, said sentence by sentence, up to
the divider that starts the on-screen part).
"""

import re
from collections.abc import Callable

# A line of exactly this ends the spoken part; what follows is shown, never said.
DIVIDER = "---"

_FENCE = "```"
_DIVIDER_LINE = re.compile(rf"^[ \t]*{DIVIDER}[ \t]*$")
# A line start that could still turn into the divider once more arrives.
_MAYBE_DIVIDER = re.compile(r"^[ \t]*-{1,3}[ \t]*$")
# A sentence mark with its closing quotes or brackets, or a line break: where a sentence may end.
_MARK = re.compile(r"[.!?]+[\"')\]’”]*|\n")
_CLOSERS = "\"')]’”"
# What may follow a sentence's end: a capital, a digit or an opening quote.
_NEXT_START = re.compile(r"[A-Z0-9\"'“‘]")
# A line that is a block of its own (list item, table row, quote, heading, fence, rule), judged
# from its start; and a start that may still turn into one once more text arrives.
_BLOCK_START = re.compile(
    r"[ \t]*(?:[-*+•][ \t]|\d+[.)][ \t]|\||>|#{1,6}[ \t]|```|-{3}[ \t]*(?:\n|$))"
)
_BLOCK_PARTIAL = re.compile(r"[ \t]*(?:[-*+•]|\d+[.)]?|-{1,3}|#{1,6}|`{1,2})?[ \t]*$")
# A full stop after these is not the end of a sentence.
_ABBREVIATIONS = frozenset("e.g. i.e. etc. vs. dr. mr. mrs. ms. prof. st. no. inc. approx.".split())
_INITIAL = re.compile(r"[A-Z]\.$")
_LIST_NUMBER = re.compile(r"\d+\.$")
_PARAGRAPH_END = re.compile(r"\n[ \t]*\n\s*$")
# A show-only line, judged from its start: a table row or a quote (a quote mostly holds a
# translation the English voice would mangle).
_SHOW_LINE = re.compile(r"^[ \t]*(?:\||>)")
_LIST_MARKER = re.compile(r"^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+")
# A line start that could still turn out to be a list marker once more arrives.
_MAYBE_LIST = re.compile(r"^[ \t]*(?:[-*+•]|\d+[.)]?)?$")


def to_speakable(text: str) -> str:
    """All of the text the voice should read: fenced code, table rows, quoted lines and bare
    URLs are left out, list markers and Markdown dropped. Nothing is added or cut."""
    if not text.strip():
        return ""
    without_blocks = re.sub(r"```[\s\S]*?(?:```|\Z)", "\n", text)
    lines = [ln for ln in without_blocks.split("\n") if not re.match(r"^\s*(?:>|\|)", ln)]
    lines = [re.sub(r"^\s*#{1,6}\s+", "", ln) for ln in lines]
    lines = [re.sub(r"^\s*(?:[-*+•]|\d+[.)])\s+", "", ln) for ln in lines]
    out = " ".join(lines)
    out = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", out)
    out = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", out)
    out = re.sub(r"`([^`]*)`", r"\1", out)
    out = re.sub(r"\*\*|__|\*", "", out)
    out = re.sub(r"https?://\S+", "", out)
    out = re.sub(r"\s+", " ", out)
    out = re.sub(r"\s+([.,!?;:])", r"\1", out)
    return out.strip()


def _block_start(rest: str, final: bool) -> bool | None:
    """Whether the line starting `rest` is a block of its own; None while that cannot be told."""
    if _BLOCK_START.match(rest):
        return True
    if not final and _BLOCK_PARTIAL.match(rest):
        return None
    return False


def _is_abbreviation(buffer: str, mark_start: int, mark_end: int) -> bool:
    """The full stop at `mark_start` closes an abbreviation, an initial or a list number."""
    if buffer[mark_start:mark_end].rstrip(_CLOSERS) != ".":
        return False
    start = max(buffer.rfind(" ", 0, mark_start), buffer.rfind("\n", 0, mark_start)) + 1
    token = buffer[start : mark_start + 1].lstrip("\"'([“‘")
    if token.lower() in _ABBREVIATIONS or _INITIAL.match(token):
        return True
    return bool(_LIST_NUMBER.match(token)) and (start == 0 or buffer[start - 1] == "\n")


def find_sentence_end(buffer: str, final: bool) -> int | None:
    """The index just past a sentence that is surely over, and the white space after it; else
    None. A mark ends one when a capital, digit or quote follows; a blank line always does; a
    single line break is a space unless the next line is a block of its own. Text that ends
    right after a candidate waits for more, unless `final`."""
    for m in _MARK.finditer(buffer):
        q = m.end()
        k = q
        while k < len(buffer) and buffer[k].isspace():
            k += 1
        if m.group() == "\n":
            if buffer.count("\n", m.start(), k) >= 2:
                return k
            line_start = buffer.rfind("\n", 0, m.start()) + 1
            if buffer[line_start : m.start()].lstrip().startswith("#"):
                return k  # a heading is a sentence of its own
            block = _block_start(buffer[k:], final)
            if block is None:
                return None
            if block:
                return k
            continue
        if _is_abbreviation(buffer, m.start(), q):
            continue
        if buffer.count("\n", q, k) >= 2:
            return k
        if k == q:
            if q == len(buffer):
                return q if final else None
            continue  # "3.5" or "v1.2.3": no space after the mark
        if k == len(buffer):
            return k if final else None
        if _NEXT_START.match(buffer[k]):
            return k
        if "\n" in buffer[q:k]:
            block = _block_start(buffer[k:], final)
            if block is None:
                return None
            if block:
                return k
    return None


class SpokenStream:
    """A reply said sentence by sentence while it streams: the first complete sentence goes out
    at once. Everything is said except show-only blocks (fenced code, table rows, quoted
    lines), each judged by how its line starts. `say` gets each sentence and whether a
    paragraph ended with it."""

    def __init__(self, say: Callable[[str, bool], None]) -> None:
        self._say = say
        self._buffer = ""
        self._in_code = False
        self._line_start = True  # the buffer starts a new line, which may be a list item
        self._in_show_line = False  # everything up to the next line break is dropped
        self._shown_only = False  # the divider was seen: nothing after it is said
        self._ended = False

    def push(self, delta: str) -> None:
        if self._ended or self._shown_only:
            return
        self._buffer += delta
        self._drain(final=False)

    def end(self) -> None:
        if self._ended:
            return
        if not self._shown_only:
            self._drain(final=True)
        self._ended = True

    def _drain(self, final: bool) -> None:
        while True:
            if self._in_code:
                close = self._buffer.find(_FENCE)
                if close == -1:
                    # Keep a fence's first backticks, in case the rest is still on its way.
                    self._buffer = "" if final else self._buffer[-2:]
                    return
                self._buffer = self._buffer[close + len(_FENCE) :]
                self._in_code = False
                continue
            if self._in_show_line:
                line_end = self._buffer.find("\n")
                if line_end == -1:
                    self._buffer = ""
                    return
                self._buffer = self._buffer[line_end + 1 :]
                self._in_show_line = False
                self._line_start = True
                continue
            if self._line_start:
                first_line = self._buffer.split("\n", 1)[0]
                complete = final or "\n" in self._buffer
                if complete and _DIVIDER_LINE.match(first_line):
                    self._shown_only = True
                    self._buffer = ""
                    return
                if not complete and _MAYBE_DIVIDER.match(first_line):
                    return
                if _SHOW_LINE.match(first_line):
                    self._in_show_line = True
                    continue
                # "1" or "-" alone may be a list marker whose rest has not arrived yet.
                if not final and "\n" not in self._buffer and _MAYBE_LIST.match(first_line):
                    return
                self._buffer = _LIST_MARKER.sub("", self._buffer, count=1)
                self._line_start = False
            fence = self._buffer.find(_FENCE)
            end = find_sentence_end(self._buffer, final)
            if fence != -1 and (end is None or fence < end):
                self._speak(self._buffer[:fence], False)
                self._buffer = self._buffer[fence + len(_FENCE) :]
                self._in_code = True
                continue
            if end is not None:
                piece = self._buffer[:end]
                self._speak(piece, bool(_PARAGRAPH_END.search(piece)))
                self._buffer = self._buffer[end:]
                if "\n" in piece[len(piece.rstrip()) :]:
                    self._line_start = True
                continue
            if final:
                self._speak(self._buffer, False)
                self._buffer = ""
            return

    def _speak(self, piece: str, paragraph_end: bool) -> None:
        line = to_speakable(piece)
        if re.search(r"\w", line):  # a lone "-" or "--" is no speech
            self._say(line, paragraph_end)
