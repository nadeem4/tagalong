"""The Source protocol: how the loops service reads one kind of app (mail first).

One real adapter today (`sources/gmail.py`); Outlook or a calendar would be another file with
the same methods, not a new feature. A source only reads, and drafts: nothing here sends
or changes anything in the person's account.
"""

from collections.abc import Iterable
from datetime import datetime
from typing import Protocol

from brain.loops.reader import MailItem


class Source(Protocol):
    @staticmethod
    def matches(tools: Iterable[str]) -> bool:
        """Whether a connected app's tool names are the ones this adapter understands."""
        ...

    async def new_items(self, since: datetime, unanswered_only: bool = False) -> list[MailItem]:
        """Mail that arrived after `since`; with `unanswered_only`, only each thread's last
        message, and only if it is not the person's own (the first-run backfill)."""
        ...

    async def sent_items(self, since: datetime) -> list[MailItem]:
        """The person's own mail sent after `since`."""
        ...

    async def draft_reply(self, thread: str, text: str) -> None:
        """Leave a draft in the thread. Never sends."""
        ...
