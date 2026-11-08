"""Scout asks that outlive their turn: parked while the person is away.

A tool call that needs the person's yes waits in its turn, then parks: the turn goes on and the
decision keeps running here. This module owns that still-running decision, finds a repeated call
for it, and carries the call out when the person finally answers, then wakes Scout with the facts.
It also gives each waiting ask an end: one notice at two-thirds of its wait and expiry at its
deadline, armed as a single `call_later` for the earliest moment.
"""

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from typing import TYPE_CHECKING

from brain.approvals import Approvals
from brain.asks import Asks
from brain.events import Event
from brain.mind.turn import Call
from brain.permission import AskRequest, Decision
from brain.protocol import RpcError
from brain.store.work import TransitionRefused, WorkRow, WorkStore

if TYPE_CHECKING:
    from brain.toolbox import Toolbox

log = logging.getLogger(__name__)


class WaitingAsks:
    def __init__(
        self,
        work: WorkStore,
        asks: Asks,
        toolbox: "Callable[[], Toolbox]",
        emit: Callable[..., None],  # (event, on_start=hook): the scheduler's emit
        now: Callable[[], datetime],
        approvals: Approvals,
    ) -> None:
        self._work = work
        self._asks = asks
        self._toolbox = toolbox
        self._emit = emit
        self._now = now
        self._approvals = approvals  # masks the saved call; logs an expiry with no waiter
        self._tasks: set[asyncio.Task] = set()
        self._claims: dict[str, str] = {}  # call key -> ask id, until its decision ends
        self._handle: asyncio.TimerHandle | None = None
        self._expiring: set[str] = set()  # freed at the deadline, their end not yet logged
        self._returning: asyncio.Task | None = None
        self._unseen: set[str] = set()  # waiting while nobody could see them, until shown again

    def claim(self, tool: str, input: dict, ask_id: str) -> str | None:
        """The ask already holding this very call, else register `ask_id` for it. Synchronous
        on purpose: two identical parallel calls must not both pass before either registers."""
        key = tool + json.dumps(self._approvals.mask(input), sort_keys=True, default=str)
        earlier = self._claims.get(key) or self.find(tool, input)
        if earlier is not None:
            return earlier
        self._claims[key] = ask_id
        return None

    def _ended(self, ask_id: str) -> None:
        self.release(ask_id)
        self._unseen.discard(ask_id)
        self._expiring.discard(ask_id)
        self.changed()

    def start(self) -> None:
        """Called once the toolbox exists: tell Scout of asks the restart expired, remember the
        survivors as unseen, and act on what came due while the brain was away."""
        for row in self._work.unreported(["ask"]):
            if row.parent_id is None and row.due_at is not None:  # Scout's own, ended at start
                self._tell_expired(row)
        self._unseen = {row.id for row in self._work.waiting_asks()}
        self.fire_due()

    def _tell_expired(self, row: WorkRow) -> None:
        detail = self._work.ask_detail(row.id) or {}
        decided = self._work.event_of(row.id, "decided")
        facts: dict[str, str | int] = {
            "ask": row.id,
            "tool": detail.get("tool") or "",
            "summary": detail.get("summary") or row.title,
            "outcome": "expired",
            "reason": (decided.data or {}).get("reason", "") if decided else "",
        }
        self._emit(
            Event("ask_ended", facts, key=f"ask:{row.id}"),
            on_start=lambda: self._work.mark_reported(row.id),
        )

    def changed(self) -> None:
        """Re-arm the one timer for the earliest notice or deadline among waiting asks."""
        if self._handle is not None:
            self._handle.cancel()
            self._handle = None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        moments = [at for _, at, _ in self._moments()]
        if moments:
            delay = (min(moments) - self._now()).total_seconds()
            self._handle = loop.call_later(max(delay, 0), self.fire_due)

    def _moments(self) -> list[tuple[WorkRow, datetime, str]]:
        """Each waiting ask's next moment: its notice if not yet given, else its deadline."""
        out = []
        for row in self._work.waiting_asks():
            if row.id in self._expiring or row.due_at is None:
                continue
            due = datetime.fromisoformat(row.due_at)
            if self._work.event_of(row.id, "notice") is None:
                start = datetime.fromisoformat(row.created_at)
                out.append((row, start + (due - start) * 2 / 3, "notice"))
            else:
                out.append((row, due, "expire"))
        return out

    def fire_due(self) -> None:
        now = self._now()
        rows = self._work.waiting_asks()
        self._expiring &= {r.id for r in rows}  # an id whose end never logged must not linger
        for row in rows:
            if row.id in self._expiring or row.due_at is None:
                continue
            try:
                due = datetime.fromisoformat(row.due_at)
                if now >= due:
                    self._expire(row)
                elif self._work.event_of(row.id, "notice") is None:
                    start = datetime.fromisoformat(row.created_at)
                    if now >= start + (due - start) * 2 / 3:
                        self._notice(row, now, due)
            except Exception:
                # One bad row must not stop the timer or the brain starting; skip it from now on
                # so the re-armed timer does not spin on it.
                log.exception("an ask could not be timed: %s", row.id)
                self._expiring.add(row.id)
        self.changed()

    def _notice(self, row: WorkRow, now: datetime, due: datetime) -> None:
        self._work.add_event(row.id, "notice")
        detail = self._work.ask_detail(row.id) or {}
        facts: dict[str, str | int] = {
            "ask": row.id,
            "tool": detail.get("tool") or "",
            "summary": detail.get("summary") or row.title,
            "age_s": int((now - datetime.fromisoformat(row.created_at)).total_seconds()),
            "left_s": int((due - now).total_seconds()),
        }
        self._emit(Event("ask_notice", facts, key=f"ask:{row.id}"))

    def _expire(self, row: WorkRow) -> None:
        """No answer by the deadline: the ask ends and runs nothing. A live ask is freed so its
        adopted decision logs the end and wakes Scout; one with no waiter is logged here."""
        reason = "no answer"
        if self._asks.expire(row.id, reason):
            self._expiring.add(row.id)
            return
        self._end_unlive(row, reason)

    def _end_unlive(self, row: WorkRow, reason: str) -> None:
        """End a waiting ask that has no card showing: log it expired and wake Scout."""
        detail = self._work.ask_detail(row.id) or {}
        tool = detail.get("tool") or ""
        summary = detail.get("summary") or row.title
        try:
            self._approvals.record(
                source=detail.get("source") or "scout_tool",
                tool=tool,
                summary=summary,
                input=detail.get("input") or {},
                group_key=detail.get("group_key") or tool,
                outcome="expired",
                decided_by="none",
                ask_id=row.id,
                reason=reason,
            )
        except TransitionRefused:
            self._work.settle(row.id, "expired", reason)  # leave waiting_asks, nothing to log
            return
        facts = {"ask": row.id, "tool": tool, "summary": summary, "outcome": "expired"}
        self._emit(Event("ask_ended", {**facts, "reason": reason}, key=f"ask:{row.id}"))

    def release(self, ask_id: str) -> None:
        for key in [k for k, v in self._claims.items() if v == ask_id]:
            del self._claims[key]

    def find(self, tool: str, input: dict) -> str | None:
        """The id of an open Scout ask already saved for this very call, if any."""
        wanted = self._approvals.mask(input)
        for row in self._work.waiting_asks():
            saved = row.input or {}
            if saved.get("name") == tool and saved.get("input") == wanted:
                return row.id
        return None

    def adopt(self, task: "asyncio.Task[Decision]", call: Call, req: AskRequest) -> None:
        """Keep the decision still running after its turn moved on, and act on its end."""
        self._asks.park(req.ask_id)
        if not self._asks.anyone_online():
            self._unseen.add(req.ask_id)  # raised to an empty room: the person has not seen it
        watcher = asyncio.create_task(self._finish(task, call, req))
        self._tasks.add(watcher)
        watcher.add_done_callback(self._tasks.discard)
        watcher.add_done_callback(lambda _: self._ended(req.ask_id))
        self.changed()

    async def _finish(self, task: "asyncio.Task[Decision]", call: Call, req: AskRequest) -> None:
        try:
            decision = await task
        except asyncio.CancelledError:
            return  # withdrawn (the brain is closing); nobody to tell
        except Exception:
            log.exception("a parked ask failed")
            return
        await self._conclude(decision, call, req)

    async def _conclude(self, decision: Decision, call: Call, req: AskRequest) -> None:
        """Act on a decision that came after the turn moved on, then wake Scout with the facts."""
        facts: dict[str, str | int] = {"ask": req.ask_id, "tool": call.name, "summary": req.summary}
        if decision.allowed:
            try:
                out = await self._toolbox().carry_out(call)
            except RpcError as err:
                facts.update(outcome="failed", reason=err.message)
            except Exception:
                log.exception("a parked call failed")
                facts.update(outcome="failed", reason="the call raised an error")
            else:
                facts.update(outcome="approved", result=out if isinstance(out, str) else "")
        elif decision.code == "cancelled":
            return  # withdrawn by the person's own action: no wake
        elif decision.code == "expired":
            facts.update(outcome="expired", reason=decision.reason)
        else:
            facts.update(outcome="refused", reason=decision.reason)
        self._emit(Event("ask_ended", facts, key=f"ask:{req.ask_id}"))

    # ---- return: a body that shows cards joined ----

    def rejoined(self, body_id: str) -> None:
        """A body that displays joined: decide afresh every waiting ask with no card showing and
        wake Scout once about those the person has not seen. Nothing to do when all were seen."""
        rows = self._work.waiting_asks()
        if not any(r.id in self._unseen or not self._asks.is_open(r.id) for r in rows):
            return
        if self._returning is not None and not self._returning.done():
            return
        try:
            self._returning = asyncio.get_running_loop().create_task(self._return())
        except RuntimeError:
            return  # no loop yet (a body joining before the server runs): nothing to show with
        self._tasks.add(self._returning)
        self._returning.add_done_callback(self._tasks.discard)

    async def _return(self) -> None:
        toolbox = self._toolbox()
        kept: list[tuple[Call, AskRequest]] = []
        for row in self._work.waiting_asks():  # oldest first
            if self._asks.is_open(row.id):
                continue
            try:
                again = await self._decide_again(toolbox, row)
            except Exception:
                # Left waiting: its deadline still ends it, and the next join tries again.
                log.exception("a waiting ask could not be decided again: %s", row.id)
                continue
            if again is not None:
                kept.append(again)
        for call, req in kept:  # only the person can say yes now; all cards open together
            person = replace(req, can_allow_once=False)
            self.adopt(asyncio.create_task(toolbox.redecide(person)), call, person)
        await asyncio.sleep(0)  # the cards go out in order before the wake names them
        left = [r for r in self._work.waiting_asks() if r.id in self._unseen]
        self._unseen.clear()
        if not left:
            return
        now = self._now()
        asks = []
        for row in left:
            detail = self._work.ask_detail(row.id) or {}
            asks.append(
                {
                    "ask": row.id,
                    "tool": detail.get("tool") or "",
                    "summary": detail.get("summary") or row.title,
                    "age_s": int((now - datetime.fromisoformat(row.created_at)).total_seconds()),
                }
            )
        facts: dict[str, str | int] = {"count": len(asks), "asks": json.dumps(asks)}
        self._emit(Event("asks_waiting", facts, key="asks_waiting"))

    async def _decide_again(
        self, toolbox: "Toolbox", row: WorkRow
    ) -> tuple[Call, AskRequest] | None:
        """One waiting ask through the floor and the rules again, the person's step left out.
        Carried out or ended here when they settle it; the request comes back when it needs the
        person."""
        saved = row.input or {}
        call = Call(
            id=f"ask:{row.id}",
            name=saved.get("name") or "",
            input=saved.get("input") or {},
            turn="",
            text=saved.get("text") or "",
        )
        found = toolbox.spec_named(call.name)
        if found is None:
            self._end_unlive(row, "tool gone")
            return None
        spec, kind = found
        req = await toolbox.ask_request(call, spec, kind, job_id=None, ask_id=row.id, reopen=True)
        decision = await toolbox.redecide(replace(req, how_to_ask=None))
        if decision.allowed:
            if (current := self._work.get(row.id)) is not None and current.state == "active":
                # An Auto tool is allowed without the engine writing a row: log the rule's yes.
                self._approvals.record(
                    source=kind,
                    tool=spec.name,
                    summary=req.summary,
                    input=req.input,
                    group_key=req.group_key,
                    outcome="approved",
                    decided_by="rule",
                    ask_id=row.id,
                )
            await self._conclude(decision, call, req)
            return None
        if decision.code == "no_decider":
            return call, req
        self._end_unlive(row, "turned off" if decision.code == "off" else decision.reason)
        return None
