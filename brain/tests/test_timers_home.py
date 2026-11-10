"""Tests for Home's timer tools (list and cancel) and the notice a change sends.

Same fake clock and in-memory work store as test_timers.py; no model, no wake involved.
"""

import json
from datetime import UTC, datetime, timedelta

import pytest
from job_rows import add_timer

from brain.memory import Memory
from brain.protocol import ErrorCode, RpcError
from brain.store.work import WorkStore
from brain.timers import Timers
from brain.timers_home import timer_home_tools

T0 = datetime(2026, 10, 28, 12, 0, tzinfo=UTC)


def make():
    work = WorkStore(Memory(":memory:").db, lambda: T0)
    notes = []
    timers = Timers(
        work, lambda *a, **k: None, lambda: T0, notify=lambda k, d: notes.append((k, d))
    )
    tools = {s.name: h for s, h in timer_home_tools(work, timers)}
    return work, timers, tools, notes


async def test_timers_state_lists_soonest_first_with_pending():
    work, _t, tools, _n = make()
    late = add_timer(work, "late", T0 + timedelta(hours=2), repeat_s=1800)
    soon = add_timer(work, "soon", T0 + timedelta(minutes=5))
    fired = add_timer(work, "fired", T0 + timedelta(minutes=9), state="active")
    add_timer(work, "watching", T0 + timedelta(minutes=1), kind="watch")
    rows = json.loads(await tools["timers_state"]({}))["timers"]
    assert [r["id"] for r in rows] == [soon.id, fired.id, late.id]
    assert rows[0] == {
        "id": soon.id,
        "note": "soon",
        "next_at": "2026-10-28T12:05:00+00:00",
        "repeat_minutes": None,
        "pending": False,
    }
    assert rows[1]["pending"] is True and rows[2]["repeat_minutes"] == 30


async def test_timer_cancel_ends_the_row_and_tells_the_bodies():
    work, _t, tools, notes = make()
    row = add_timer(work, "x", T0 + timedelta(minutes=5))
    assert json.loads(await tools["timer_cancel"]({"id": row.id})) == {"id": row.id}
    assert work.get(row.id).state == "cancelled"
    assert ("changed", {"what": "timers"}) in notes


@pytest.mark.parametrize("bad", ["nope", "", None])
async def test_timer_cancel_unknown_id_is_invalid_params(bad):
    _w, _t, tools, _n = make()
    with pytest.raises(RpcError) as err:
        await tools["timer_cancel"]({"id": bad})
    assert err.value.code == ErrorCode.invalid_params


async def test_timer_cancel_of_a_watch_row_is_refused():
    work, _t, tools, _n = make()
    row = add_timer(work, "w", T0 + timedelta(minutes=5), kind="watch")
    with pytest.raises(RpcError):
        await tools["timer_cancel"]({"id": row.id})
    assert work.get(row.id).state == "planned"
