"""What Scout says aloud: Markdown stripped, show-only blocks left out, split into sentences.

The model decides what is said; this only shapes it for the voice. Contains to_speakable,
merge_short_lines, SHORT_LINE and SpokenStream (a streaming reply, said sentence by sentence).
"""

import re
from collections.abc import Callable

# Below this a line is short enough that the voice says it badly on its own ("Done." clipped).
SHORT_LINE = 40

_FENCE = "```"
# The end of a sentence that is surely over: its mark and a space after it, or a line break.
_SENTENCE_END = re.compile(r"[.!?]+[\"')\]’”]*\s|\n")
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


def merge_short_lines(lines: list[str]) -> list[str]:
    """Join consecutive short lines into one; lines that arrive together read as one."""
    merged: list[str] = []
    for line in lines:
        if merged and len(merged[-1]) < SHORT_LINE:
            merged[-1] = f"{merged[-1]} {line}"
        else:
            merged.append(line)
    return merged


class SpokenStream:
    """A reply said sentence by sentence while it streams: the first complete sentence goes out
    at once. Everything is said except show-only blocks (fenced code, table rows, quoted
    lines), each judged by how its line starts."""

    def __init__(self, say: Callable[[str], None]) -> None:
        self._say = say
        self._buffer = ""
        self._in_code = False
        self._line_start = True  # the buffer starts a new line, which may be a list item
        self._in_show_line = False  # everything up to the next line break is dropped
        self._ended = False

    def push(self, delta: str) -> None:
        if self._ended:
            return
        self._buffer += delta
        self._drain(final=False)

    def end(self) -> None:
        if self._ended:
            return
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
                if _SHOW_LINE.match(first_line):
                    self._in_show_line = True
                    continue
                # "1" or "-" alone may be a list marker whose rest has not arrived yet.
                if not final and "\n" not in self._buffer and _MAYBE_LIST.match(first_line):
                    return
                self._buffer = _LIST_MARKER.sub("", self._buffer, count=1)
                self._line_start = False
            fence = self._buffer.find(_FENCE)
            match = _SENTENCE_END.search(self._buffer)
            end = -1 if match is None else match.end()
            if fence != -1 and (end == -1 or fence < end):
                self._speak(self._buffer[:fence])
                self._buffer = self._buffer[fence + len(_FENCE) :]
                self._in_code = True
                continue
            if match is not None:
                self._speak(self._buffer[:end])
                self._buffer = self._buffer[end:]
                if match.group().endswith("\n"):
                    self._line_start = True
                continue
            if final:
                self._speak(self._buffer)
                self._buffer = ""
            return

    def _speak(self, piece: str) -> None:
        line = to_speakable(piece)
        if line:
            self._say(line)
