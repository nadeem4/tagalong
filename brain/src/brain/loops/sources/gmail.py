"""The Gmail adapter for loops, over the connected Gmail app's tools through `Apps.call`.

Tool names, confirmed against the Gmail connector's published tool list (it lists
`search_threads`, `get_thread`, `create_draft` and `send_message`; no server was called):
  read:  `search_threads` (query in Gmail search syntax; returns thread ids) and `get_thread`
         (thread_id; returns the messages with from, subject, date, body and labels)
  draft: `create_draft` (thread_id, body)
The adapter may call only these three. `send_message` and every tool that changes the mailbox
stay out of reach, so loops never send mail or touch labels, archive or read state.
Replies are read tolerantly: a missing field becomes empty, a message without a date is skipped.
"""

import json
from collections.abc import Awaitable, Callable, Iterable
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

from brain.apps import AppError
from brain.loops.reader import MailItem

READ_TOOLS = ("search_threads", "get_thread")
DRAFT_TOOLS = ("create_draft",)
_ALLOWED = frozenset(READ_TOOLS + DRAFT_TOOLS)
_PAGE = 50  # threads per search page; the next-page token is followed to the end


def _when(value) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        at = datetime.fromisoformat(value)
    except ValueError:
        try:
            at = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def _text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


class GmailSource:
    def __init__(self, app_id: str, call: Callable[..., Awaitable]) -> None:
        self._app = app_id
        self._call_app = call  # Apps.call, so the toolbox gate (and its consent) is not involved

    @staticmethod
    def matches(tools: Iterable[str]) -> bool:
        return _ALLOWED <= set(tools)

    async def new_items(self, since: datetime, unanswered_only: bool = False) -> list[MailItem]:
        items: list[MailItem] = []
        for thread in await self._threads("in:inbox", since):
            messages = await self._messages(thread)
            if unanswered_only:
                last = messages[-1] if messages else None
                if last is not None and not last.sent and last.date > since:
                    items.append(last)
            else:
                items += [m for m in messages if not m.sent and m.date > since]
        return sorted(items, key=lambda m: m.date)

    async def sent_items(self, since: datetime) -> list[MailItem]:
        items: list[MailItem] = []
        for thread in await self._threads("in:sent", since):
            items += [m for m in await self._messages(thread) if m.sent and m.date > since]
        return sorted(items, key=lambda m: m.date)

    async def draft_reply(self, thread: str, text: str) -> None:
        await self._call("create_draft", {"thread_id": thread, "body": text})

    async def _threads(self, folder: str, since: datetime) -> list[str]:
        query = f"{folder} after:{int(since.timestamp())}"
        ids: list[str] = []
        token = ""
        seen = {token}
        while True:  # follow the next-page token, so a busy backfill loses no thread
            args = {"query": query, "page_size": _PAGE, **({"page_token": token} if token else {})}
            data = await self._call("search_threads", args)
            if not isinstance(data, dict):
                return ids
            found = data.get("threads")
            for t in found if isinstance(found, list) else []:
                tid = t.get("id") if isinstance(t, dict) else None
                if isinstance(tid, str) and tid:
                    ids.append(tid)
            token = data.get("next_page_token")
            if not isinstance(token, str) or token in seen:
                return ids
            seen.add(token)

    async def _messages(self, thread: str) -> list[MailItem]:
        data = await self._call("get_thread", {"thread_id": thread})
        raw = data.get("messages") if isinstance(data, dict) else None
        if not isinstance(raw, list):
            return []
        items = (self._item(thread, m) for m in raw if isinstance(m, dict))
        return sorted((m for m in items if m is not None), key=lambda m: m.date)

    def _item(self, thread: str, m: dict) -> MailItem | None:
        date = _when(m.get("date"))
        if date is None:
            return None
        labels = m.get("labels") or m.get("labelIds") or []
        headers = m.get("headers")
        return MailItem(
            app=self._app,
            thread=thread,
            sender=_text(m.get("from")),
            subject=_text(m.get("subject")),
            date=date,
            body=_text(m.get("body") or m.get("snippet")),
            headers=(
                {str(k): str(v) for k, v in headers.items()} if isinstance(headers, dict) else {}
            ),
            sent=isinstance(labels, list) and "SENT" in labels,
        )

    async def _call(self, tool: str, args: dict):
        if tool not in _ALLOWED:
            raise AppError(f"loops may not call {tool}.")
        result = await self._call_app(self._app, tool, args)
        text = "".join(getattr(b, "text", "") or "" for b in result.content)
        if result.is_error:
            raise AppError(text or f"{tool} failed.")
        try:
            return json.loads(text)
        except ValueError:
            return {}
