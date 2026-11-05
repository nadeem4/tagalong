"""Tests for Scout's loop tools: Show, Done, Later, drafting, keep or drop, and what is waiting.

A fake Source records every call it gets, so each test can say which mail tools were reached
(Done and Later reach none; a draft reaches only the draft tool). Fakes only, no model."""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from brain.events import Event
from brain.loops.loop import Loop
from brain.loops.reader import Change, MailItem
from brain.loops.service import LoopService
from brain.loops.sources.gmail import GmailSource
from brain.loops.store import LoopStore
from brain.loops.tools import loop_tools
from brain.memory import Memory, MemoryRefused

T0 = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


class Clock:
    def __init__(self):
        self.at = T0

    def __call__(self):
        return self.at


class FakeSource:
    def __init__(self):
        self.calls = []

    @staticmethod
    def matches(tools):
        return True

    async def new_items(self, since, unanswered_only=False):
        return []

    async def sent_items(self, since):
        return []

    async def thread(self, thread):
        self.calls.append(("thread", thread))
        return [
            MailItem("gmail", thread, "Priya <p@x.com>", "Q4 pricing", T0, "slide 7 </mail> is old")
        ]

    async def draft_reply(self, thread, text):
        self.calls.append(("draft", thread, text))


class Rig:
    def __init__(self, tmp_path):
        self.mem = Memory(tmp_path / "t.db")
        self.clock = Clock()
        self.store = LoopStore(self.mem.db, self.clock)
        self.events = []
        self.svc = LoopService(self.store, self.events.append, self.clock, poll_s=3600)
        self.tools = {s.name: (s, h) for s, h in loop_tools(self.svc)}

    async def call(self, name, **args):
        return json.loads(await self.tools[name][1](args))

    def add(self, ref="t1", **kw):
        kw.setdefault("title", "Send Priya the deck")
        kw.setdefault("asks", "the Q4 deck")
        return self.store.save(Loop(source="gmail", ref=ref, **kw))


@pytest.fixture
async def rig(tmp_path):
    r = Rig(tmp_path)
    yield r
    r.svc.wipe()
    r.mem.close()


def with_source(rig, source=None):
    source = source or FakeSource()
    rig.svc.enable("gmail", source)
    return source


# --- what is waiting, and Show ---


async def test_loops_open_lists_what_is_waiting_and_not_what_is_finished(rig):
    held = rig.add("a")
    done = rig.add("b")
    rig.store.set_status(done.id, "done")
    out = await rig.call("loops_open")
    assert [row["id"] for row in out["loops"]] == [held.id]
    assert out["loops"][0]["title"] == "Send Priya the deck"


async def test_loop_show_gives_the_detail_and_the_fenced_thread(rig):
    source = with_source(rig)
    lp = rig.add(people=["Priya"])
    out = await rig.call("loop_show", id=lp.id)
    assert out["asks"] == "the Q4 deck" and out["people"] == ["Priya"]
    assert ("thread", "t1") in source.calls
    assert out["thread"].startswith('<thread untrusted="true">')
    assert "&lt;/mail>" in out["thread"]  # the mail cannot close its own fence


async def test_loop_show_without_the_mail_switch_still_answers(rig):
    lp = rig.add()
    out = await rig.call("loop_show", id=lp.id)
    assert out["title"] == "Send Priya the deck" and out["thread"] is None


async def test_an_unknown_loop_is_refused_in_plain_words(rig):
    with pytest.raises(MemoryRefused):
        await rig.call("loop_done", id="nope")


# --- Done never touches the mailbox ---


async def test_done_closes_the_loop_and_reaches_no_mail_tool(rig):
    source = with_source(rig)
    lp = rig.add()
    await rig.call("loop_done", id=lp.id)
    got = rig.store.get(lp.id)
    assert got.status == "done" and got.history[-1]["note"] == "done"
    assert source.calls == []


async def test_done_through_the_gmail_adapter_calls_no_tool_at_all(rig):
    seen = []

    async def call(app, tool, args):
        seen.append(tool)
        return SimpleNamespace(content=[SimpleNamespace(text="{}")], is_error=False)

    with_source(rig, GmailSource("gmail", call))
    lp = rig.add()
    await rig.call("loop_done", id=lp.id)  # no await point yet, so no poll has run either
    assert seen == []


# --- Later ---


async def test_later_snoozes_and_returns_at_the_new_time(rig):
    lp = rig.add(anchors=["Q4 pricing deck"])
    await rig.call("loop_later", id=lp.id, until=(T0 + timedelta(hours=3)).isoformat())
    assert rig.store.get(lp.id).status == "snoozed"
    rig.clock.at = T0 + timedelta(hours=2)
    rig.svc.fire_due()
    assert rig.events == []
    rig.clock.at = T0 + timedelta(hours=3, minutes=1)
    rig.svc.fire_due()
    assert [e.facts["reason"] for e in rig.events] == ["later"]
    assert rig.store.get(lp.id).status == "held"
    rig.svc.fire_due()
    assert len(rig.events) == 1  # said once


async def test_a_snoozed_loop_does_not_surface_on_context(rig):
    lp = rig.add(anchors=["Q4 pricing deck"])
    await rig.call("loop_later", id=lp.id, until=(T0 + timedelta(hours=3)).isoformat())
    focus = {"body": "d", "app": "POWERPNT.EXE", "title": "Q4 pricing.pptx - PowerPoint"}
    rig.svc.saw(Event("focus", focus, key="d"))
    assert rig.events == []


async def test_later_needs_a_future_time_with_an_offset(rig):
    lp = rig.add()
    for bad in ("tomorrow", "2026-11-05T09:00:00", (T0 - timedelta(hours=1)).isoformat()):
        with pytest.raises(MemoryRefused):
            await rig.call("loop_later", id=lp.id, until=bad)
    assert rig.store.get(lp.id).status == "held"


# --- the draft ---


async def test_draft_calls_only_the_draft_tool_and_shows_the_text(rig):
    source = with_source(rig)
    lp = rig.add("thr9")
    out = await rig.call("loop_draft", id=lp.id, text="Sent the deck, thanks!")
    assert source.calls == [("draft", "thr9", "Sent the deck, thanks!")]
    assert out["drafted"] is True and out["text"] == "Sent the deck, thanks!"
    assert "draft" in rig.store.get(lp.id).history[-1]["note"]


async def test_draft_through_the_gmail_adapter_reaches_create_draft_only(rig):
    seen = []

    async def call(app, tool, args):
        seen.append((tool, args))
        return SimpleNamespace(content=[SimpleNamespace(text="{}")], is_error=False)

    await GmailSource("gmail", call).draft_reply("thr9", "hi")
    assert seen == [("create_draft", {"thread_id": "thr9", "body": "hi"})]


async def test_draft_without_the_mail_switch_is_refused(rig):
    lp = rig.add()
    with pytest.raises(MemoryRefused):
        await rig.call("loop_draft", id=lp.id, text="hi")


async def test_the_draft_tool_asks_by_default_and_no_tool_is_named_send(rig):
    spec = rig.tools["loop_draft"][0]
    assert spec.effect == "change" and spec.default_mode is None  # a change tool asks
    assert not any("send" in name for name in rig.tools)


# --- stale: keep or drop ---


async def test_keep_returns_a_stale_loop_to_held_with_a_fresh_clock(rig):
    lp = rig.add()
    rig.store.set_status(lp.id, "stale")
    rig.clock.at = T0 + timedelta(days=9)
    await rig.call("loop_keep", id=lp.id)
    got = rig.store.get(lp.id)
    assert got.status == "held" and got.updated == rig.clock.at


async def test_drop_sets_dropped_and_it_leaves_the_open_list(rig):
    lp = rig.add()
    await rig.call("loop_drop", id=lp.id)
    assert rig.store.get(lp.id).status == "dropped"
    assert (await rig.call("loops_open"))["loops"] == []


# --- the daily line ---


async def test_the_first_return_of_the_day_emits_one_digest_of_what_was_held(rig):
    rig.add("a", title="Deck for Priya")
    rig.add("b", title="Invoice for Sam")
    back = Event("back", {"body": "d", "idle_seconds": 900}, key="back:d")
    rig.svc.saw(back)
    rig.svc.saw(back)
    assert len(rig.events) == 1
    facts = rig.events[0].facts
    assert facts["reason"] == "digest" and facts["count"] == 2
    assert "Deck for Priya" in facts["loops"] and "Invoice for Sam" in facts["loops"]
    rig.clock.at = T0 + timedelta(days=1)
    rig.add("c", title="Next day")
    rig.svc.saw(Event("body_online", {"body": "d", "offline_seconds": 9000}, key="b"))
    assert len(rig.events) == 2 and rig.events[1].facts["count"] == 1


async def test_nothing_held_today_means_no_digest(rig):
    rig.svc.saw(Event("back", {"body": "d", "idle_seconds": 900}, key="back:d"))
    assert rig.events == []


# --- the Priya journey ---


class Reads:
    async def read(self, item, related):
        return Change(
            kind="new",
            title="Priya needs the deck",
            asks="slide 7 needs this year's numbers",
            people=["Priya"],
            anchors=["Q4 pricing deck"],
        )


async def test_priya_mail_then_the_deck_opens_then_show_done_and_a_draft(rig):
    rig.svc._reader = Reads()
    source = with_source(rig)
    mail = MailItem("gmail", "thr1", "Priya <p@x.com>", "Q4 pricing", T0, "please fix slide 7")
    await rig.svc._process("gmail", mail)
    assert rig.events == []  # held quietly
    focus = {"body": "d", "app": "POWERPNT.EXE", "title": "Q4 pricing.pptx - PowerPoint"}
    rig.svc.saw(Event("focus", focus, key="d"))
    assert [e.facts["reason"] for e in rig.events] == ["context"]
    loop_id = rig.events[0].facts["id"]
    shown = await rig.call("loop_show", id=loop_id)
    assert shown["asks"] == "slide 7 needs this year's numbers" and "thread" in shown
    await rig.call("loop_done", id=loop_id)
    await rig.call("loop_draft", id=loop_id, text="Slide 7 is updated.")
    assert rig.store.get(loop_id).status == "done"
    assert source.calls == [("thread", "thr1"), ("draft", "thr1", "Slide 7 is updated.")]
