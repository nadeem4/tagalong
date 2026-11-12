"""Dispatcher: one front door. The gate (urgency from the kind, delivery by speech state), the
wake (batch per kind, hourly caps, one turn at a time, body choice) and the hold (budget spent,
quiet hours, too old, a delivery that gave up, stop) all live in it, so one rig tests them.
A fake clock stands in for every wait; only the timer test uses real time.
"""

import asyncio
import logging
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from brain.bodies import Bodies
from brain.builtin_guards import spend_guards, wake_caps
from brain.dispatcher import MAX_FAILS, RETRY_S, STALE_S, Dispatcher, Item
from brain.events import EVENT_KINDS, Event, EventKind
from brain.guards import Guard, Guards, Hook, rewrite, stop
from brain.open_items import OpenItems
from brain.store.db import open_db

T0 = datetime(2026, 10, 28, 12, 0, tzinfo=UTC)

KINDS = {
    "ping": EventKind("ping", batch_seconds=0),
    "pong": EventKind("pong", batch_seconds=0),
    "slow": EventKind("slow", batch_seconds=30),
    "single": EventKind("single", batch_seconds=None),
    "soon": EventKind("soon", urgency="next_pause", batch_seconds=0),
    "urgent": EventKind("urgent", urgency="now", batch_seconds=0),
    "say": EventKind("say", urgency="now", wakes=False),
    "focus": EventKind("focus", wakes=False),
    "off": EventKind("off", enabled=False),
    "parked": EventKind("parked", urgency="hold"),
}


class Open:
    def allows(self) -> bool:
        return True


class Spent:
    def allows(self) -> bool:
        return False


class FakeBodies(Bodies):
    def __init__(self, online: list[str]) -> None:
        super().__init__()
        self.ids = online
        self.headless: set[str] = set()
        self.phones: set[str] = set()

    def online_ids(self) -> list[str]:
        return list(self.ids)

    def display_ids(self) -> list[str]:
        shown = [i for i in self.ids if i not in self.headless]
        return sorted(shown, key=self.is_phone)  # screens first, the phone last

    def is_phone(self, body_id: str) -> bool:
        return body_id in self.phones

    def is_online(self, body_id: str) -> bool:
        return body_id in self.ids


async def settle() -> None:
    for _ in range(10):
        await asyncio.sleep(0)


class Rig:
    def __init__(
        self,
        tmp_path,
        online=("desktop",),
        kinds=KINDS,
        last="desktop",
        budget=None,
        wakes=12,
        guards=None,
        quiet=None,
        fail=0,
    ) -> None:
        self.bodies = FakeBodies(list(online))
        self.starts: list[tuple[str, list]] = []
        self.delivered: list[Item] = []
        self.gave_up: list[Item] = []
        self.busy = False
        self.last = last
        self.t = T0
        self.fail = fail
        self._sleepers: list[tuple[datetime, asyncio.Future]] = []
        self.items = OpenItems(open_db(tmp_path / "t.db"), lambda: self.t)
        if guards is None:
            guards = spend_guards(budget or Open(), 25)
            guards.add(wake_caps(wakes))
        self.d = Dispatcher(
            self._deliver,
            self.items,
            bodies=self.bodies,
            guards=guards,
            busy=lambda: self.busy,
            last_body=lambda: self.last,
            start=self._start,
            now=lambda: self.t,
            gave_up=self.gave_up.append,
            quiet=quiet,
            kinds=kinds,
            notes={k: f"note for {k}" for k in kinds},
            sleep=self._sleep,
        )

    async def _deliver(self, item: Item) -> None:
        if self.fail > 0:
            self.fail -= 1
            raise RuntimeError("body gone")
        self.delivered.append(item)

    def _start(self, body_id: str, content: list) -> str:
        self.starts.append((body_id, content))
        return f"t{len(self.starts)}"

    async def _sleep(self, s: float) -> None:
        fut = asyncio.get_running_loop().create_future()
        self._sleepers.append((self.t + timedelta(seconds=s), fut))
        await fut

    async def advance(self, s: float) -> None:
        self.t += timedelta(seconds=s)
        for w in [w for w in self._sleepers if w[0] <= self.t]:
            self._sleepers.remove(w)
            if not w[1].done():
                w[1].set_result(None)
        await settle()

    async def emit(self, event: Event, on_start=None, on_drop=None, on_end=None) -> None:
        item = Item(
            event.kind, event.origin_body, dict(event.facts), "idle", event.key,
            on_start, on_drop, on_end,
        )  # fmt: skip
        self.d.post(item)
        await settle()

    def text(self, i: int = 0) -> str:
        return self.starts[i][1][0]["text"]

    def held(self) -> list[dict]:
        return [i.saved_call for i in self.items.list_open(kind="held")]


@pytest.fixture
async def make(tmp_path):
    rigs: list[Rig] = []

    def build(**kw) -> Rig:
        rigs.append(Rig(tmp_path, **kw))
        return rigs[-1]

    yield build
    for r in rigs:
        await r.d.stop()


def ev(kind="ping", key=None, **facts) -> Event:
    return Event(kind, facts, key)


# ---- the gate: urgency from the kind, delivery by speech state ----


async def test_now_goes_at_once_even_while_talking(make):
    rig = make()
    rig.d.set_speech_state("talking")
    await rig.emit(ev("urgent"))
    assert len(rig.starts) == 1


async def test_say_is_handed_to_deliver_not_started_as_a_wake(make):
    rig = make()
    rig.d.set_speech_state("talking")
    rig.d.post(Item("say", "desktop", {}, "now"))
    await settle()
    assert [i.kind for i in rig.delivered] == ["say"] and rig.starts == []


async def test_next_pause_waits_for_a_sentence_break(make):
    rig = make()
    rig.d.set_speech_state("talking")
    await rig.emit(ev("soon"))
    assert rig.starts == []
    rig.d.set_speech_state("sentence_break")
    await settle()
    assert len(rig.starts) == 1


async def test_next_pause_goes_when_already_idle(make):
    rig = make()
    await rig.emit(ev("soon"))
    assert len(rig.starts) == 1


async def test_next_pause_goes_at_a_brief_sentence_break(make):
    rig = make()
    rig.d.set_speech_state("talking")
    await rig.emit(ev("soon"))
    rig.d.set_speech_state("sentence_break")
    await settle()
    rig.d.set_speech_state("talking")  # the break is over before anything else could happen
    await settle()
    assert len(rig.starts) == 1


async def test_idle_waits_for_quiet_and_no_conversation(make):
    rig = make()
    rig.d.set_speech_state("sentence_break")
    await rig.emit(ev("ping"))
    assert rig.starts == []  # a sentence break is not quiet
    rig.d.set_conversation_active(True)
    rig.d.set_speech_state("idle")
    await settle()
    assert rig.starts == []  # idle speech but a conversation is active
    rig.d.set_conversation_active(False)
    await settle()
    assert len(rig.starts) == 1


async def test_urgency_comes_from_kind_not_payload(make):
    rig = make()
    rig.d.set_speech_state("talking")
    # The item and its payload both claim "now"; the kind says idle.
    rig.d.post(Item("ping", "desktop", {"urgency": "now"}, "now"))
    await settle()
    assert rig.starts == []


async def test_an_unregistered_kind_is_refused(make):
    rig = make()
    with pytest.raises(ValueError):
        rig.d.post(Item("nope", "desktop", {}, "now"))


async def test_a_disabled_kind_is_dropped_and_logged(make, caplog):
    rig = make()
    with caplog.at_level(logging.WARNING, logger="brain.dispatcher"):
        await rig.emit(ev("off"))
    assert rig.starts == [] and "off" in caplog.text


async def test_a_hold_kind_becomes_a_held_open_item(make):
    rig = make()
    await rig.emit(ev("parked", n=1), on_start=lambda: pytest.fail("a held item never starts"))
    assert rig.starts == []
    assert rig.held() == [{"event": "parked", "key": None, "why": "held_kind", "facts": {"n": 1}}]
    assert rig.items.list_open(kind="held")[0].origin_body == "brain"


async def test_a_newer_item_with_the_same_kind_and_key_replaces_a_waiting_one(make):
    rig = make()
    rig.d.set_speech_state("talking")
    await rig.emit(ev("soon", key="k", n="1"))
    await rig.emit(ev("soon", key="k", n="2"))
    rig.d.set_speech_state("idle")
    await settle()
    assert len(rig.starts) == 1 and "n: 2" in rig.text() and "n: 1" not in rig.text()


# ---- a delivery that fails ----


async def test_a_failed_delivery_is_tried_again(make):
    rig = make(fail=1)
    rig.d.post(Item("say", "desktop", {"n": 1}, "now"))
    await settle()
    assert rig.delivered == []
    await rig.advance(RETRY_S)
    assert [i.payload for i in rig.delivered] == [{"n": 1}]


async def test_giving_up_holds_the_item_and_tells_the_session(make, caplog):
    rig = make(fail=100)
    with caplog.at_level(logging.ERROR, logger="brain.dispatcher"):
        rig.d.post(Item("say", "desktop", {"token": "x", "words": "hi"}, "now"))
        await settle()
        for _ in range(MAX_FAILS + 2):
            await rig.advance(RETRY_S)
    assert rig.delivered == []
    assert "dispatcher.gave_up" in caplog.text
    assert [i.kind for i in rig.gave_up] == ["say"]
    held = rig.held()
    assert len(held) == 1 and held[0]["why"] == "gave_up" and held[0]["event"] == "say"


async def test_a_held_say_keeps_no_futures_or_words_only_plain_facts(make):
    rig = make(fail=100)
    result = asyncio.get_running_loop().create_future()
    rig.d.post(Item("say", "desktop", {"result": result, "token": "x"}, "now"))
    await settle()
    for _ in range(MAX_FAILS + 2):
        await rig.advance(RETRY_S)
    assert rig.held()[0]["facts"] == {"token": "x"}


async def test_stop_holds_what_is_left_and_tells_the_session(make):
    rig = make()
    rig.d.set_speech_state("talking")
    await rig.emit(ev("ping", key="k1"))
    rig.busy = True
    rig.d.set_speech_state("idle")
    await settle()  # k1 is past the gate, waiting for the turn to end
    rig.d.set_speech_state("talking")
    await rig.emit(ev("ping", key="k2"))  # still at the gate
    await rig.d.stop()
    why = sorted((h["key"], h["why"]) for h in rig.held())
    assert why == [("k1", "stopped"), ("k2", "stopped")]
    assert len(rig.gave_up) == 2


# ---- the wake: body choice ----


async def test_a_wake_starts_on_the_last_body_when_idle(make):
    rig = make(online=("desktop", "extension"))
    await rig.emit(ev(a="1"))
    assert len(rig.starts) == 1
    body, content = rig.starts[0]
    assert body == "desktop" and content[0]["text"].startswith('<data kind="event">')


async def test_falls_back_to_any_online_body_when_the_last_is_offline(make):
    rig = make(online=("extension",), last="desktop")
    await rig.emit(ev())
    assert [b for b, _ in rig.starts] == ["extension"]


async def test_a_wake_never_goes_to_a_display_less_body(make):
    rig = make(online=("browser", "desktop"), last="browser")
    rig.bodies.headless = {"browser"}
    await rig.emit(ev())
    assert [b for b, _ in rig.starts] == ["desktop"]


async def test_a_wake_prefers_a_screen_to_a_whatsapp_body_even_if_it_was_last(make):
    rig = make(online=("whatsapp", "desktop"), last="whatsapp")
    rig.bodies.phones = {"whatsapp"}
    await rig.emit(ev())
    assert [b for b, _ in rig.starts] == ["desktop"]


async def test_a_wake_goes_to_a_whatsapp_body_when_it_is_the_only_one_online(make):
    rig = make(online=("whatsapp",), last="whatsapp")
    rig.bodies.phones = {"whatsapp"}
    await rig.emit(ev())
    assert [b for b, _ in rig.starts] == ["whatsapp"]


async def test_a_whatsapp_event_wake_runs_on_whatsapp(make):
    rig = make(online=("desktop", "whatsapp"), last="desktop")
    rig.bodies.phones = {"whatsapp"}
    await rig.emit(Event("ping", {"body": "whatsapp"}, origin_body="whatsapp"))
    assert [b for b, _ in rig.starts] == ["whatsapp"]


async def test_a_wake_waits_when_only_display_less_bodies_are_online(make):
    rig = make(online=("browser",), last="browser")
    rig.bodies.headless = {"browser"}
    await rig.emit(ev())
    assert rig.starts == []
    rig.bodies.ids.append("desktop")
    rig.d.pump()
    assert [b for b, _ in rig.starts] == ["desktop"]


async def test_no_body_online_waits_and_a_connect_runs_it(make):
    rig = make(online=())
    await rig.emit(ev())
    assert rig.starts == []
    rig.bodies.ids.append("desktop")
    rig.d.pump()
    assert len(rig.starts) == 1


async def test_a_loop_wake_with_no_display_body_waits_and_is_not_lost(make):
    rig = make(online=("browser",), kinds={"loop": EVENT_KINDS["loop"]}, last="browser")
    rig.bodies.headless = {"browser"}
    await rig.emit(Event("loop", {"reason": "due", "title": "Send the deck"}, key="loop:1"))
    assert rig.starts == []
    rig.bodies.ids.append("desktop")
    rig.d.pump()
    assert [b for b, _ in rig.starts] == ["desktop"]
    assert "reason: due" in rig.text()


# ---- the wake: one turn at a time, batching, replacing ----


async def test_busy_blocks_and_turn_ended_runs_the_next(make):
    rig = make()
    rig.busy = True
    await rig.emit(ev())
    assert rig.starts == []
    rig.busy = False
    rig.d.turn_ended("t")
    assert len(rig.starts) == 1


async def test_two_kinds_run_as_separate_turns_in_order(make):
    rig = make()
    rig.busy = True
    await rig.emit(ev("ping"))
    await rig.emit(ev("pong"))
    rig.busy = False
    rig.d.pump()
    assert len(rig.starts) == 1 and "Event: ping" in rig.text(0)
    rig.d.turn_ended("t1")
    assert len(rig.starts) == 2 and "Event: pong" in rig.text(1)


async def test_events_within_the_batch_window_merge_into_one_wake(make):
    rig = make()
    await rig.emit(ev("slow", a="first"))
    rig.t = T0 + timedelta(seconds=10)
    await rig.emit(ev("slow", a="second"))
    assert rig.starts == []
    rig.t = T0 + timedelta(seconds=30)
    rig.d.pump()
    assert len(rig.starts) == 1
    assert "first" in rig.text() and "second" in rig.text()


async def test_events_arriving_while_blocked_join_the_waiting_group(make):
    rig = make()
    rig.busy = True
    await rig.emit(ev("ping", a="one"))
    rig.t = T0 + timedelta(seconds=100)
    await rig.emit(ev("ping", a="two"))
    rig.busy = False
    rig.d.pump()
    assert len(rig.starts) == 1
    assert "one" in rig.text() and "two" in rig.text()


async def test_same_key_replaces_a_waiting_event_and_drops_its_on_start(make):
    rig = make()
    rig.busy = True
    ran: list[str] = []
    await rig.emit(ev("ping", key="k", fact="old"), on_start=lambda: ran.append("old"))
    await rig.emit(ev("ping", key="k", fact="new"), on_start=lambda: ran.append("new"))
    rig.busy = False
    rig.d.pump()
    assert "fact: new" in rig.text() and "fact: old" not in rig.text()
    assert ran == ["new"]


async def test_batch_seconds_none_never_merges(make):
    rig = make()
    rig.busy = True
    await rig.emit(ev("single", a="one"))
    await rig.emit(ev("single", a="two"))
    rig.busy = False
    rig.d.pump()
    assert len(rig.starts) == 1 and "one" in rig.text(0) and "two" not in rig.text(0)
    rig.d.turn_ended("t1")
    assert len(rig.starts) == 2 and "two" in rig.text(1)


async def test_a_key_replaces_a_waiting_event_of_a_never_merged_kind(make):
    rig = make()
    rig.busy = True
    ran = []
    await rig.emit(ev("single", key="k", a="old"), on_start=lambda: ran.append("old"))
    await rig.emit(ev("single", key="k", a="new"), on_start=lambda: ran.append("new"))
    await rig.emit(ev("single", key="other", a="third"))
    rig.busy = False
    rig.d.pump()
    assert "a: new" in rig.text(0) and "old" not in rig.text(0)
    rig.d.turn_ended("t1")
    assert "third" in rig.text(1)
    assert ran == ["new"]


async def test_on_start_runs_after_the_turn_starts(make):
    rig = make()
    seen: list[int] = []
    await rig.emit(ev(), on_start=lambda: seen.append(len(rig.starts)))
    assert seen == [1]


async def test_on_end_runs_when_the_wake_turn_ends(make):
    rig = make()
    ended = []
    await rig.emit(ev(), on_end=ended.append)
    assert ended == []
    rig.d.turn_ended("other")
    assert ended == []
    rig.d.turn_ended("t1")  # the id start returned
    assert ended == ["done"]
    rig.d.turn_ended("t1")
    assert ended == ["done"]


async def test_on_end_does_not_run_for_a_replaced_event(make):
    rig = make()
    rig.busy = True
    ended = []
    await rig.emit(ev("ping", key="k"), on_end=lambda reason: ended.append("old"))
    await rig.emit(ev("ping", key="k"), on_end=lambda reason: ended.append("new"))
    rig.busy = False
    rig.d.pump()
    rig.d.turn_ended("t1")
    assert ended == ["new"]


async def test_a_raising_hook_does_not_stop_the_other_hooks_or_the_pump(make, caplog):
    rig = make()
    rig.busy = True
    ran = []

    def boom(*_):
        raise RuntimeError("hook broke")

    await rig.emit(ev("single", a="1"), on_start=boom)
    await rig.emit(ev("single", a="2"), on_start=lambda: ran.append("second"))
    rig.busy = False
    with caplog.at_level(logging.ERROR, logger="brain.dispatcher"):
        rig.d.pump()
        rig.d.turn_ended("t1")
    assert len(rig.starts) == 2 and ran == ["second"]
    assert "hook broke" in caplog.text

    rig2 = make()
    ends = []
    await rig2.emit(ev("slow", a="1"), on_end=boom)
    await rig2.emit(ev("slow", a="2"), on_end=lambda reason: ends.append("b"))
    rig2.t = T0 + timedelta(seconds=30)
    rig2.d.pump()
    rig2.d.turn_ended("t1")  # boom must not stop "b"
    assert ends == ["b"]


async def test_context_only_kind_updates_latest_and_never_wakes(make):
    rig = make()
    rig.d.record(ev("focus", key="a", title="old"))
    rig.d.record(ev("focus", key="a", title="new"))
    rig.d.record(ev("focus", key="b", title="other"))
    rig.d.record(ev("focus", title="nokey"))
    assert rig.starts == []
    latest = rig.d.latest("focus")
    assert latest["a"].facts["title"] == "new"
    assert latest["b"].facts["title"] == "other"
    assert latest[""].facts["title"] == "nokey"
    assert rig.d.latest("ping") == {}


async def test_drop_removes_a_waiting_event_of_that_kind_and_key(make):
    rig = make()
    rig.busy = True
    await rig.emit(ev("slow", key="job:a", fact="x"))
    rig.d.drop("slow", "job:a")
    rig.busy = False
    rig.t = T0 + timedelta(hours=1)
    rig.d.pump()
    assert rig.starts == [] and rig.held() == []


async def test_drop_leaves_other_keys_and_kinds_alone(make):
    rig = make()
    rig.busy = True
    await rig.emit(ev("slow", key="job:a", fact="a"))
    await rig.emit(ev("slow", key="job:b", fact="b"))
    await rig.emit(ev("ping", key="job:a", fact="p"))
    rig.d.drop("slow", "job:a")
    rig.busy = False
    rig.t = T0 + timedelta(minutes=5)
    for _ in range(3):  # one waiting group starts per pump
        rig.d.pump()
    texts = " ".join(rig.text(i) for i in range(len(rig.starts)))
    assert "fact: b" in texts and "fact: p" in texts and "fact: a" not in texts


async def test_drop_of_an_unknown_key_or_kind_is_a_no_op(make):
    rig = make()
    rig.d.drop("slow", "nope")
    rig.d.drop("never_heard_of", "nope")
    assert rig.starts == []


async def test_a_newer_event_for_the_same_key_in_a_batch_is_the_one_waiting(make):
    rig = make()
    await rig.emit(ev("slow", key="job:a", fact="first"))
    rig.t = T0 + timedelta(seconds=10)
    await rig.emit(ev("slow", key="job:a", fact="second"))
    rig.t = T0 + timedelta(seconds=60)
    rig.d.pump()
    assert "fact: second" in rig.text() and "fact: first" not in rig.text()


async def test_pump_arms_a_timer_for_the_batch(make):
    quick = {"quick": EventKind("quick", batch_seconds=1)}
    rig = make(kinds=quick)
    rig.t = datetime.now(UTC)  # the timer is real: let the batch really end
    rig.d._now = lambda: datetime.now(UTC)
    await rig.emit(ev("quick"))
    assert rig.starts == [] and rig.d._timer is not None
    for _ in range(30):  # poll: a fixed sleep is thin against a 1 s batch on Windows
        if rig.starts:
            break
        await asyncio.sleep(0.1)
    assert len(rig.starts) == 1


# ---- caps ----

CAPPED = {
    "a": EventKind("a", batch_seconds=0, max_per_hour=2),
    "b": EventKind("b", batch_seconds=0, max_per_hour=5),
    "free": EventKind("free", batch_seconds=0, max_per_hour=None),
}


async def emit_at(rig: Rig, seconds: int, event: Event) -> None:
    rig.t = T0 + timedelta(seconds=seconds)
    await rig.emit(event)


async def test_per_kind_cap_waits_until_the_window_frees(make):
    rig = make(kinds=CAPPED)
    for seconds in (0, 60, 120):
        await emit_at(rig, seconds, ev("a", n=str(seconds)))
    assert len(rig.starts) == 2
    rig.t = T0 + timedelta(seconds=3599)
    rig.d.pump()
    assert len(rig.starts) == 2
    rig.t = T0 + timedelta(seconds=3600)
    rig.d.pump()
    assert len(rig.starts) == 3


async def test_job_quiet_wakes_at_most_three_times_an_hour(make):
    rig = make(kinds={"job_quiet": EVENT_KINDS["job_quiet"]})
    for minute in (0, 10, 20, 30):
        rig.t = T0 + timedelta(minutes=minute)
        await rig.emit(ev("job_quiet", key="job:a", n=str(minute)))
    assert len(rig.starts) == 3  # the fourth waits until the window frees


async def test_waiting_events_merge_into_one_wake_when_the_cap_frees(make):
    rig = make(kinds={"a": EventKind("a", batch_seconds=30, max_per_hour=1)})
    await rig.emit(ev("a", n="1"))
    rig.t = T0 + timedelta(seconds=30)
    rig.d.pump()
    assert len(rig.starts) == 1
    for i, n in ((100, "3"), (200, "4")):
        await emit_at(rig, i, ev("a", n=n))
    rig.t = T0 + timedelta(seconds=3700)
    rig.d.pump()
    assert len(rig.starts) == 2
    assert "n: 3" in rig.text(1) and "n: 4" in rig.text(1)


async def test_global_cap_counts_every_capped_kind(make):
    rig = make(kinds=CAPPED, wakes=3)
    for kind in ("a", "b", "a"):
        await rig.emit(ev(kind))
    assert len(rig.starts) == 3
    await rig.emit(ev("b"))
    assert len(rig.starts) == 3
    rig.t = T0 + timedelta(seconds=3599)
    rig.d.pump()
    assert len(rig.starts) == 3
    rig.t = T0 + timedelta(seconds=3600)
    rig.d.pump()
    assert len(rig.starts) == 4


async def test_exempt_kind_ignores_both_caps_and_is_not_counted(make):
    rig = make(kinds=CAPPED, wakes=1)
    await rig.emit(ev("a"))
    await rig.emit(ev("free"))
    assert len(rig.starts) == 2
    await rig.emit(ev("free"))
    assert len(rig.starts) == 3
    await rig.emit(ev("b"))  # the global cap of 1 is used by "a" alone
    assert len(rig.starts) == 3


async def test_cap_held_group_arms_a_timer_for_the_cap_wait(make, monkeypatch):
    rig = make(kinds=CAPPED)
    for seconds in (0, 60, 120):
        await emit_at(rig, seconds, ev("a"))
    delays = []
    loop = asyncio.get_running_loop()
    monkeypatch.setattr(
        loop, "call_later", lambda d, cb: delays.append(d) or loop.call_soon(lambda: None)
    )
    rig.d.pump()
    assert delays == [3600 - 120]


async def test_job_question_wakes_twice_even_with_the_hourly_cap_used_up(make):
    rig = make(kinds=EVENT_KINDS, wakes=1)
    await rig.emit(ev("timer"))  # uses the one capped wake
    rig.d.turn_ended("t1")
    await rig.emit(ev("job_question", a="one"))
    rig.d.turn_ended("t2")
    await rig.emit(ev("job_question", a="two"))
    assert len(rig.starts) == 3
    assert "one" in rig.text(1) and "two" in rig.text(2)


# ---- the hold: nothing is dropped silently ----


async def test_budget_spent_holds_not_drops(make):
    rig = make(budget=Spent())
    told, dropped = [], []
    await rig.emit(
        ev("ping", n="1"), on_start=lambda: told.append(1), on_drop=lambda: dropped.append(1)
    )
    await rig.emit(ev("single", n="2"))
    assert rig.starts == [] and told == [] and dropped == [1]
    assert sorted((h["event"], h["why"]) for h in rig.held()) == [
        ("ping", "budget_spent"),
        ("single", "budget_spent"),
    ]
    rig.t = T0 + timedelta(days=1)
    rig.d.pump()
    assert rig.starts == []  # nothing is left waiting


async def test_a_spent_budget_holds_when_the_emit_guard_stops_with_over_budget(make):
    guards = Guards()
    guards.add(Guard("test", Hook.emit, lambda ctx: stop("no", "over_budget")))
    rig = make(guards=guards)
    await rig.emit(ev("ping"))
    assert rig.starts == [] and [h["why"] for h in rig.held()] == ["budget_spent"]


async def test_the_emit_guard_stopping_with_another_code_keeps_the_wake(make):
    guards = Guards()
    guards.add(Guard("test", Hook.emit, lambda ctx: stop("no", "other")))
    rig = make(guards=guards)
    await rig.emit(ev("ping"))
    assert len(rig.starts) == 1 and rig.held() == []


async def test_context_only_events_survive_a_spent_budget(make):
    rig = make(budget=Spent())
    rig.d.record(ev("focus", title="x"))
    assert rig.d.latest("focus")[""].facts["title"] == "x"


async def test_quiet_hours_hold(make):
    quiet = [True]
    rig = make(kinds=CAPPED, quiet=lambda now: quiet[0])
    await rig.emit(ev("a", n="1"))
    assert rig.starts == [] and [h["why"] for h in rig.held()] == ["quiet_hours"]
    quiet[0] = False
    await rig.emit(ev("a", n="2"))
    assert len(rig.starts) == 1 and "n: 2" in rig.text()


async def test_away_holds_and_shows_on_return(make):
    rig = make(online=())
    dropped = []
    await rig.emit(ev("ping", n="1"), on_drop=lambda: dropped.append(1))
    assert rig.held() == []  # a short absence only waits
    rig.t = T0 + timedelta(seconds=STALE_S + 1)
    rig.d.pump()
    assert dropped == [1]
    assert [h["why"] for h in rig.held()] == ["stale"]
    rig.bodies.ids.append("desktop")  # the person is back: the held news is on the list, once
    rig.d.pump()
    assert rig.starts == [] and len(rig.items.list_open(kind="held")) == 1


async def test_a_failed_start_holds_the_news_and_never_marks_it_told(make, caplog):
    rig = make()

    def boom(body_id, content):
        raise RuntimeError("cannot start")

    rig.d._start = boom
    told, dropped = [], []
    with caplog.at_level(logging.ERROR, logger="brain.dispatcher"):
        await rig.emit(
            ev("ping"), on_start=lambda: told.append(1), on_drop=lambda: dropped.append(1)
        )
    assert told == [] and dropped == [1] and "cannot start" in caplog.text
    assert [h["why"] for h in rig.held()] == ["start_failed"]
    rig.t = T0 + timedelta(days=1)
    rig.d.pump()  # held: a broken start must not loop


async def test_a_wake_with_no_key_is_held_as_no_key(make):
    from brain.dispatcher import WakeSkipped

    rig = make()

    def skip(body_id, content):
        raise WakeSkipped

    rig.d._start = skip
    dropped = []
    await rig.emit(ev("ping"), on_drop=lambda: dropped.append(1))
    assert dropped == [1] and [h["why"] for h in rig.held()] == ["no_key"]


async def test_a_secret_in_held_facts_is_saved_masked(make):
    guards = spend_guards(Spent(), 25)
    guards.add(Guard("mask", Hook.save, lambda c: rewrite(c.text.replace("sk-abc123", "[secret]"))))
    rig = make(guards=guards)
    await rig.emit(ev("ping", key="j", activity="ran with sk-abc123"))
    assert rig.held()[0]["facts"] == {"activity": "ran with [secret]"}


async def test_posting_the_same_event_and_key_closes_its_held_row(make):
    quiet = [True]
    rig = make(kinds=CAPPED, quiet=lambda now: quiet[0])
    await rig.emit(ev("a", key="job:1", n="1"))
    assert len(rig.held()) == 1
    quiet[0] = False
    await rig.emit(ev("a", key="job:1", n="2"))  # re-emitted: told now, not also held
    assert rig.held() == [] and len(rig.starts) == 1


async def test_a_held_row_for_a_different_key_stays(make):
    quiet = [True]
    rig = make(kinds=CAPPED, quiet=lambda now: quiet[0])
    await rig.emit(ev("a", key="job:1"))
    quiet[0] = False
    await rig.emit(ev("a", key="job:2"))
    assert [h["key"] for h in rig.held()] == ["job:1"]


async def test_drop_closes_the_held_row_of_that_event_and_key(make):
    rig = make(kinds=CAPPED, quiet=lambda now: True)
    await rig.emit(ev("a", key="job:1"))
    rig.d.drop("a", "job:1")
    assert rig.held() == []


async def test_quiet_hours_do_not_hold_a_kind_with_no_hourly_cap(make):
    rig = make(kinds=CAPPED, quiet=lambda now: True)
    await rig.emit(ev("free", n="q"))  # a job's question: it must not fail overnight
    assert len(rig.starts) == 1 and rig.held() == []
    await rig.emit(ev("a"))
    assert [h["event"] for h in rig.held()] == ["a"]


async def test_stop_holds_wake_kinds_only_and_tells_the_session_of_every_item(make):
    rig = make(fail=100)  # the say keeps failing, so it is still waiting at stop
    rig.d.set_speech_state("talking")
    await rig.emit(ev("ping", key="k"))
    rig.d.post(Item("say", "desktop", {"token": "x"}, "now"))
    await settle()
    await rig.d.stop()
    assert [h["event"] for h in rig.held()] == ["ping"]  # a say is not news to keep
    assert sorted(i.kind for i in rig.gave_up) == ["ping", "say"]


async def test_a_post_after_stop_holds_directly_and_starts_nothing(make):
    rig = make()
    await rig.d.stop()
    await rig.emit(ev("ping", key="late"))
    rig.d.post(Item("say", "desktop", {"token": "y"}, "now"))
    await settle()
    assert rig.d._task is None and rig.starts == [] and rig.delivered == []
    assert [(h["event"], h["why"]) for h in rig.held()] == [("ping", "stopped")]
    assert sorted(i.kind for i in rig.gave_up) == ["ping", "say"]  # both told: neither will run


async def test_news_left_at_the_gate_while_talking_goes_stale(make):
    rig = make()
    rig.d.set_speech_state("talking")
    dropped = []
    await rig.emit(ev("ping", n="1"), on_drop=lambda: dropped.append(1))
    rig.t = T0 + timedelta(seconds=STALE_S + 1)
    rig.d.pump()
    assert dropped == [1] and [h["why"] for h in rig.held()] == ["stale"]


async def test_staleness_counts_from_the_post_not_from_when_the_gate_opened(make):
    rig = make(online=())
    rig.d.set_speech_state("talking")
    await rig.emit(ev("ping", n="1"))
    rig.t = T0 + timedelta(seconds=STALE_S - 100)
    rig.d.set_speech_state("idle")  # past the gate, but no body to show it
    await settle()
    assert rig.held() == []
    rig.t = T0 + timedelta(seconds=STALE_S + 1)
    rig.d.pump()
    assert [h["why"] for h in rig.held()] == ["stale"]


async def test_failed_start_still_rearms_the_timer_for_other_groups(make):
    rig = make()

    def boom(body_id, content):
        raise RuntimeError("cannot start")

    rig.d._start = boom
    await rig.emit(ev("slow"))  # waits for its batch
    await rig.emit(ev("ping"))  # starts now and fails
    assert rig.d._timer is not None
    rig.d._timer.cancel()


# ---- one deadline rule, one place for the rules ----

_SRC = Path(__file__).resolve().parent.parent / "src" / "brain"
_WAIT_CONSTANT = re.compile(r"^_?[A-Z_]*(DEADLINE|STALE|TIMEOUT|WAIT)[A-Z_]*\s*(:[^=]*)?=", re.M)


def test_one_deadline_rule_everywhere():
    assert not (_SRC / "scheduler.py").exists()  # the dispatcher is the only front door
    # A person's wait is the open item's deadline, and how long news may wait for a body is
    # the dispatcher's STALE_S; the side-check, guardrails and loop triggers keep no wait of
    # their own.
    modules = [_SRC / "side_check.py", _SRC / "guardrails.py"]
    for path in [*modules, *(_SRC / "loops" / "triggers").glob("*.py")]:
        found = _WAIT_CONSTANT.findall(path.read_text(encoding="utf-8"))
        assert not found, f"{path.name} keeps its own wait: {found}"
    assert "DEADLINE_S" in (_SRC / "open_items.py").read_text(encoding="utf-8")
    assert "STALE_S" in (_SRC / "dispatcher.py").read_text(encoding="utf-8")
