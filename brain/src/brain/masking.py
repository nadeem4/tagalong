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
# Values of these keys are structure (roles, ids, block types), not content. They are exempt
# only on a message and its content blocks, never inside a tool's input or result, where the
# same names (`name`, `id`) can hold real secrets.
_STRUCTURAL = frozenset({"role", "type", "id", "tool_use_id", "name", "signature"})

_SHAPES = [
    (re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"), "[secret]"),
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}", re.IGNORECASE), r"\1[secret]"),
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}"), "[secret]"),
    (re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}"), "[secret]"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "[secret]"),
    (
        re.compile(
            r"""([?&](?:token|access_token|api_key|apikey|key|secret|password|sig|signature)=)"""
            r"""[^&\s"']+""",
            re.IGNORECASE,
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


def _mask_keeping(guards: Guards, what: str, d: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v if k in _STRUCTURAL and isinstance(v, str) else mask_json(guards, what, v)
        for k, v in d.items()
    }


def mask_message(guards: Guards, what: str, message: dict[str, Any]) -> dict[str, Any]:
    """A masked chat message. Structural values (role, type, id, ...) stay as they are on the
    message and its content blocks, so the saved chat rebuilds; everything inside them is masked.
    A `redacted_thinking` block is opaque and passes through."""
    out = _mask_keeping(guards, what, message)
    if isinstance(message.get("content"), list):
        out["content"] = [
            b
            if isinstance(b, dict) and b.get("type") == "redacted_thinking"
            else _mask_keeping(guards, what, b)
            if isinstance(b, dict)
            else mask_json(guards, what, b)
            for b in message["content"]
        ]
    return out
