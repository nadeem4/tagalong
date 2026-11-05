"""Tests for Home's loops tools: the mail switch, the Held list, forget and wipe.

A stub Apps lists one Gmail-shaped app and one plain one; the poll runs on a scripted source
through LoopService, so no mail or model is involved."""

import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest

from brain.loops.home_tools import loop_home_tools
from brain.loops.loop import Loop
from brain.loops.service import LoopService
from brain.loops.store import LoopStore
from brain.memory import Memory
from brain.protocol import ErrorCode, RpcError

T0 = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
GMAIL = ["search_threads", "get_thread", "create_draft", "send_message"]


class Tool:
    def __init__(self, name):
        self.name = name


class StubApps:
    def __init__(self):
        self.by_app = {"gmail": GMAIL, "notes": ["echo"], "away": []}

    def tools(self, app_id):
        return [Tool(n) for n in self.by_app.get(app_id, [])]

    async def call(self, *a, **k):
        return None


class Rig:
    def __init__(self, tmp_path):
        self.mem = Memory(tmp_path / "t.db")
        self.store = LoopStore(self.mem.db, lambda: T0)
        self.notes = []
        self.svc = LoopService(
            self.store,
            lambda e: None,
            lambda: T0,
            None,
            StubApps(),
            poll_s=3600,
            notify=lambda kind, data: self.notes.append((kind, data)),
        )
        rows = [("gmail", "Gmail"), ("notes", "Notes"), ("away", "Away")]
        self.tools = {
            spec.name: handler for spec, handler in loop_home_tools(self.svc, lambda: rows)
        }

    async def call(self, name, **args):
        return json.loads(await self.tools[name](args))

    def add(self, ref="t1", **kw):
        kw.setdefault("title", "Send Priya the deck")
        kw.setdefault("asks", "the Q4 deck")
        return self.store.save(Loop(source="gmail", ref=ref, **kw))


@pytest.fixture
def rig(tmp_path):
    r = Rig(tmp_path)
    yield r
    r.mem.close()


async def test_a_fresh_home_has_every_switch_off_and_offers_only_mail_apps(rig):
    state = await rig.call("loops_state")
    assert state["apps"] == [{"id": "gmail", "name": "Gmail", "on": False}]
    assert state["loops"] == []


async def test_on_starts_the_poll_and_off_stops_it_but_keeps_the_loops(rig):
    rig.add()
    await rig.call("loops_set", app="gmail", on=True)
    assert (await rig.call("loops_state"))["apps"][0]["on"] is True
    await rig.call("loops_set", app="gmail", on=False)
    state = await rig.call("loops_state")
    assert state["apps"][0]["on"] is False and len(state["loops"]) == 1
    assert ("changed", {"what": "loops"}) in rig.notes


async def test_a_non_mail_app_cannot_be_switched_on(rig):
    for app in ("notes", "away", "nope"):
        with pytest.raises(RpcError) as err:
            await rig.call("loops_set", app=app, on=True)
        assert err.value.code == ErrorCode.invalid_params


async def test_rows_carry_title_asks_direction_due_people_status_and_no_body(rig):
    due = T0 + timedelta(days=2)
    rig.add(direction="they_owe", people=["Priya"], due=due)
    (row,) = (await rig.call("loops_state"))["loops"]
    assert row == {
        "id": row["id"],
        "app": "gmail",
        "title": "Send Priya the deck",
        "asks": "the Q4 deck",
        "direction": "they_owe",
        "due": due.isoformat(),
        "people": ["Priya"],
        "status": "held",
    }


async def test_unread_since_shows_only_when_set(rig):
    assert "unread_since" not in (await rig.call("loops_state"))["apps"][0]
    rig.svc._unread["gmail"] = T0
    assert (await rig.call("loops_state"))["apps"][0]["unread_since"] == T0.isoformat()


async def test_forget_removes_one_loop(rig):
    keep, gone = rig.add("a"), rig.add("b")
    await rig.call("loop_forget", id=gone.id)
    assert [lp.id for lp in rig.store.list()] == [keep.id]
    assert ("changed", {"what": "loops"}) in rig.notes
    with pytest.raises(RpcError):
        await rig.call("loop_forget", id=gone.id)


async def test_wipe_switches_off_and_deletes_every_loop_and_cursor(rig):
    rig.add()
    await rig.call("loops_set", app="gmail", on=True)
    rig.store.set_cursor("gmail", "x")
    await rig.call("loops_wipe")
    state = await rig.call("loops_state")
    assert state["loops"] == [] and state["apps"][0]["on"] is False
    assert rig.store.cursor("gmail") is None
    await asyncio.sleep(0)


async def test_the_switch_survives_a_restart(rig):
    await rig.call("loops_set", app="gmail", on=True)
    again = LoopService(rig.store, lambda e: None, lambda: T0, None, StubApps(), poll_s=3600)
    assert not again.is_on("gmail")
    again.start()
    assert again.is_on("gmail") and "gmail" in again._polls
    again.disable("gmail")
    rig.svc.disable("gmail")
    fresh = LoopService(rig.store, lambda e: None, lambda: T0, None, StubApps(), poll_s=3600)
    fresh.start()
    assert not fresh.is_on("gmail")  # switched off stays off


async def test_a_saved_switch_for_an_app_that_cannot_be_read_any_more_is_skipped(rig):
    await rig.call("loops_set", app="gmail", on=True)
    apps = StubApps()
    apps.by_app["gmail"] = []
    again = LoopService(rig.store, lambda e: None, lambda: T0, None, apps, poll_s=3600)
    again.start()
    assert not again.is_on("gmail")
    rig.svc.disable("gmail")


async def test_sweeping_stale_loops_and_surfacing_tell_home(rig):
    rig.add(due=T0 - timedelta(hours=1))
    rig.notes.clear()
    rig.svc.fire_due()
    assert ("changed", {"what": "loops"}) in rig.notes  # the due loop surfaced
    rig.notes.clear()
    rig.svc.fire_due()
    assert rig.notes == []  # nothing changed, so nothing is announced


async def test_a_stale_sweep_tells_home(rig):
    rig.add()
    notes = []
    later = LoopService(
        rig.store,
        lambda e: None,
        lambda: T0 + timedelta(days=30),
        None,
        StubApps(),
        notify=lambda kind, data: notes.append((kind, data)),
    )
    later.fire_due()
    assert rig.store.list()[0].status == "stale"
    assert ("changed", {"what": "loops"}) in notes
