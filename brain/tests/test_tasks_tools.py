"""Tests for Home's tasks_list tool: every non-Ask task with its source and caused-by chain."""

import json
from datetime import UTC, datetime

import pytest

from brain.events import Event, EventLog
from brain.masking import Masker
from brain.store.db import open_db
from brain.tasks import Tasks
from brain.tasks_tools import tasks_tools

T0 = datetime(2026, 11, 17, 9, 0, tzinfo=UTC)


class Rig:
    def __init__(self, tmp_path):
        self.db = open_db(tmp_path / "t.db")
        self.log = EventLog(self.db, Masker(lambda: []), lambda: T0)
        self.tasks = Tasks(self.db, lambda t: t, lambda: T0)
        ((self.spec, self.handler),) = tasks_tools(self.tasks, self.log)

    async def rows(self, **args):
        return json.loads(await self.handler(args))["tasks"]


@pytest.fixture
def rig(tmp_path):
    r = Rig(tmp_path)
    yield r
    r.db.close()


async def test_tasks_list_shows_the_caused_by_chain(rig):
    rig.log.post(Event("say", "desktop", {"text": "watch my mail"}, id="e1"))
    rig.log.post(Event("job_ended", "job:j1", {"report": "x"}, id="e2", caused_by="e1"))
    tid = rig.tasks.open("do", "job:j1", caused_by="e2", title="follow up")
    [row] = await rig.rows()
    assert (row["id"], row["kind"], row["state"], row["title"]) == (tid, "do", "open", "follow up")
    assert (row["source"], row["caused_by"]) == ("job:j1", "e2")
    assert row["chain"] == [
        {"kind": "job_ended", "source": "job:j1"},
        {"kind": "say", "source": "desktop"},
    ]
    assert row["created_at"] and row["ended_at"] is None


async def test_tasks_list_chain_stops_at_the_depth_cap(rig):
    previous = None
    for n in range(8):
        rig.log.post(Event("job_ended", f"job:{n}", {"r": "x"}, id=f"e{n}", caused_by=previous))
        previous = f"e{n}"
    rig.tasks.open("do", "job:7", caused_by="e7")
    [row] = await rig.rows()
    assert len(row["chain"]) == 5


async def test_tasks_list_leaves_out_ask_tasks(rig):
    rig.tasks.open("ask", "desktop")
    watch = rig.tasks.open("watch", "loop:gmail", title="Watching Gmail")
    assert [r["id"] for r in await rig.rows()] == [watch]


async def test_tasks_list_includes_ended_only_when_asked(rig):
    done = rig.tasks.open("do", "desktop", title="old")
    rig.tasks.end(done, "done")
    live = rig.tasks.open("do", "desktop", title="new")
    assert [r["id"] for r in await rig.rows()] == [live]
    both = await rig.rows(include_ended=True)
    assert [r["id"] for r in both] == [live, done]
    assert both[1]["ended_at"] is not None


async def test_tasks_list_is_home_only(rig):
    assert rig.spec.audience == frozenset({"home"})
    assert rig.spec.effect == "read"


async def test_tasks_list_is_a_tool_of_the_running_brain():
    from event_log import make_session

    from brain.bodies import Bodies
    from brain.memory import Memory

    class Model:
        model_id = "claude-sonnet-5-5"

    class Budget:
        def allows(self):
            return True

        def spend(self, usage, model):
            pass

    session = make_session(Model(), Budget(), Bodies(), 10, Memory(":memory:"))
    assert "tasks_list" in {s.name for s in session.toolbox.home_tools()}
    assert "tasks_list" not in {t["name"] for t in session.toolbox.model_tools()}
