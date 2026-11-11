"""Dispatcher: one front-door queue, urgency from the kind, delivery by speech state.
A fake clock stands in for the batching wait, so no test sleeps for real.
"""

import asyncio
from datetime import UTC, datetime

from brain.dispatcher import BATCH_S, Dispatcher, Item
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
            w[1].set_result(None)
        await settle()


async def settle() -> None:
    for _ in range(10):
        await asyncio.sleep(0)


def make(tmp_path=None):
    clock = FakeClock()
    got: list[list[Item]] = []

    async def deliver(items):
        got.append(items)

    open_items = None
    if tmp_path is not None:
        open_items = OpenItems(open_db(tmp_path / "t.db"), lambda: datetime.now(UTC))
    d = Dispatcher(deliver, open_items=open_items, sleep=clock.sleep)
    return d, clock, got, open_items


def item(kind, key=None, payload=None, urgency="idle"):
    return Item(kind, "desktop", payload or {}, urgency, key)


async def test_now_delivered_immediately():
    d, clock, got, _ = make()
    d.start()
    d.set_speech_state("talking")
    d.post(item("say", urgency="now"))
    await settle()
    assert [[i.kind for i in b] for b in got] == [["say"]]
    await d.stop()


async def test_next_pause_waits_for_sentence_break():
    d, clock, got, _ = make()
    d.start()
    d.set_speech_state("talking")
    d.post(item("timer"))
    await clock.advance(BATCH_S)
    assert got == []
    d.set_speech_state("sentence_break")
    await settle()
    await clock.advance(BATCH_S)
    assert [[i.kind for i in b] for b in got] == [["timer"]]
    await d.stop()


async def test_next_pause_delivered_when_already_idle():
    d, clock, got, _ = make()
    d.start()
    d.post(item("timer"))
    await settle()
    await clock.advance(BATCH_S)
    assert len(got) == 1
    await d.stop()


async def test_idle_waits_for_quiet():
    d, clock, got, _ = make()
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


async def test_close_items_batched_into_one_delivery():
    d, clock, got, _ = make()
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


async def test_now_takes_waiting_items_along_in_priority_order():
    d, clock, got, _ = make()
    d.start()
    d.post(item("timer"))
    d.post(item("say", urgency="now"))
    await settle()
    assert [i.kind for i in got[0]] == ["say", "timer"]
    await d.stop()


async def test_newer_item_with_same_kind_and_key_replaces_older():
    d, clock, got, _ = make()
    d.start()
    d.post(item("timer", key="k", payload={"n": 1}))
    d.post(item("timer", key="k", payload={"n": 2}))
    await settle()
    await clock.advance(BATCH_S)
    assert [i.payload for i in got[0]] == [{"n": 2}]
    await d.stop()


async def test_hold_creates_open_item(tmp_path):
    d, clock, got, open_items = make(tmp_path)
    d.start()
    d.post(item("offer", payload={"n": 1}, urgency="hold"))
    await settle()
    await clock.advance(BATCH_S * 10)
    assert got == []
    held = open_items.list_open(kind="offer")
    assert len(held) == 1
    assert held[0].origin_body == "desktop"
    assert held[0].saved_call == {"payload": {"n": 1}}
    await d.stop()


async def test_urgency_comes_from_kind_not_payload():
    d, clock, got, _ = make()
    d.start()
    d.set_speech_state("talking")
    # The payload and the item both claim "now"; the kind says idle.
    d.post(item("job_ended", payload={"urgency": "now"}, urgency="now"))
    await settle()
    await clock.advance(BATCH_S)
    assert got == []
    await d.stop()
