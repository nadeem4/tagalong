"""Home's timer tools: the Timers tab lists the planned timers and cancels one.

Home-only (the model never sees them; Scout has list_timers and cancel_timer). Only `timer`
rows are listed: watches belong to a job and show on its page.
"""

import json
from datetime import UTC, datetime

from brain.protocol import ErrorCode, RpcError
from brain.store.work import WorkStore
from brain.timers import Timers, note_of
from brain.toolbox import Handler, ToolSpec


def timer_home_tools(work: WorkStore, timers: Timers) -> list[tuple[ToolSpec, Handler]]:
    home = frozenset({"home"})

    async def state(_args: dict) -> str:
        rows = sorted(work.of_kind("timer", ["planned", "active"]), key=lambda r: r.due_at or "")
        return json.dumps(
            {
                "timers": [
                    {
                        "id": r.id,
                        "note": note_of(r),
                        "next_at": datetime.fromisoformat(r.due_at)
                        .astimezone(UTC)
                        .isoformat(timespec="seconds"),
                        "repeat_minutes": (work.repeat_of(r.id) or 0) // 60 or None,
                        "pending": r.state == "active",  # fired, Scout has not heard it yet
                    }
                    for r in rows
                    if r.due_at
                ]
            }
        )

    async def cancel(args: dict) -> str:
        tid = args.get("id")
        row = work.get(tid) if isinstance(tid, str) and tid else None
        if row is None or row.kind != "timer" or not timers.cancel(tid, "cancelled by the person"):
            raise RpcError(ErrorCode.invalid_params, f"There is no timer {tid}.")
        return json.dumps({"id": tid})

    return [
        (
            ToolSpec(
                "timers_state",
                "Every timer waiting to fire, soonest first.",
                {"type": "object", "properties": {}},
                home,
                effect="read",
            ),
            state,
        ),
        (
            ToolSpec(
                "timer_cancel",
                "Cancel one timer.",
                {
                    "type": "object",
                    "properties": {"id": {"type": "string"}},
                    "required": ["id"],
                },
                home,
                effect="change",
            ),
            cancel,
        ),
    ]
