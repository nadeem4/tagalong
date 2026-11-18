"""Tests for Home's events_waiting tool: news that waits (new) or was given up, never says."""

import json
from datetime import UTC, datetime, timedelta

import pytest

from brain.events import Event, EventLog
from brain.events_tools import events_tools
from brain.masking import Masker
from brain.store import events as store
from brain.store.db import open_db

T0 = datetime(2026, 11, 17, 9, 0, tzinfo=UTC)


class Rig:
    def __init__(self, tmp_path):
        self.db = open_db(tmp_path / "t.db")
        self.log = EventLog(self.db, Masker(lambda: []), lambda: T0)
        ((_, handler),) = events_tools(self.db, lambda: T0 + timedelta(hours=3))
        self.handler = handler

    def post(self, kind, payload, source="timer:t1", at=T0):
        ev = Event(kind, source, payload, at=at)
        assert self.log.post(ev)
        return ev.id

    async def rows(self):
        return json.loads(await self.handler({}))["waiting"]


@pytest.fixture
def rig(tmp_path):
    r = Rig(tmp_path)
    yield r
    r.db.close()


async def test_events_waiting_lists_new_news_and_gave_up_not_says_in_flight(rig):
    waiting = rig.post("timer", {"title": "Stand up"})
    gave = rig.post("job_ended", {"report": "Job done"}, at=T0 + timedelta(minutes=1))
    store.set_taken(rig.db, [gave], "turn1")
    store.set_gave_up(rig.db, [gave], "retries_spent", "2026-11-17T09:02:00+00:00")
    taken = rig.post("loop", {"title": "x"})
    store.set_taken(rig.db, [taken], "turn2")
    rig.post("say", {"text": "hi"}, source="desktop")
    handled = rig.post("timer", {"title": "old"})
    store.set_state(rig.db, [handled], "handled", end_reason=None, at="t")
    rows = await rig.rows()
    assert [(r["id"], r["kind"], r["source"], r["gave_up"]) for r in rows] == [
        (waiting, "timer", "timer:t1", False),
        (gave, "job_ended", "timer:t1", True),
    ]
    assert rows[0]["age_s"] == 3 * 3600
    assert rows[0]["at"] == "2026-11-17T09:00:00+00:00"


async def test_gist_is_the_first_fact_value_truncated(rig):
    rig.post("timer", {"title": "Line one\nline two", "other": "x"})
    rig.post("loop", {"report": "y" * 200}, at=T0 + timedelta(minutes=1))
    rig.post("body_online", {}, source="desktop", at=T0 + timedelta(minutes=2))
    first, second, third = await rig.rows()
    assert first["gist"] == "Line one"
    assert second["gist"] == "y" * 57 + "..."
    assert third["gist"] == ""


async def test_a_given_up_say_is_listed_and_a_new_say_is_not(rig):
    new_say = rig.post("say", {"text": "hi"}, source="desktop")
    lost = rig.post("say", {"text": "help me"}, source="desktop", at=T0 + timedelta(minutes=1))
    store.set_taken(rig.db, [lost], "turn1")
    store.set_gave_up(rig.db, [lost], "retries_spent", "2026-11-17T09:02:00+00:00")
    rows = await rig.rows()
    assert [(r["id"], r["gave_up"]) for r in rows] == [(lost, True)]
    assert new_say not in [r["id"] for r in rows]


async def test_a_gist_that_is_not_a_string_is_json(rig):
    rig.post("timer", {"n": 3, "other": "x"})
    rig.post("loop", {"tags": ["a", "b"]}, at=T0 + timedelta(minutes=1))
    first, second = await rig.rows()
    assert (first["gist"], second["gist"]) == ("3", '["a", "b"]')
