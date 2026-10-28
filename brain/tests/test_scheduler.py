"""Scheduler queue: body choice, batching, key replacement and the batch timer.
Uses a mutable fake clock and a small custom kinds dict, so no test depends on the real
defaults. Only the timer test sleeps for real.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from brain.bodies import Bodies
from brain.events import Event, EventKind
from brain.scheduler import Scheduler

T0 = datetime(2026, 10, 28, 12, 0, tzinfo=UTC)

KINDS = {
    "ping": EventKind("ping", batch_seconds=0),
    "pong": EventKind("pong", batch_seconds=0),
    "slow": EventKind("slow", batch_seconds=30),
    "single": EventKind("single", batch_seconds=None),
    "focus": EventKind("focus", wakes=False),
    "off": EventKind("off", enabled=False),
}
NOTES = {k: f"note for {k}" for k in KINDS}


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

    def online_ids(self) -> list[str]:
        return list(self.ids)

    def is_online(self, body_id: str) -> bool:
        return body_id in self.ids


class Rig:
    def __init__(self, online=("desktop",), kinds=KINDS, last="desktop", now=None) -> None:
        self.bodies = FakeBodies(list(online))
        self.starts: list[tuple[str, list]] = []
        self.busy = False
        self.last = last
        self.t = T0
        self.clock = now or (lambda: self.t)
        self.scheduler = Scheduler(
            bodies=self.bodies,
            budget=Open(),
            busy=lambda: self.busy,
            last_body=lambda: self.last,
            start=self._start,
            now=self.clock,
            kinds=kinds,
            notes=NOTES,
        )

    def _start(self, body_id: str, content: list) -> str:
        self.starts.append((body_id, content))
        return f"t{len(self.starts)}"

    def text(self, i: int = 0) -> str:
        return self.starts[i][1][0]["text"]


def ev(kind="ping", key=None, **facts) -> Event:
    return Event(kind, facts, key)


def test_emit_starts_a_wake_on_the_last_body_when_idle():
    rig = Rig(online=("desktop", "extension"))
    rig.scheduler.emit(ev(a="1"))
    assert len(rig.starts) == 1
    body, content = rig.starts[0]
    assert body == "desktop"
    assert content[0]["type"] == "text"
    assert content[0]["text"].startswith('<data kind="event">')


def test_falls_back_to_any_online_body_when_the_last_is_offline():
    rig = Rig(online=("extension",), last="desktop")
    rig.scheduler.emit(ev())
    assert [b for b, _ in rig.starts] == ["extension"]


def test_no_body_online_waits_and_connect_runs_it():
    rig = Rig(online=())
    rig.scheduler.emit(ev())
    assert rig.starts == []
    rig.bodies.ids.append("desktop")
    rig.scheduler.pump()
    assert len(rig.starts) == 1


def test_busy_blocks_and_turn_ended_runs_the_next():
    rig = Rig()
    rig.busy = True
    rig.scheduler.emit(ev())
    assert rig.starts == []
    rig.busy = False
    rig.scheduler.turn_ended("t")
    assert len(rig.starts) == 1


def test_two_events_of_different_kinds_run_as_separate_turns_in_order():
    rig = Rig()
    rig.busy = True
    rig.scheduler.emit(ev("ping"))
    rig.scheduler.emit(ev("pong"))
    rig.busy = False
    rig.scheduler.pump()
    assert len(rig.starts) == 1 and "Event: ping" in rig.text(0)
    rig.scheduler.turn_ended("t1")
    assert len(rig.starts) == 2 and "Event: pong" in rig.text(1)


def test_events_within_the_batch_window_merge_into_one_wake():
    rig = Rig()
    rig.scheduler.emit(ev("slow", a="first"))
    rig.t = T0 + timedelta(seconds=10)
    rig.scheduler.emit(ev("slow", a="second"))
    assert rig.starts == []
    rig.t = T0 + timedelta(seconds=30)
    rig.scheduler.pump()
    assert len(rig.starts) == 1
    assert "first" in rig.text() and "second" in rig.text()


def test_next_due_reports_the_remaining_batch_time():
    rig = Rig()
    assert rig.scheduler.next_due() is None
    rig.scheduler.emit(ev("slow"))
    rig.t = T0 + timedelta(seconds=10)
    assert rig.scheduler.next_due() == 20.0


def test_events_arriving_while_blocked_join_the_waiting_group():
    rig = Rig()
    rig.busy = True
    rig.scheduler.emit(ev("ping", a="one"))
    rig.t = T0 + timedelta(seconds=100)
    rig.scheduler.emit(ev("ping", a="two"))
    rig.busy = False
    rig.scheduler.pump()
    assert len(rig.starts) == 1
    assert "one" in rig.text() and "two" in rig.text()


def test_same_key_replaces_a_held_event_and_drops_its_on_start():
    rig = Rig()
    rig.busy = True
    ran: list[str] = []
    rig.scheduler.emit(ev("ping", key="k", fact="old"), on_start=lambda: ran.append("old"))
    rig.scheduler.emit(ev("ping", key="k", fact="new"), on_start=lambda: ran.append("new"))
    rig.busy = False
    rig.scheduler.pump()
    assert "fact: new" in rig.text() and "fact: old" not in rig.text()
    assert ran == ["new"]


def test_batch_seconds_none_never_merges():
    rig = Rig()
    rig.busy = True
    rig.scheduler.emit(ev("single", a="one"))
    rig.scheduler.emit(ev("single", a="two"))
    rig.busy = False
    rig.scheduler.pump()
    assert len(rig.starts) == 1 and "one" in rig.text(0) and "two" not in rig.text(0)
    rig.scheduler.turn_ended("t1")
    assert len(rig.starts) == 2 and "two" in rig.text(1)


def test_on_start_runs_after_the_turn_starts():
    rig = Rig()
    seen: list[int] = []
    rig.scheduler.emit(ev(), on_start=lambda: seen.append(len(rig.starts)))
    assert seen == [1]


def test_unknown_and_disabled_kinds_are_dropped_and_logged(caplog):
    rig = Rig()
    with caplog.at_level(logging.WARNING, logger="brain"):
        rig.scheduler.emit(ev("nope"))
        rig.scheduler.emit(ev("off"))
    assert rig.starts == []
    assert len(caplog.records) == 2


def test_context_only_kind_updates_latest_and_never_wakes():
    rig = Rig()
    rig.scheduler.emit(ev("focus", key="a", title="old"))
    rig.scheduler.emit(ev("focus", key="a", title="new"))
    rig.scheduler.emit(ev("focus", key="b", title="other"))
    rig.scheduler.emit(ev("focus", title="nokey"))
    assert rig.starts == []
    latest = rig.scheduler.latest("focus")
    assert latest["a"].facts["title"] == "new"
    assert latest["b"].facts["title"] == "other"
    assert latest[""].facts["title"] == "nokey"
    assert rig.scheduler.latest("ping") == {}


async def test_pump_arms_a_timer_for_the_batch():
    kinds = {"quick": EventKind("quick", batch_seconds=1)}
    rig = Rig(kinds=kinds, now=lambda: datetime.now(UTC))
    rig.scheduler._notes = {"quick": "n"}
    rig.scheduler.emit(ev("quick"))
    assert rig.starts == []
    assert rig.scheduler._timer is not None
    await asyncio.sleep(1.1)
    assert len(rig.starts) == 1
