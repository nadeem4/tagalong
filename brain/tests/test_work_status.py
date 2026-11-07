"""work_status: Scout reads what is open, what is waiting to be told, and any goal's steps.

Runs on a real temp database with the work store; no provider is involved.
"""

import json
from datetime import UTC, datetime

import pytest

from brain.store.db import open_db
from brain.tools import work_tools

NOW = datetime(2026, 1, 1, tzinfo=UTC)


@pytest.fixture
def work(tmp_path):
    from brain.store.work import WorkStore

    db = open_db(tmp_path / "t.db")
    yield WorkStore(db, lambda: NOW)
    db.close()


@pytest.fixture
def run(work):
    tools = {spec.name: (spec, handler) for spec, handler in work_tools(work, None)}

    async def run(args):
        return json.loads(await tools["work_status"][1](args))

    run.spec = tools["work_status"][0]
    return run


async def test_work_status_by_id_returns_tree_and_events(work, run):
    work.create("goal", "Tidy the repo", id="g1", state="active")
    work.create("expert_call", "Delete old branches", parent_id="g1", state="active", id="g1.p1")
    out = await run({"id": "g1"})
    assert out["goal"]["id"] == "g1" and out["goal"]["state"] == "active"
    assert [s["id"] for s in out["steps"]] == ["g1.p1"]
    assert set(out["goal"]) == {
        "id",
        "kind",
        "state",
        "title",
        "summary",
        "progress",
        "attempt",
        "end_reason",
        "due_at",
    }
    assert {e["work_id"] for e in out["events"]} == {"g1", "g1.p1"}
    assert len(out["events"]) <= 20


async def test_work_status_events_hide_session_ids(work, run):
    work.create("goal", "g", id="g1", state="active")
    work.add_event("g1", "note", {"session_id": "s-secret", "k": 1})
    out = await run({"id": "g1"})
    note = next(e for e in out["events"] if e["kind"] == "note")
    assert note["data"] == {"k": 1}
    assert "s-secret" not in json.dumps(out)


async def test_work_status_unknown_id_says_so(run):
    assert await run({"id": "nope"}) == {"error": "no work with id nope"}


async def test_work_status_no_args_lists_open_and_unreported(work, run):
    work.create("goal", "Open one", id="open1", state="active")
    work.create("goal", "Stuck one", id="stuck1", state="active")
    work.create("expert_call", "Step", parent_id="stuck1", state="active", id="stuck1.p1")
    work.fail("stuck1.p1", "permanent", "boom")
    out = await run({})
    assert {r["id"] for r in out["open"]} == {"open1", "stuck1"}  # stuck1 is blocked, still open
    assert {r["id"] for r in out["unreported"]} == {"stuck1", "stuck1.p1"}


async def test_work_status_by_words(work, run):
    work.create("goal", "Rename the zebra module", id="g1", state="active")
    work.create("goal", "Water the plants", id="g2", state="active")
    out = await run({"words": "zebra"})
    assert [r["id"] for r in out["found"]] == ["g1"]


def test_work_status_is_a_scout_read_tool(run):
    assert run.spec.audience == frozenset({"scout"})
    assert run.spec.effect == "read"
