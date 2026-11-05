"""The loops reader: one mail item (plus the related open loops) in, one loop change out.

Mail is untrusted, so it goes to the model inside a fenced, labelled block and the model may
answer only through the `loop_change` tool schema; any other output is dropped. A code
pre-filter drops bulk mail first, and the reader spends its own small daily allowance.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from functools import cache
from importlib.resources import files
from typing import Literal, Protocol

from brain.loops.loop import Loop
from brain.mind.turn import Final, Model

log = logging.getLogger(__name__)

BODY_MAX = 6000  # chars of one mail sent to the model; the rest is cost without signal
_NO_REPLY = ("noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "do_not_reply")
_BULK = ("bulk", "list", "junk")

TOOLS = [
    {
        "name": "loop_change",
        "description": "Record what this mail does to the person's open loops.",
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["new", "update", "close", "ignore"]},
                "loop_id": {"type": "string", "description": "for update and close"},
                "title": {"type": "string"},
                "asks": {"type": "string"},
                "direction": {"type": "string", "enum": ["i_owe", "they_owe"]},
                "people": {"type": "array", "items": {"type": "string"}},
                "due": {"type": "string", "description": "ISO 8601"},
                "quiet_after": {"type": "string", "description": "ISO 8601, for they_owe"},
                "anchors": {"type": "array", "items": {"type": "string"}},
                "urgent": {"type": "boolean"},
                "reason": {"type": "string", "description": "for close and ignore"},
            },
            "required": ["kind"],
        },
    }
]


class ReaderStopped(Exception):
    """The reader cannot read now (allowance spent, or no key); the service shows 'unread since'."""


@dataclass(frozen=True)
class MailItem:
    app: str
    thread: str
    sender: str
    subject: str
    date: datetime
    body: str
    headers: dict[str, str] = field(default_factory=dict)
    sent: bool = False  # the person's own mail, from the Sent folder


@dataclass(frozen=True)
class Change:
    kind: Literal["new", "update", "close", "ignore"]
    loop_id: str = ""
    title: str = ""
    asks: str = ""
    direction: Literal["i_owe", "they_owe"] = "i_owe"
    people: list[str] = field(default_factory=list)
    due: datetime | None = None
    quiet_after: datetime | None = None
    anchors: list[str] = field(default_factory=list)
    urgent: bool = False
    reason: str = ""


class Reader(Protocol):
    async def read(self, item: MailItem, related: list[Loop]) -> Change: ...


def prefilter(item: MailItem) -> str | None:
    """Why this mail is bulk and never worth a model call, or None to read it."""
    headers = {k.lower(): v.strip().lower() for k, v in item.headers.items()}
    if "list-unsubscribe" in headers:
        return "list-unsubscribe"
    if headers.get("precedence") in _BULK:
        return "bulk precedence"
    auto = headers.get("auto-submitted", "")
    if auto and auto != "no":
        return "auto-submitted"
    address = item.sender.lower().rpartition("<")[2]
    if any(name in address for name in _NO_REPLY):
        return "no-reply sender"
    return None


@cache
def _system() -> str:
    return files("brain.mind").joinpath("reader.md").read_text(encoding="utf-8")


def _esc(text: str) -> str:
    # The mail cannot close its own fence if it has no angle brackets.
    return text.replace("<", "&lt;")


def _prompt(item: MailItem, related: list[Loop]) -> str:
    loops = "\n".join(
        f"- id {lp.id}: {_esc(lp.title)} | {lp.direction} | asks: {_esc(lp.asks)} "
        f"| people: {_esc(', '.join(lp.people))}"
        for lp in related
    )
    return (
        "Open loops that may relate (ids for update or close):\n"
        f"{loops or '(none)'}\n\n"
        f'<mail untrusted="true" app="{_esc(item.app)}" thread="{_esc(item.thread)}" '
        f'from_me="{str(item.sent).lower()}">\n'
        f"From: {_esc(item.sender)}\nDate: {item.date.isoformat()}\n"
        f"Subject: {_esc(item.subject)}\n\n{_esc(item.body[:BODY_MAX])}\n</mail>"
    )


def _ignore(reason: str) -> Change:
    return Change("ignore", reason=reason)


def _when(value) -> datetime | None:
    try:
        return datetime.fromisoformat(value) if isinstance(value, str) and value else None
    except ValueError:
        return None


def _strings(value) -> list[str]:
    return (
        [s.strip() for s in value if isinstance(s, str) and s.strip()]
        if isinstance(value, list)
        else []
    )


def _text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


class HaikuReader:
    def __init__(self, model: Model, budget) -> None:
        self._model = model
        self._budget = budget

    async def read(self, item: MailItem, related: list[Loop]) -> Change:
        if not self._model.ready or not self._budget.allows():
            raise ReaderStopped
        final = None
        try:
            messages = [{"role": "user", "content": _prompt(item, related)}]
            async for part in self._model.stream(_system(), messages, TOOLS):
                if isinstance(part, Final):
                    final = part
        except Exception:  # one unreadable mail never stops the poll
            log.exception("reader call failed")
            return _ignore("reader call failed")
        if final is None:
            return _ignore("no answer")
        self._budget.spend(final.usage, final.model or self._model.model_id)
        call = next(
            (
                b
                for b in final.content
                if b.get("type") == "tool_use" and b.get("name") == "loop_change"
            ),
            None,
        )
        if call is None:
            log.warning("reader gave no loop_change call; mail ignored")
            return _ignore("no loop_change call")
        return self._change(call.get("input") or {}, related)

    @staticmethod
    def _change(data: dict, related: list[Loop]) -> Change:
        kind = data.get("kind")
        loop_id = _text(data.get("loop_id"))
        reason = _text(data.get("reason"))
        if kind in ("update", "close"):
            if loop_id not in {lp.id for lp in related}:
                return _ignore("unknown loop id")
            if kind == "close":
                return Change("close", loop_id=loop_id, reason=reason)
        elif kind == "new":
            if not _text(data.get("title")):
                return _ignore("new loop without a title")
        elif kind != "ignore":
            return _ignore("unknown kind")
        direction = data.get("direction")
        return Change(
            kind,
            loop_id=loop_id,
            title=_text(data.get("title")),
            asks=_text(data.get("asks")),
            direction=direction if direction in ("i_owe", "they_owe") else "i_owe",
            people=_strings(data.get("people")),
            due=_when(data.get("due")),
            quiet_after=_when(data.get("quiet_after")),
            anchors=_strings(data.get("anchors")),
            urgent=data.get("urgent") is True,
            reason=reason,
        )
