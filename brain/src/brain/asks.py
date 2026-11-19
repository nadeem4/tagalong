"""Asks: the cards on screen, and what an answer does.

`show` is Scout's own permission card and `card` is any other kind (choice, offer, preference,
an expert's ask): none has a waiter. The open item behind a card takes its answer: a handler
registered per kind with `register` runs it, and `on_item_answer` tells the session, which saves
the `card_answer`. Nothing in the brain awaits a card but `Holds`, on purpose, for an expert's
ACP call. The first answer wins; later ones are not_found. `expire` and `cancel` close a card for
every body. How the person's choice counts (approved, refused) is written by Approvals.
"""

from collections.abc import Callable
from dataclasses import dataclass

from brain.bodies import Bodies
from brain.mind.turn import Call
from brain.protocol import ErrorCode, RpcError
from brain.telemetry import ask_event


class AskExpired(Exception):
    """The ask ended without an answer because the job above it ended."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class _Open:
    params: dict
    free_text: bool = False
    kind: str = ""  # which handler takes the answer


Handler = Callable[[str, str, str, str | None, str | None], None]


def _nobody(*_: object) -> None:
    """A card of a kind nothing registered for: its answer is only logged."""


class Asks:
    def __init__(self, bodies: Bodies) -> None:
        self._bodies = bodies
        self._open: dict[str, _Open] = {}
        # Told (ask id, option, body id) of every card answered: the session saves the event.
        self.on_item_answer: Callable[[str, str, str], None] = lambda *_: None
        # The handler of each card kind: (ask id, option, body id, typed text, check_back_at).
        self._handlers: dict[str, Handler] = {}

    def anyone_online(self) -> bool:
        return bool(self._bodies.display_ids())  # a body that shows nothing cannot be asked

    def show(
        self, ask_id: str, call: Call, spec_name: str, locked: bool, task: dict | None = None
    ) -> None:
        """Put Scout's permission card on screen with nothing waiting on it. It belongs to no
        turn, so ending a turn never touches it; its answer goes to `on_item_answer`. A card of a
        task (`task`: its id and title, with the check-back and urgent fields) adds Not now and
        Stop task after its own options."""
        params = self._card(call, spec_name, locked, ask_id)
        self._with_task(params, task)
        ask_event("opened", ask_id, "brain", spec_name)
        self._publish(_Open(params, kind="ask"))

    @staticmethod
    def _with_task(params: dict, task: dict | None) -> None:
        if task and task.get("task"):
            params["options"] = [*params["options"], "not_now", "stop_task"]
            # Optional fields are left out, never null, on the wire.
            params.update({k: v for k, v in task.items() if v is not None})
            params["task"] = {k: v for k, v in task["task"].items() if v is not None}

    def register(self, kind: str, handler: Handler) -> None:
        """The code that takes the answer of every card of this kind."""
        self._handlers[kind] = handler

    def card(
        self,
        ask_id: str,
        *,
        kind: str,
        text: str,
        options: list[str],
        tool: str | None = None,
        input: dict | None = None,
        free_text: bool = False,
        recommended: str | None = None,
        confirm: bool = False,
        task: dict | None = None,
    ) -> None:
        """Put a card on screen and return: its open item takes the answer, whenever it comes, by
        the handler of its kind. Nothing waits here. `task` is a task card's fields (see `show`)."""
        if recommended is not None and recommended not in options:
            raise ValueError("recommended must be one of the options")
        params: dict = {"id": ask_id, "state": "open", "text": text, "options": options}
        # Bodies only learn a text box is wanted, or what is recommended, from these fields.
        if free_text:
            params["free_text"] = True
        if recommended is not None:
            params["recommended"] = recommended
        if tool is not None:
            params["tool"] = tool
        if input is not None:
            params["input"] = input
        if confirm:
            params["confirm"] = True  # the fixed allow, always, deny card of a tool call
        self._with_task(params, task)
        self._publish(_Open(params, free_text, kind))
        ask_event("opened", ask_id, "brain", tool or kind)

    def reschedule(self, ask_id: str, check_back_at: str, check_back_by: str) -> None:
        """Not now: the card stays open and every body is shown when it will be looked at again."""
        entry = self._open.get(ask_id)
        if entry is not None and "task" in entry.params:  # a plain card shows no time
            entry.params.update(check_back_at=check_back_at, check_back_by=check_back_by)
            self._bodies.notify("ask", entry.params)

    @staticmethod
    def _card(call: Call, spec_name: str, locked: bool, ask_id: str) -> dict:
        return {
            "id": ask_id,
            "state": "open",
            "text": call.text,
            "options": ["allow", "deny"] if locked else ["allow", "always", "deny"],
            "confirm": True,
            "tool": spec_name,
            "input": call.input,
        }

    def _publish(self, entry: _Open) -> None:
        ask_id = entry.params["id"]
        self._open[ask_id] = entry
        self._bodies.notify("ask", entry.params)
        shown = self._bodies.display_ids()
        if shown:
            ask_event("shown", ask_id, ",".join(shown))

    def answer(
        self,
        ask_id: str,
        option: str,
        body_id: str,
        text: str | None = None,
        check_back_at: str | None = None,
    ) -> None:
        entry = self._open.get(ask_id)
        if entry is None:
            raise RpcError(ErrorCode.not_found, f"no open ask {ask_id}")
        if option not in entry.params["options"] and not (entry.free_text and text):
            raise RpcError(ErrorCode.invalid_params, f"{option} is not offered by this ask")
        handler = self._handlers.get(entry.kind, _nobody)
        if option == "not_now":
            ask_event("answered", ask_id, body_id, option)
            self.on_item_answer(ask_id, option, body_id)
            handler(ask_id, option, body_id, text, check_back_at)
            return  # the card stays up; the open item moves its check-back and calls reschedule
        del self._open[ask_id]
        closed = {"id": ask_id, "state": "closed", "reason": "answered"}
        self._bodies.notify("ask", {**closed, "option": option, "by": body_id})
        ask_event("answered", ask_id, body_id, option)
        self.on_item_answer(ask_id, option, body_id)
        handler(ask_id, option, body_id, text, None)

    def expire(self, ask_id: str, reason: str) -> None:
        """The deadline passed: close the card for every body."""
        if self._open.pop(ask_id, None) is not None:
            ask_event("closed", ask_id, "brain", reason)
            self._bodies.notify("ask", {"id": ask_id, "state": "closed", "reason": "timeout"})

    def cancel(self, ask_id: str) -> None:
        """The wait behind a card was cancelled: close the card for every body."""
        if self._open.pop(ask_id, None) is not None:
            ask_event("closed", ask_id, "brain", "cancelled")
            self._bodies.notify("ask", {"id": ask_id, "state": "closed", "reason": "cancelled"})

    def close_answered(self, ask_id: str, by: str) -> None:
        """Close a card that has no waiter because something other than a body answered it (Scout's
        side-check). Nothing runs from this: the caller owns the item and carries on itself."""
        if self._open.pop(ask_id, None) is not None:
            ask_event("answered", ask_id, by, "allow")
            self._bodies.notify(
                "ask",
                {
                    "id": ask_id,
                    "state": "closed",
                    "reason": "answered",
                    "option": "allow",
                    "by": by,
                },
            )

    def card_closed(self, ask_id: str) -> None:
        """Tell the bodies a card ended while they were away; one that never showed it ignores
        this. The contract only has `timeout` for a card that ended unanswered, so one whose
        expert process ended reads the same."""
        self._bodies.notify("ask", {"id": ask_id, "state": "closed", "reason": "timeout"})

    def is_open(self, ask_id: str) -> bool:
        """The ask has a card showing in this session (a restart leaves none)."""
        return ask_id in self._open

    def open_asks(self) -> list[dict]:
        return [dict(e.params) for e in self._open.values()]
