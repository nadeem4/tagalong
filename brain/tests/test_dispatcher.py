"""Dispatcher: one front-door queue, urgency from the kind, delivery by speech state.
A fake clock stands in for the batching wait, so no test sleeps for real.
"""

import asyncio
import logging
from datetime import UTC, datetime

from brain.dispatcher import BATCH_S, MAX_FAILS, Dispatcher, Item
from brain.events import EVENT_KINDS, EventKind
from brain.open_items import OpenItems
from brain.store.db import open_db


class FakeClock:
    """`sleep` parks until `advance` passes its deadline."""

    def __init__(self):
        self.t = 0.0
        self._waiters: list[tuple[float, asyncio.Future]] = []

    async def sleep(self, s: float) -> None:
        fut = asyncio.get_running_loop().create_future()
        self._waiters.append((self.t + s, fut))
        await fut

    async def advance(self, s: float) -> None:
        self.t += s
        for w in [w for w in self._waiters if w[0] <= self.t]:
            self._waiters.remove(w)
            if not w[1].done():
                w[1].set_result(None)
        await settle()


async def settle() -> None:
    for _ in range(10):
        await asyncio.sleep(0)


def make(tmp_path, fail=0):
    clock = FakeClock()
    got: list[list[Item]] = []
    calls = [0]

    async def deliver(items):
        calls[0] += 1
        if calls[0] <= fail:
            raise RuntimeError("body gone")
        got.append(items)

    open_items = OpenItems(open_db(tmp_path / "t.db"), lambda: datetime.now(UTC))
    d = Dispatcher(deliver, open_items, sleep=clock.sleep, now=lambda: clock.t)
    return d, clock, got, open_items


def item(kind, key=None, payload=None, urgency="idle"):
    return Item(kind, "desktop", payload or {}, urgency, key)


async def test_now_delivered_immediately(tmp_path):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.set_speech_state("talking")
    d.post(item("say", urgency="now"))
    await settle()
    assert [[i.kind for i in b] for b in got] == [["say"]]
    await d.stop()


async def test_next_pause_waits_for_sentence_break(tmp_path):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.set_speech_state("talking")
    d.post(item("timer"))
    await clock.advance(BATCH_S)
    assert got == []
    d.set_speech_state("sentence_break")
    await settle()
    assert [[i.kind for i in b] for b in got] == [["timer"]]
    await d.stop()


async def test_next_pause_delivered_when_already_idle(tmp_path):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.post(item("timer"))
    await settle()
    await clock.advance(BATCH_S)
    assert len(got) == 1
    await d.stop()


async def test_idle_waits_for_quiet(tmp_path):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.set_speech_state("sentence_break")
    d.post(item("job_ended"))
    await settle()
    await clock.advance(BATCH_S)
    assert got == []  # a sentence break is not quiet
    d.set_conversation_active(True)
    d.set_speech_state("idle")
    await settle()
    await clock.advance(BATCH_S)
    assert got == []  # idle speech but a conversation is active
    d.set_conversation_active(False)
    await settle()
    await clock.advance(BATCH_S)
    assert [[i.kind for i in b] for b in got] == [["job_ended"]]
    await d.stop()


async def test_close_items_batched_into_one_delivery(tmp_path):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.post(item("timer", key="a"))
    await settle()
    d.post(item("job_question", key="b"))
    await settle()
    assert got == []
    await clock.advance(BATCH_S)
    assert len(got) == 1
    assert sorted(i.kind for i in got[0]) == ["job_question", "timer"]
    await d.stop()


async def test_now_takes_waiting_items_along_in_priority_order(tmp_path):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.post(item("timer"))
    d.post(item("say", urgency="now"))
    await settle()
    assert [i.kind for i in got[0]] == ["say", "timer"]
    await d.stop()


async def test_newer_item_with_same_kind_and_key_replaces_older(tmp_path):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.post(item("timer", key="k", payload={"n": 1}))
    d.post(item("timer", key="k", payload={"n": 2}))
    await settle()
    await clock.advance(BATCH_S)
    assert [i.payload for i in got[0]] == [{"n": 2}]
    await d.stop()


async def test_hold_creates_open_item(tmp_path, monkeypatch):
    # The hold comes from the registered kind, not from anything the item says.
    monkeypatch.setitem(EVENT_KINDS, "offer", EventKind("offer", urgency="hold"))
    d, clock, got, open_items = make(tmp_path)
    d.start()
    d.post(item("offer", payload={"n": 1}, urgency="now"))
    await settle()
    await clock.advance(BATCH_S * 10)
    assert got == []
    held = open_items.list_open(kind="offer")
    assert len(held) == 1
    assert held[0].origin_body == "desktop"
    assert held[0].saved_call == {"payload": {"n": 1}}
    await d.stop()


async def test_next_pause_delivered_at_a_brief_sentence_break(tmp_path):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.set_speech_state("talking")
    d.post(item("timer"))
    await settle()
    d.set_speech_state("sentence_break")
    await settle()
    d.set_speech_state("talking")  # the break is over before any window could end
    await settle()
    assert [[i.kind for i in b] for b in got] == [["timer"]]
    await d.stop()


async def test_now_posted_mid_window_does_not_wait(tmp_path):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.post(item("timer"))
    await settle()
    await clock.advance(BATCH_S / 2)
    d.post(item("say", urgency="now"))
    await settle()
    assert [i.kind for i in got[0]] == ["say", "timer"]
    await d.stop()


async def test_failed_delivery_keeps_original_order_and_newer_key_wins(tmp_path):
    d, clock, got, _ = make(tmp_path, fail=1)
    d.start()
    d.post(item("timer", key="k", payload={"n": 1}))
    await settle()
    await clock.advance(BATCH_S)  # delivery fails here
    d.post(item("timer", key="k", payload={"n": 2}))
    await settle()
    await clock.advance(BATCH_S)
    await clock.advance(BATCH_S)
    assert [i.payload for b in got for i in b] == [{"n": 2}]
    await d.stop()


async def test_repeated_failure_stops_retrying_and_logs(tmp_path, caplog):
    d, clock, got, _ = make(tmp_path, fail=100)
    d.start()
    with caplog.at_level(logging.ERROR, logger="brain.dispatcher"):
        d.post(item("timer", key="k"))
        await settle()
        for _ in range(MAX_FAILS + 3):
            await clock.advance(BATCH_S)
    assert got == []
    assert "dispatcher.gave_up" in caplog.text
    assert "timer" in caplog.text
    await d.stop()


async def test_stop_logs_what_is_left(tmp_path, caplog):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.set_speech_state("talking")
    d.post(item("timer", key="k1"))
    d.post(item("job_ended", key="k2"))
    await settle()
    with caplog.at_level(logging.WARNING, logger="brain.dispatcher"):
        await d.stop()
    assert "dispatcher.dropped" in caplog.text
    assert "timer:k1" in caplog.text and "job_ended:k2" in caplog.text


async def test_urgency_comes_from_kind_not_payload(tmp_path):
    d, clock, got, _ = make(tmp_path)
    d.start()
    d.set_speech_state("talking")
    # The payload and the item both claim "now"; the kind says idle.
    d.post(item("job_ended", payload={"urgency": "now"}, urgency="now"))
    await settle()
    await clock.advance(BATCH_S)
    assert got == []
    await d.stop()
