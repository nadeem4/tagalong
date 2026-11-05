"""Tests for how LoopService surfaces loops: context, quiet, stale and urgent triggers, the
per-reason throttles, the once-a-day dedupe, and the end-to-end Priya journey on fakes."""

from datetime import UTC, datetime, timedelta

import pytest

from brain.events import Event
from brain.loops.loop import Loop
from brain.loops.reader import Change, MailItem
from brain.loops.service import LoopService
from brain.loops.store import LoopStore
from brain.memory import Memory

T0 = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


class Clock:
    def __init__(self, at=T0):
        self.at = at

    def __call__(self):
        return self.at


@pytest.fixture
def parts(tmp_path):
    mem = Memory(tmp_path / "t.db")
    clock = Clock()
    yield LoopStore(mem.db, clock), clock, [], mem
    mem.close()


def svc(store, clock, events, **kw):
    return LoopService(store, events.append, clock, **kw)


def focus(app="POWERPNT.EXE", title="Q4 pricing.pptx - PowerPoint"):
    return Event("focus", {"body": "desktop", "app": app, "title": title}, key="desktop")


def tab(title="", url=""):
    return Event("tab", {"body": "browser", "title": title, "url": url}, key="browser")


def deck(store, ref="a", anchors=("Q4 pricing deck",), **kw):
    return store.save(
        Loop(
            source="app1",
            ref=ref,
            title=f"t-{ref}",
            asks="send the numbers",
            people=["Priya"],
            anchors=list(anchors),
            **kw,
        )
    )


# --- context ---


def test_a_matching_focus_emits_one_context_loop_event_with_facts(parts):
    store, clock, events, _ = parts
    lp = deck(store)
    svc(store, clock, events).saw(focus())
    assert len(events) == 1
    e = events[0]
    assert e.kind == "loop" and e.key == f"loop:{lp.id}"
    assert e.facts["reason"] == "context" and e.facts["anchor"] == "Q4 pricing deck"
    assert e.facts["title"] == "t-a" and e.facts["people"] == "Priya"
    assert e.facts["asks"] == "send the numbers"


def test_a_second_focus_the_same_day_emits_nothing_and_the_next_day_again(parts):
    store, clock, events, _ = parts
    deck(store)
    service = svc(store, clock, events)
    service.saw(focus())
    clock.at += timedelta(hours=1)
    service.saw(focus())
    assert len(events) == 1
    clock.at += timedelta(days=1)
    service.saw(focus())
    assert len(events) == 2


def test_a_browser_tab_matches_by_url(parts):
    store, clock, events, _ = parts
    deck(store, anchors=("https://docs.example.com/q4-pricing",))
    svc(store, clock, events).saw(tab("Doc", "https://docs.example.com/q4-pricing/edit?x=1"))
    assert [e.facts["reason"] for e in events] == ["context"]


def test_nothing_surfaces_while_the_mail_app_is_in_front(parts):
    store, clock, events, _ = parts
    deck(store)
    service = svc(store, clock, events)
    service.saw(focus("chrome.exe", "Q4 pricing deck - me@gmail.com - Gmail"))
    service.saw(tab("Q4 pricing deck", "https://mail.google.com/mail/u/0/#inbox"))
    assert events == []


def test_only_held_and_surfaced_loops_match(parts):
    store, clock, events, _ = parts
    for i, status in enumerate(("snoozed", "done", "dropped", "stale")):
        store.set_status(deck(store, ref=str(i)).id, status)
    svc(store, clock, events).saw(focus())
    assert events == []


def test_other_events_and_odd_facts_are_ignored(parts):
    store, clock, events, _ = parts
    deck(store)
    service = svc(store, clock, events)
    service.saw(Event("download", {"body": "desktop"}))  # `back` now brings the daily digest
    service.saw(Event("focus", {}))
    service.saw(Event("tab", {"title": 5}))
    assert events == []


def test_context_is_throttled_globally_and_a_throttled_match_is_not_used_up(parts):
    store, clock, events, _ = parts
    deck(store, ref="a")
    deck(store, ref="b", anchors=("Budget 2027 plan",))
    service = svc(store, clock, events)
    service.saw(focus())
    service.saw(focus(title="Budget 2027 plan.xlsx"))
    assert len(events) == 1
    clock.at += timedelta(minutes=11)
    service.saw(focus(title="Budget 2027 plan.xlsx"))
    assert len(events) == 2 and events[1].facts["title"] == "t-b"


# --- due, quiet, stale ---


def test_due_wakes_are_not_throttled(parts):
    store, clock, events, _ = parts
    for i in range(6):
        deck(store, ref=str(i), due=T0 - timedelta(hours=1))
    svc(store, clock, events).fire_due()
    assert len(events) == 6


def test_quiet_emits_once_and_only_for_a_loop_still_waiting(parts):
    store, clock, events, _ = parts
    waiting = deck(store, ref="a", direction="they_owe", quiet_after=T0 - timedelta(hours=1))
    answered = deck(store, ref="b", direction="they_owe", quiet_after=T0 - timedelta(hours=1))
    store.set_status(answered.id, "done")
    service = svc(store, clock, events)
    service.fire_due()
    service.fire_due()
    assert [(e.key, e.facts["reason"]) for e in events] == [(f"loop:{waiting.id}", "quiet")]


async def test_a_future_quiet_time_arms_the_timer(parts):
    store, clock, events, _ = parts
    deck(store, direction="they_owe", quiet_after=T0 + timedelta(seconds=30))
    service = svc(store, clock, events)
    service.start()
    assert events == [] and service._handle is not None
    service._handle.cancel()


def test_a_stale_sweep_marks_untouched_loops_and_sends_one_batched_wake(parts):
    store, clock, events, _ = parts
    clock.at = T0 - timedelta(days=8)
    a, b = deck(store, ref="a"), deck(store, ref="b")
    clock.at = T0 - timedelta(days=1)
    c = deck(store, ref="c")
    clock.at = T0
    service = svc(store, clock, events)
    service.fire_due()
    assert len(events) == 1
    e = events[0]
    assert e.facts["reason"] == "stale" and e.facts["count"] == 2
    assert a.id in e.facts["loops"] and b.id in e.facts["loops"] and c.id not in e.facts["loops"]
    assert store.get(a.id).status == "stale" and store.get(c.id).status == "held"
    service.fire_due()
    assert len(events) == 1  # swept loops are not swept again


def test_the_stale_age_is_configurable(parts):
    store, clock, events, _ = parts
    clock.at = T0 - timedelta(days=3)
    deck(store)
    clock.at = T0
    svc(store, clock, events, stale_days=2).fire_due()
    assert [e.facts["reason"] for e in events] == ["stale"]


def test_a_stale_loop_with_new_mail_is_held_again(parts):
    store, clock, events, _ = parts
    lp = deck(store)
    store.set_status(lp.id, "stale")
    LoopService(store, events.append, clock)._save(
        Loop(source="app1", ref="a", title="t", asks="x"), _mail("a")
    )
    assert store.get(lp.id).status == "held"


# --- urgent, and the Priya journey ---


def _mail(thread, hours_ago=1):
    return MailItem(
        app="gmail",
        thread=thread,
        sender="Priya <p@x.com>",
        subject="Q4 pricing",
        date=T0 - timedelta(hours=hours_ago),
        body="please send the deck",
    )


class Reads:
    def __init__(self, change):
        self.change = change

    async def read(self, item, related):
        return self.change


def reader_service(store, clock, events, change):
    return LoopService(store, events.append, clock, Reads(change))


NEW = dict(kind="new", title="Priya needs the deck", asks="send it", people=["Priya"])


async def test_an_urgent_new_loop_emits_once_immediately(parts):
    store, clock, events, _ = parts
    service = reader_service(store, clock, events, Change(**NEW, urgent=True))
    await service._process("gmail", _mail("t1"))
    await service._process("gmail", _mail("t1"))  # the same thread again: already said
    urgent = [e for e in events if e.facts["reason"] == "urgent"]
    assert len(urgent) == 1 and urgent[0].facts["title"] == "Priya needs the deck"


async def test_a_loop_not_flagged_urgent_is_silent(parts):
    store, clock, events, _ = parts
    await reader_service(store, clock, events, Change(**NEW))._process("gmail", _mail("t1"))
    assert events == []


async def test_old_mail_flagged_urgent_is_not_urgent_now(parts):
    store, clock, events, _ = parts
    service = reader_service(store, clock, events, Change(**NEW, urgent=True))
    await service._process("gmail", _mail("t1", hours_ago=72))
    assert events == []


async def test_urgent_is_limited_to_two_an_hour(parts):
    store, clock, events, _ = parts
    service = reader_service(store, clock, events, Change(**NEW, urgent=True))
    for i in range(3):
        await service._process("gmail", _mail(f"t{i}"))
    assert len(events) == 2
    clock.at += timedelta(hours=1, minutes=1)
    await service._process("gmail", _mail("t9", hours_ago=0))
    assert len(events) == 3


async def test_priya_mail_then_the_deck_opens_surfaces_once(parts):
    store, clock, events, _ = parts
    change = Change(**NEW, anchors=["Q4 pricing deck"])
    await reader_service(store, clock, events, change)._process("gmail", _mail("t1"))
    assert events == []  # held quietly
    service = svc(store, clock, events)
    service.saw(focus())
    service.saw(focus())
    assert [e.facts["reason"] for e in events] == ["context"]
    assert events[0].facts["title"] == "Priya needs the deck"
