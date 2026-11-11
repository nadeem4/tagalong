"""Scout's asks as open items: a turn never waits for a card, and an answer runs the call later.

A tool call that needs the person's yes opens an `ask` open item holding the call and puts a card
on screen; the turn is told the ask is open and goes on. The answer, whenever it comes (even
after the turn ended or the brain restarted), runs the saved call through the same gate: the
floor and the person's answer, then the tool, and wakes Scout with the facts. It also ends an ask
at its deadline, and on a body's return shows cards again and tells Scout which asks wait.
"""

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from brain.approvals import Approvals
from brain.asks import Asks
from brain.events import Event
from brain.mind.turn import Call
from brain.open_items import DEADLINE_S, OpenItem, OpenItemRefused, OpenItems
from brain.permission import AskRequest, PersonAnswer, Tier, summarise
from brain.protocol import RpcError
from brain.store.work import TransitionRefused

if TYPE_CHECKING:
    from brain.toolbox import Toolbox

log = logging.getLogger(__name__)

KIND = "ask"


def _call(item: OpenItem) -> Call:
    saved = item.saved_call or {}
    return Call(
        id=f"ask:{item.id}",
        name=saved.get("name") or "",
        input=saved.get("input") or {},
        turn="",
        text=saved.get("text") or "",
    )


def _notice_at(item: OpenItem) -> datetime:
    """Two-thirds of the way from opening to the deadline."""
    return item.created_at + (item.deadline_at - item.created_at) * 2 / 3


class AskRunner:
    def __init__(
        self,
        items: OpenItems,
        asks: Asks,
        toolbox: "Callable[[], Toolbox]",
        emit: Callable[..., None],  # the scheduler's emit
        now: Callable[[], datetime],
        approvals: Approvals,
    ) -> None:
        self._items = items
        self._asks = asks
        self._toolbox = toolbox
        self._emit = emit
        self._now = now
        self._approvals = approvals  # masks the saved call; logs an ask that expired
        self._tasks: set[asyncio.Task] = set()
        # The unmasked call of an ask that held a secret, for this process only: nothing secret is
        # saved, so after a restart such an ask cannot run.
        self._raw: dict[str, Call] = {}
        self._noticed: set[str] = set()
        self._handle: asyncio.TimerHandle | None = None

    def open(self, call: Call, req: AskRequest, wait: timedelta) -> OpenItem:
        """Save the call as an open item and put its card on screen. The same call again is the
        item already open, with no second card."""
        raw = {"name": call.name, "input": call.input, "text": call.text}
        saved = self._approvals.mask(raw)
        # A call with a secret in it is saved masked, so it cannot be run from the copy.
        saved = {**saved, "source": req.source, "masked": saved != raw}
        item = self._items.find_open(KIND, {"name": saved["name"], "input": saved["input"]})
        if item is not None:
            return item
        item = self._items.open(KIND, "brain", saved_call=saved, ttl_s=wait.total_seconds())
        if saved["masked"]:
            self._raw[item.id] = call
        self._asks.show(item.id, replace(call, input=req.input), req.tool, req.tier is not Tier.ask)
        self.changed()
        return item

    # ---- the answer ----

    def answered(self, ask_id: str, option: str, body_id: str) -> None:
        """A card was answered: count it and run the saved call, whatever became of the turn."""
        self._spawn(self._answer(ask_id, option, body_id))

    async def _answer(self, ask_id: str, option: str, body_id: str) -> None:
        before = self._items.get(ask_id)
        try:
            item = self._items.answer(ask_id, option, body_id)
        except OpenItemRefused as refused:
            if refused.reason == "expired" and before is not None and before.state == "open":
                self._expired(self._items.get(ask_id))  # this answer found it past its deadline
            return  # otherwise it ended first; its card is already closed
        try:
            await self._carry_out(item, option)
        except Exception:
            log.exception("an answered ask could not be carried out: %s", item.id)

    async def _carry_out(self, item: OpenItem, option: str) -> None:
        call = _call(item)
        raw = self._raw.pop(item.id, None)
        if option == "deny":  # before the gate: a tool that became auto must not outrun a no
            self._record_ask(item, "refused", "person", "the person said no")
            return self._end(item, "refused", "the person said no")
        if (item.saved_call or {}).get("masked"):
            if raw is None:
                return self._end(item, "failed", "held a secret")
            call = raw
        toolbox = self._toolbox()
        found = toolbox.spec_named(call.name)
        if found is None:
            return self._end(item, "failed", "that tool is gone")
        spec, kind = found
        req = await toolbox.ask_request(call, spec, kind, job_id=None, ask_id=item.id)

        async def said() -> PersonAnswer:
            return PersonAnswer(option)  # type: ignore[arg-type]

        # The person's answer goes through the engine like any decider's: the floor first, then
        # their word. The rule and side-check already had their say when the ask opened.
        decision = await toolbox.redecide(replace(req, can_allow_once=False, how_to_ask=said))
        if not decision.allowed:
            return self._end(item, "refused", decision.reason or "turned off")
        try:
            out = await toolbox.carry_out(call)
        except RpcError as err:
            return self._end(item, "failed", err.message)
        except Exception:
            log.exception("an answered call failed")
            return self._end(item, "failed", "the call raised an error")
        self._end(item, "approved", result=out if isinstance(out, str) else "")

    def _end(self, item: OpenItem, outcome: str, reason: str = "", result: str = "") -> None:
        """Close the item and wake Scout with what happened; he words it."""
        self._items.finish(item.id, outcome)
        self._raw.pop(item.id, None)
        self._noticed.discard(item.id)
        call = _call(item)
        facts: dict[str, str | int] = {
            "ask": item.id,
            "tool": call.name,
            "summary": summarise(call.text, call.name, call.input),
            "outcome": outcome,
        }
        if reason:
            facts["reason"] = reason
        if outcome == "approved":
            facts["result"] = result
        self._emit(Event("ask_ended", facts, key=f"ask:{item.id}"))

    # ---- deadline and restart ----

    def start(self) -> None:
        """Called once the toolbox exists. An answer whose call may or may not have run is
        closed and told, never run twice; asks that came due while the brain was away end."""
        for item in self._items.list_answered(KIND):
            self._end(item, "failed", "the brain restarted, so it is not known if it ran")
        # A notice already due was sent before the restart (or is moot): never send it again.
        now = self._now()
        for item in self._items.list_open(kind=KIND):
            if now >= _notice_at(item):
                self._noticed.add(item.id)
        self.fire_due()

    def changed(self) -> None:
        """Re-arm the one timer for the earliest moment among open asks: a notice not yet sent
        or a deadline."""
        if self._handle is not None:
            self._handle.cancel()
            self._handle = None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        due = [
            i.deadline_at if i.id in self._noticed else _notice_at(i)
            for i in self._items.list_open(kind=KIND)
        ]
        if due:
            self._handle = loop.call_later(
                max((min(due) - self._now()).total_seconds(), 0), self.fire_due
            )

    def fire_due(self) -> None:
        for item in self._items.expire_due(self._now(), KIND):
            self._expired(item)
        now = self._now()
        for item in self._items.list_open(kind=KIND):
            if item.id not in self._noticed and now >= _notice_at(item):
                self._noticed.add(item.id)
                call = _call(item)
                facts = {
                    "ask": item.id,
                    "tool": call.name,
                    "summary": summarise(call.text, call.name, call.input),
                    "age_s": int((now - item.created_at).total_seconds()),
                    "left_s": int((item.deadline_at - now).total_seconds()),
                }
                self._emit(Event("ask_notice", facts, key=f"ask:{item.id}"))
        self.changed()

    def _expired(self, item: OpenItem) -> None:
        """An ask ended unanswered: forget its extras, close the card, log it, tell Scout."""
        self._raw.pop(item.id, None)
        self._noticed.discard(item.id)
        self._asks.expire(item.id, "no answer")
        call = _call(item)
        summary = summarise(call.text, call.name, call.input)
        self._record_ask(item, "expired", "none", "no answer")
        facts: dict[str, str | int] = {
            "ask": item.id,
            "tool": call.name,
            "summary": summary,
            "outcome": "expired",
            "reason": "no answer",
        }
        self._emit(Event("ask_ended", facts, key=f"ask:{item.id}"))

    def _record_ask(self, item: OpenItem, outcome: str, by: str, reason: str) -> None:
        call = _call(item)
        try:
            self._approvals.record(
                source=(item.saved_call or {}).get("source") or "scout_tool",
                tool=call.name,
                summary=summarise(call.text, call.name, call.input),
                input=call.input,
                group_key=call.name,
                outcome=outcome,
                decided_by=by,
                ask_id=item.id,
                reason=reason,
            )
        except TransitionRefused:
            pass  # its row already ended

    # ---- return ----

    def returned(self, away_s: float | None) -> None:
        """A body that displays joined after `away_s` seconds (None: not seen before). Cards of
        items that ended while it was away are closed on it, every open ask whose card is not up
        is shown again, and Scout is told which of those wait and for how long."""
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return  # no loop yet (a body joining before the server runs)
        self._spawn(self._return(away_s))

    async def _return(self, away_s: float | None) -> None:
        now = self._now()
        # Without a known absence, look back one deadline: nothing older could still be showing.
        since = now - timedelta(seconds=DEADLINE_S if away_s is None else away_s)
        for item in self._items.expired_since(since):
            self._asks.card_closed(item.id)
        back: list[OpenItem] = []
        for item in self._items.list_open(kind=KIND):
            try:
                if not self._asks.is_open(item.id) and await self._show_again(item):
                    back.append(item)
                    continue
            except Exception:  # one card that cannot be built must not hide the others
                log.exception("an open ask could not be shown again: %s", item.id)
                continue
            # A card up already may have opened while no screen showed it: told if it is newer
            # than the absence.
            if (
                away_s is not None
                and item.created_at >= since
                and self._items.get(item.id).state == "open"
            ):
                back.append(item)
        if back:
            asks = [
                {
                    "ask": i.id,
                    "tool": _call(i).name,
                    "summary": summarise(_call(i).text, _call(i).name, _call(i).input),
                    "age_s": int((now - i.created_at).total_seconds()),
                }
                for i in back
            ]
            facts: dict[str, str | int] = {"count": len(asks), "asks": json.dumps(asks)}
            self._emit(Event("asks_waiting", facts, key="asks_waiting"))

    async def _show_again(self, item: OpenItem) -> bool:
        call = _call(item)
        toolbox = self._toolbox()
        found = toolbox.spec_named(call.name)
        if found is None:
            self._end(item, "failed", "that tool is gone")
            return False
        spec, kind = found
        req = await toolbox.ask_request(call, spec, kind, job_id=None, ask_id=item.id)
        if self._asks.is_open(item.id) or self._items.get(item.id).state != "open":
            return False  # another body's join got there first, or it ended meanwhile
        self._asks.show(
            item.id, replace(call, input=req.input), spec.name, req.tier is not Tier.ask
        )
        return True

    def _spawn(self, work) -> None:
        task = asyncio.get_running_loop().create_task(work)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
