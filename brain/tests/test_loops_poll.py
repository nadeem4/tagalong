"""Tests for the LoopService mail poll: switch, backfill, cursor, update-not-duplicate, self-close,
the allowance stop, failures and wipe. A FakeSource stands in for the mail adapter (the Gmail
adapter has its own tests); the reader is scripted, so no model is involved."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from brain.apps import AppError
from brain.loops.loop import Loop
from brain.loops.reader import Change, MailItem, ReaderStopped
from brain.loops.service import LoopService
from brain.loops.store import LoopStore
from brain.memory import Memory

T0 = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


def mail(thread, hours_ago=1, sent=False, headers=None, sender="Priya <p@x.com>"):
    return MailItem(
        app="gmail",
        thread=thread,
        sender=sender,
        subject=f"re {thread}",
        date=T0 - timedelta(hours=hours_ago),
        body="please send it",
        headers=headers or {},
        sent=sent,
    )


class FakeSource:
    def __init__(self, inbound=(), sent=()):
        self.inbound = list(inbound)
        self.sent = list(sent)
        self.new_calls = []
        self.sent_calls = []
        self.fail = 0  # raise AppError for this many calls

    async def new_items(self, since, unanswered_only=False):
        self.new_calls.append((since, unanswered_only))
        if self.fail:
            self.fail -= 1
            raise AppError("Gmail is not connected.")
        found = [i for i in self.inbound if i.date > since]
        if unanswered_only:  # like Gmail: skip a thread whose last message is the person's own
            found = [
                i
                for i in found
                if not any(s.thread == i.thread and s.date > i.date for s in self.sent)
            ]
        return found

    async def sent_items(self, since):
        self.sent_calls.append(since)
        return [i for i in self.sent if i.date > since]

    async def draft_reply(self, thread, text):
        raise AssertionError("polling never drafts")


class ScriptReader:
    """new for an unknown thread, update for a related loop; raises when told to stop."""

    def __init__(self):
        self.seen = []
        self.stop_after = None
        self.close = False

    async def read(self, item, related):
        if self.stop_after is not None and len(self.seen) >= self.stop_after:
            raise ReaderStopped
        self.seen.append(item.thread)
        if related and self.close:
            return Change("close", loop_id=related[0].id, reason="withdrawn")
        if related:
            return Change("update", loop_id=related[0].id, asks="also the numbers")
        return Change("new", title=f"loop {item.thread}", asks=item.body, people=[item.sender])


class Clock:
    def __init__(self, at=T0):
        self.at = at

    def __call__(self):
        return self.at


@pytest.fixture
def rig(tmp_path):
    mem = Memory(tmp_path / "t.db")
    clock = Clock()
    store = LoopStore(mem.db, clock)
    reader = ScriptReader()
    events = []
    yield store, clock, reader, events, mem
    mem.close()


def service(rig, poll_s=3600):
    store, clock, reader, events, _ = rig
    return LoopService(store, events.append, clock, reader, poll_s=poll_s)


async def settled(svc, store, app="gmail", cursor=True):
    for _ in range(200):
        await asyncio.sleep(0.01)
        if (store.cursor(app) is not None) == cursor and not svc.polling(app):
            return
    raise AssertionError("poll did not settle")


async def test_switch_off_means_no_polling_at_all(rig):
    svc = service(rig)
    svc.start()
    svc.changed()
    await asyncio.sleep(0.05)
    assert not svc.polling("gmail") and svc._polls == {} and rig[0].list() == []


async def test_switch_on_backfills_14_days_unanswered_then_advances_the_cursor(rig):
    store = rig[0]
    source = FakeSource([mail("a", 5), mail("b", 2)])
    svc = service(rig)
    svc.enable("gmail", source)
    await settled(svc, store)
    assert source.new_calls[0] == (T0 - timedelta(days=14), True)
    assert sorted(lp.ref for lp in store.list()) == ["a", "b"]
    assert store.cursor("gmail") == mail("b", 2).date.isoformat()
    svc.disable("gmail")


async def test_later_polls_read_from_the_cursor_not_from_backfill(rig):
    store = rig[0]
    source = FakeSource([mail("a", 5)])
    svc = service(rig, poll_s=0.05)
    svc.enable("gmail", source)
    await settled(svc, store)
    source.inbound.append(mail("b", 1))
    for _ in range(100):
        await asyncio.sleep(0.02)
        if len(store.list()) == 2:
            break
    svc.disable("gmail")
    assert len(store.list()) == 2
    assert source.new_calls[1][1] is False
    assert source.new_calls[1][0] == mail("a", 5).date


async def test_polls_repeat_on_the_interval_until_switched_off(rig):
    store = rig[0]
    source = FakeSource()
    svc = service(rig, poll_s=0.03)
    svc.enable("gmail", source)
    await asyncio.sleep(0.3)
    svc.disable("gmail")
    n = len(source.new_calls)
    assert n >= 3
    await asyncio.sleep(0.15)
    assert len(source.new_calls) == n and store.cursor("gmail") is not None


async def test_a_second_mail_on_a_known_thread_updates_the_same_loop(rig):
    store, _, reader, _, _ = rig
    source = FakeSource([mail("a", 5), mail("a", 2)])
    svc = service(rig)
    svc.enable("gmail", source)
    await settled(svc, store)
    svc.disable("gmail")
    loops = store.list()
    assert len(loops) == 1 and loops[0].asks == "also the numbers"
    assert reader.seen == ["a", "a"]


async def test_a_sent_reply_newer_than_the_last_inbound_closes_an_i_owe_loop(rig):
    store, _, reader, _, _ = rig
    store.set_cursor("gmail", (T0 - timedelta(days=1)).isoformat())
    store.set_backfilled("gmail")
    source = FakeSource([mail("a", 5)], sent=[mail("a", 3, sent=True, sender="me")])
    svc = service(rig)
    svc.enable("gmail", source)
    await settled(svc, store)
    svc.disable("gmail")
    assert [lp.status for lp in store.list()] == ["done"]
    assert reader.seen == ["a"]  # the sent mail itself was never read by the model


async def test_an_older_sent_message_does_not_close_the_loop(rig):
    store = rig[0]
    source = FakeSource([mail("a", 2)], sent=[mail("a", 6, sent=True, sender="me")])
    svc = service(rig)
    svc.enable("gmail", source)
    await settled(svc, store)
    svc.disable("gmail")
    assert [lp.status for lp in store.list()] == ["held"]


async def test_a_sent_scan_closes_a_loop_found_on_an_earlier_poll(rig):
    store, clock, _, _, _ = rig
    source = FakeSource([mail("a", 5)])
    svc = service(rig, poll_s=0.05)
    svc.enable("gmail", source)
    await settled(svc, store)
    source.sent.append(mail("a", 0, sent=True, sender="me"))
    for _ in range(100):
        await asyncio.sleep(0.02)
        if store.list()[0].status == "done":
            break
    svc.disable("gmail")
    assert store.list()[0].status == "done"


async def test_a_reader_close_closes_the_loop(rig):
    store, _, reader, _, _ = rig
    reader.close = True
    source = FakeSource([mail("a", 5), mail("a", 2)])
    svc = service(rig)
    svc.enable("gmail", source)
    await settled(svc, store)
    svc.disable("gmail")
    assert [lp.status for lp in store.list()] == ["done"]


async def test_bulk_mail_costs_no_reader_call_and_still_moves_the_cursor(rig):
    store, _, reader, _, _ = rig
    bulk = mail("n", 2, headers={"List-Unsubscribe": "<x>"})
    svc = service(rig)
    svc.enable("gmail", FakeSource([bulk]))
    await settled(svc, store)
    svc.disable("gmail")
    assert reader.seen == [] and store.list() == []
    assert store.cursor("gmail") == bulk.date.isoformat()


async def test_allowance_spent_mid_backfill_stops_then_resumes_without_loss(rig):
    store, clock, reader, _, _ = rig
    source = FakeSource([mail("a", 6), mail("b", 4), mail("c", 2)])
    reader.stop_after = 1
    svc = service(rig, poll_s=0.05)
    svc.enable("gmail", source)
    for _ in range(100):
        await asyncio.sleep(0.02)
        if svc.unread_since("gmail"):
            break
    assert svc.unread_since("gmail") == T0
    assert store.cursor("gmail") == mail("a", 6).date.isoformat()
    assert [lp.ref for lp in store.list()] == ["a"]
    reader.stop_after = None  # the next day: the allowance is back
    for _ in range(100):
        await asyncio.sleep(0.02)
        if len(store.list()) == 3 and svc.unread_since("gmail") is None:
            break
    svc.disable("gmail")
    assert sorted(lp.ref for lp in store.list()) == ["a", "b", "c"]
    assert reader.seen == ["a", "b", "c"]  # a was never read twice


async def test_an_app_error_retries_next_interval_and_flags_unread_after_repeats(rig):
    store = rig[0]
    source = FakeSource([mail("a", 2)])
    source.fail = 3
    svc = service(rig, poll_s=0.03)
    svc.enable("gmail", source)
    for _ in range(100):
        await asyncio.sleep(0.02)
        if svc.unread_since("gmail"):
            break
    assert svc.unread_since("gmail") == T0
    for _ in range(100):
        await asyncio.sleep(0.02)
        if store.list():
            break
    svc.disable("gmail")
    assert len(store.list()) == 1 and svc.unread_since("gmail") is None


async def test_one_failure_alone_does_not_flag_unread(rig):
    source = FakeSource()
    source.fail = 1
    svc = service(rig, poll_s=3600)
    svc.enable("gmail", source)
    await asyncio.sleep(0.1)
    svc.disable("gmail")
    assert svc.unread_since("gmail") is None


async def test_wipe_deletes_loops_and_cursor_and_the_next_switch_on_backfills_again(rig):
    store = rig[0]
    source = FakeSource([mail("a", 5)])
    svc = service(rig)
    svc.enable("gmail", source)
    await settled(svc, store)
    svc.wipe()
    assert store.list() == [] and store.cursor("gmail") is None
    n = len(source.new_calls)
    await asyncio.sleep(0.1)
    assert len(source.new_calls) == n  # wipe also switched the polling off
    svc.enable("gmail", source)
    await settled(svc, store)
    svc.disable("gmail")
    assert source.new_calls[-1][1] is True and len(store.list()) == 1


async def test_new_mail_on_a_finished_thread_reopens_it(rig):
    store = rig[0]
    done = store.save(Loop(source="gmail", ref="a", title="old", asks="x"))
    store.set_status(done.id, "done")
    svc = service(rig)
    svc.enable("gmail", FakeSource([mail("a", 1)]))
    await settled(svc, store)
    svc.disable("gmail")
    assert [lp.status for lp in store.list()] == ["held"] and len(store.list()) == 1


async def test_enable_builds_the_gmail_source_only_for_a_mail_app(rig):
    class Tool:
        def __init__(self, name):
            self.name = name

    class StubApps:
        def __init__(self, names):
            self._names = names

        def tools(self, app_id):
            return [Tool(n) for n in self._names]

        async def call(self, *a, **k):
            raise AssertionError("not called here")

    store, clock, reader, events, _ = rig
    plain = LoopService(store, events.append, clock, reader, apps=StubApps(["echo"]))
    with pytest.raises(ValueError):
        plain.enable("notes")
    mail_app = LoopService(
        store,
        events.append,
        clock,
        reader,
        apps=StubApps(["search_threads", "get_thread", "create_draft", "send_message"]),
        poll_s=3600,
    )
    mail_app.enable("gmail")
    assert "gmail" in mail_app._sources
    mail_app.disable("gmail")


async def test_a_stop_mid_backfill_keeps_reading_unanswered_only_on_resume(rig):
    store, _, reader, _, _ = rig
    answered = mail("c", 2)
    source = FakeSource([mail("a", 6), mail("b", 4), answered], sent=[mail("c", 1, sent=True)])
    reader.stop_after = 1
    svc = service(rig, poll_s=0.05)
    svc.enable("gmail", source)
    for _ in range(100):
        await asyncio.sleep(0.02)
        if svc.unread_since("gmail"):
            break
    reader.stop_after = None
    for _ in range(100):
        await asyncio.sleep(0.02)
        if len(store.list()) == 2 and svc.unread_since("gmail") is None:
            break
    svc.disable("gmail")
    assert reader.seen == ["a", "b"]  # the answered thread was never read
    assert [flag for _, flag in source.new_calls[:2]] == [True, True]


async def test_switching_on_twice_during_a_poll_leaves_one_poll_chain(rig):
    store = rig[0]
    gate = asyncio.Event()

    class Slow(FakeSource):
        async def new_items(self, since, unanswered_only=False):
            self.new_calls.append((since, unanswered_only))
            await gate.wait()
            return []

    source = Slow()
    svc = service(rig, poll_s=0.05)
    svc.enable("gmail", source)
    await asyncio.sleep(0.03)
    svc.enable("gmail", source)  # while the first poll is in flight
    await asyncio.sleep(0.03)
    svc.enable("gmail", source)
    gate.set()
    await asyncio.sleep(0.05)
    before = len(source.new_calls)
    await asyncio.sleep(0.5)
    svc.disable("gmail")
    rate = len(source.new_calls) - before
    assert rate <= 11  # one chain at 50 ms; two chains would be about 20
    assert store.cursor("gmail") is not None


async def test_any_error_counts_toward_unread_since(rig):
    class Broken(FakeSource):
        async def new_items(self, since, unanswered_only=False):
            raise RuntimeError("malformed")

    svc = service(rig, poll_s=0.03)
    svc.enable("gmail", Broken())
    for _ in range(100):
        await asyncio.sleep(0.02)
        if svc.unread_since("gmail"):
            break
    svc.disable("gmail")
    assert svc.unread_since("gmail") == T0


async def test_the_sent_scan_has_its_own_cursor(rig):
    store = rig[0]
    source = FakeSource([mail("a", 5)], sent=[mail("z", 3, sent=True, sender="me")])
    svc = service(rig, poll_s=0.05)
    svc.enable("gmail", source)
    await settled(svc, store)
    for _ in range(100):
        await asyncio.sleep(0.02)
        if len(source.sent_calls) >= 2:
            break
    svc.disable("gmail")
    assert source.sent_calls[1] == mail("z", 3).date  # not the inbound cursor (a, 5 h ago)


async def test_the_you_replied_note_does_not_count_as_inbound_mail(rig):
    store = rig[0]
    store.set_cursor("gmail", (T0 - timedelta(days=1)).isoformat())
    store.set_backfilled("gmail")
    source = FakeSource([mail("a", 5)], sent=[mail("a", 3, sent=True, sender="me")])
    svc = service(rig)
    svc.enable("gmail", source)
    await settled(svc, store)
    svc.disable("gmail")
    notes = {h["note"]: h for h in store.list()[0].history}
    assert "mail_at" in notes["mail from Priya <p@x.com>"] and "mail_at" not in notes["you replied"]


async def test_an_inbound_reply_on_a_they_owe_loop_cancels_its_old_quiet(rig):
    store, clock, _, events, _ = rig
    store.save(
        Loop(
            source="gmail",
            ref="a",
            title="t",
            asks="x",
            direction="they_owe",
            quiet_after=clock.at + timedelta(hours=1),
        )
    )
    svc = service(rig)
    svc.enable("gmail", FakeSource([mail("a", 1)]))
    await settled(svc, store)
    svc.disable("gmail")
    clock.at += timedelta(hours=2)
    svc.fire_due()
    assert [e for e in events if e.facts.get("reason") == "quiet"] == []


async def test_a_saved_switch_polls_mail_once_the_app_connects_after_start(rig):
    class Result:
        is_error = False
        content = [type("C", (), {"text": "{}"})()]

    class Tool:
        def __init__(self, name):
            self.name = name

    class LateApps:
        def __init__(self):
            self.names = []  # apps.start() connects in the background, after loops.start()
            self.calls = 0

        def tools(self, app_id):
            return [Tool(n) for n in self.names]

        async def call(self, *a, **k):
            self.calls += 1
            if not self.names:
                raise AppError("Gmail is not connected.")
            return Result()

    store, clock, reader, events, _ = rig
    store.set_on("gmail", True)
    apps = LateApps()
    svc = LoopService(store, events.append, clock, reader, apps=apps, poll_s=0.05)
    svc.start()
    assert svc.is_on("gmail")  # on even though no tools are visible yet
    await asyncio.sleep(0.1)
    assert apps.calls > 0 and svc._fails.get("gmail", 0) > 0  # not connected: a failed poll
    apps.names = ["search_threads", "get_thread", "create_draft", "send_message"]
    for _ in range(100):
        await asyncio.sleep(0.02)
        if svc._fails.get("gmail") == 0:
            break
    assert svc._fails.get("gmail") == 0  # connected: the poll reads mail again
    svc.disable("gmail")
