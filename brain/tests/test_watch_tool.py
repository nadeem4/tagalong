"""The watch tool: standing checks as paused or planned watch rows, and the one-time wake
about watches a migration paused.
"""

import datetime
import json

import pytest
from job_rows import records_for
from test_sessions import Gate, idle, join, make

from brain.events import EventKind
from brain.memory import Memory
from brain.store.memory import MemoryRefused
from brain.tools import timer_tools

T0 = datetime.datetime(2026, 10, 28, 9, 0, tzinfo=datetime.UTC)


class FakeTimers:
    def __init__(self):
        self.changes = 0

    def changed(self):
        self.changes += 1


@pytest.fixture
def rig():
    mem = Memory(":memory:")
    records = records_for(mem, lambda: T0)
    fake = FakeTimers()
    handlers = {s.name: h for s, h in timer_tools(records, fake, lambda: T0)}

    async def watch(**args):
        return await handlers["watch"](args)

    watch.work = records.work
    watch.fake = fake
    yield watch
    mem.close()


async def test_watch_add_list_cancel(rig):
    made = json.loads(await rig(action="add", note="the build", every_minutes=30))
    row = rig.work.get(made["id"])
    assert (row.kind, row.state, row.title) == ("watch", "planned", "the build")
    assert rig.work.repeat_of(row.id) == 1800
    assert datetime.datetime.fromisoformat(row.due_at) == T0 + datetime.timedelta(minutes=30)
    listed = json.loads(await rig(action="list"))["watches"]
    assert [(w["id"], w["note"], w["state"], w["every_minutes"]) for w in listed] == [
        (row.id, "the build", "planned", 30)
    ]
    await rig(action="cancel", id=row.id)
    assert rig.work.get(row.id).state == "cancelled"
    assert json.loads(await rig(action="list"))["watches"] == []
    assert rig.fake.changes == 2


async def test_watch_add_refuses_bad_input(rig):
    for args in (
        {"action": "add", "every_minutes": 30},
        {"action": "add", "note": "x", "every_minutes": 4},
        {"action": "add", "note": "x"},
        {"action": "add", "note": "x" * 501, "every_minutes": 30},
        {"action": "add", "note": "x", "every_minutes": 525601},
        {"action": "nope"},
        {"action": "cancel", "id": "missing"},
    ):
        with pytest.raises(MemoryRefused):
            await rig(**args)


async def test_watch_switch_on_needs_repeat(rig):
    row = rig.work.create(
        "watch", "whenever it rains", state="paused", input={"cadence": "whenever it rains"}
    )
    with pytest.raises(MemoryRefused, match="every_minutes"):
        await rig(action="switch_on", id=row.id)
    assert rig.work.get(row.id).state == "paused"
    await rig(action="switch_on", id=row.id, every_minutes=60)
    on = rig.work.get(row.id)
    assert on.state == "planned" and rig.work.repeat_of(row.id) == 3600
    assert datetime.datetime.fromisoformat(on.due_at) == T0 + datetime.timedelta(hours=1)


async def test_watch_pause_and_switch_on(rig):
    made = json.loads(await rig(action="add", note="the build", every_minutes=30))
    await rig(action="pause", id=made["id"])
    assert rig.work.get(made["id"]).state == "paused"
    listed = json.loads(await rig(action="list"))["watches"]
    assert [w["state"] for w in listed] == ["paused"]
    await rig(action="switch_on", id=made["id"])  # keeps its stored repeat
    assert rig.work.get(made["id"]).state == "planned"
    assert rig.work.repeat_of(made["id"]) == 1800


async def test_paused_watches_wake_once():
    memory = Memory(":memory:")
    work = records_for(memory).work
    row = work.create("watch", "the build", state="paused", input={"cadence": "daily"})
    told_before = work.create("watch", "already told", state="paused")
    work.mark_reported(told_before.id)
    kinds = {"watches_paused": EventKind("watches_paused", batch_seconds=0, max_per_hour=2)}
    told = []
    for _ in range(2):  # started twice: only the first start tells Scout
        model = Gate(["ok"])
        session, _ = make(model, memory, kinds=kinds)
        join(session, "desktop")
        session.scheduler.pump()
        await idle(session)
        told += [m[-1]["content"][-1]["text"] for m in model.seen]
    assert len(told) == 1
    assert "Event: watches_paused" in told[0] and "the build" in told[0] and "daily" in told[0]
    assert "already told" not in told[0]
    assert work.get(row.id).state == "paused"  # Scout mentions it; the person decides
