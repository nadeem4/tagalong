"""Masking secrets in text before it is saved: the `save` guard, a JSON walker and a log filter.

Exact secret values (read fresh each call) and common key shapes become `[secret]`. Scout's live
turn is not masked; only what reaches disk or logs. A masker that fails withholds the text.
"""

import logging
import re
from collections.abc import Callable, Iterable
from typing import Any

from brain.guards import ALLOW, Guard, Guards, Hook, SaveCtx, Verdict, rewrite

_MIN_LEN = 8  # shorter values would mask ordinary words
WITHHELD = "[withheld]"

_SHAPES = [
    (re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"), "[secret]"),
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}"), r"\1[secret]"),
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}"), "[secret]"),
    (re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}"), "[secret]"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "[secret]"),
    (
        re.compile(
            r"""([?&](?:token|access_token|api_key|apikey|key|secret|password|sig|signature)=)"""
            r"""[^&\s"']+"""
        ),
        r"\1[secret]",
    ),
]


class Masker:
    def __init__(self, values: Callable[[], Iterable[str | None]]) -> None:
        self._values = values

    def mask(self, text: str) -> str:
        exact = {v for v in self._values() if v and len(v) >= _MIN_LEN}
        for v in sorted(exact, key=len, reverse=True):
            text = text.replace(v, "[secret]")
        for pattern, repl in _SHAPES:
            text = pattern.sub(repl, text)
        return text


class SecretLogFilter(logging.Filter):
    """Masks a record's message and traceback on the handler, so every logger is covered.

    It calls the masker directly, not the guard runner: the runner can log, and a log line
    that logs would loop. A masker that fails withholds the line.
    """

    def __init__(self, masker: Masker) -> None:
        super().__init__()
        self._masker = masker

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = self._masker.mask(record.getMessage())
            exc = None
            if record.exc_info and record.exc_info[0] is not None:
                exc = self._masker.mask(logging.Formatter().formatException(record.exc_info))
            stack = self._masker.mask(record.stack_info) if record.stack_info else None
        except Exception:
            msg, exc, stack = WITHHELD, (WITHHELD if record.exc_info else None), None
        record.msg, record.args = msg, None
        record.exc_text = exc  # the formatter reuses it instead of formatting the raw traceback
        record.stack_info = stack
        return True


def mask_secrets(masker: Masker) -> Guard:
    def check(ctx: SaveCtx) -> Verdict:
        masked = masker.mask(ctx.text)
        return rewrite(masked) if masked != ctx.text else ALLOW

    return Guard("mask_secrets", Hook.save, check)


def mask_json(guards: Guards, what: str, obj: Any) -> Any:
    """A masked copy of dicts, lists and strings; a blocked string becomes `[withheld]`."""
    if isinstance(obj, str):
        v = guards.run_sync(Hook.save, SaveCtx(what, obj))  # type: ignore[arg-type]
        if v.kind == "rewrite":
            return v.value
        return WITHHELD if v.kind in ("block", "stop") else obj
    if isinstance(obj, dict):
        return {k: mask_json(guards, what, v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [mask_json(guards, what, v) for v in obj]
    return obj
