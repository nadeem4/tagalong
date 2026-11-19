"""The watch tool: standing checks as paused or planned watch rows."""

import datetime
import json

import pytest
from job_rows import records_for, tasks_for

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
    handlers = {
        s.name: h for s, h in timer_tools(records, fake, lambda: T0, lambda: None, tasks_for(mem))
    }

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


async def test_a_refused_switch_on_changes_nothing(rig):
    made = json.loads(await rig(action="add", note="the build", every_minutes=30))
    with pytest.raises(MemoryRefused):  # not paused
        await rig(action="switch_on", id=made["id"], every_minutes=60)
    assert rig.work.repeat_of(made["id"]) == 1800
