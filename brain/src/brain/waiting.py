"""Scout asks that outlive their turn: parked while the person is away.

A tool call that needs the person's yes waits in its turn, then parks: the turn goes on and the
decision keeps running here. This module owns that still-running decision, finds a repeated call
for it, and carries the call out when the person finally answers, then wakes Scout with the facts.
"""

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import datetime
from typing import TYPE_CHECKING

from brain.asks import Asks
from brain.events import Event
from brain.mind.turn import Call
from brain.permission import AskRequest, Decision
from brain.protocol import RpcError
from brain.store.work import WorkStore

if TYPE_CHECKING:
    from brain.toolbox import Toolbox

log = logging.getLogger(__name__)


class WaitingAsks:
    def __init__(
        self,
        work: WorkStore,
        asks: Asks,
        toolbox: "Callable[[], Toolbox]",
        emit: Callable[[Event], None],
        now: Callable[[], datetime],
        mask: Callable[[dict], dict] = lambda value: value,
    ) -> None:
        self._work = work
        self._asks = asks
        self._toolbox = toolbox
        self._emit = emit
        self._now = now
        self._mask = mask  # the same masking the saved call went through
        self._tasks: set[asyncio.Task] = set()
        self._claims: dict[str, str] = {}  # call key -> ask id, until its decision ends

    def claim(self, tool: str, input: dict, ask_id: str) -> str | None:
        """The ask already holding this very call, else register `ask_id` for it. Synchronous
        on purpose: two identical parallel calls must not both pass before either registers."""
        key = tool + json.dumps(self._mask(input), sort_keys=True, default=str)
        earlier = self._claims.get(key) or self.find(tool, input)
        if earlier is not None:
            return earlier
        self._claims[key] = ask_id
        return None

    def release(self, ask_id: str) -> None:
        for key in [k for k, v in self._claims.items() if v == ask_id]:
            del self._claims[key]

    def find(self, tool: str, input: dict) -> str | None:
        """The id of an open Scout ask already saved for this very call, if any."""
        wanted = self._mask(input)
        for row in self._work.waiting_asks():
            saved = row.input or {}
            if saved.get("name") == tool and saved.get("input") == wanted:
                return row.id
        return None

    def adopt(self, task: "asyncio.Task[Decision]", call: Call, req: AskRequest) -> None:
        """Keep the decision still running after its turn moved on, and act on its end."""
        self._asks.park(req.ask_id)
        watcher = asyncio.create_task(self._finish(task, call, req))
        self._tasks.add(watcher)
        watcher.add_done_callback(self._tasks.discard)
        watcher.add_done_callback(lambda _: self.release(req.ask_id))

    async def _finish(self, task: "asyncio.Task[Decision]", call: Call, req: AskRequest) -> None:
        try:
            decision = await task
        except asyncio.CancelledError:
            return  # withdrawn (the brain is closing); nobody to tell
        except Exception:
            log.exception("a parked ask failed")
            return
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
