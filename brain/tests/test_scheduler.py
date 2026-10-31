"""Scheduler queue: body choice, batching, key replacement and the batch timer.
Uses a mutable fake clock and a small custom kinds dict, so no test depends on the real
defaults. Only the timer test sleeps for real.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from brain.bodies import Bodies
from brain.events import Event, EventKind
from brain.guards import Guard, Guards, Hook, stop
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
        self.headless: set[str] = set()

    def online_ids(self) -> list[str]:
        return list(self.ids)

    def display_ids(self) -> list[str]:
        return [i for i in self.ids if i not in self.headless]

    def is_online(self, body_id: str) -> bool:
        return body_id in self.ids


class Rig:
    def __init__(
        self,
        online=("desktop",),
        kinds=KINDS,
        last="desktop",
        now=None,
        budget=None,
        wakes=12,
        guards=None,
    ) -> None:
        self.bodies = FakeBodies(list(online))
        self.starts: list[tuple[str, list]] = []
        self.busy = False
        self.last = last
        self.t = T0
        self.clock = now or (lambda: self.t)
        self.scheduler = Scheduler(
            bodies=self.bodies,
            budget=budget or Open(),
            busy=lambda: self.busy,
            last_body=lambda: self.last,
            start=self._start,
            now=self.clock,
            kinds=kinds,
            notes=NOTES,
            wakes_per_hour=wakes,
            guards=guards,
        )

    def _start(self, body_id: str, content: list) -> str:
        self.starts.append((body_id, content))
        return f"t{len(self.starts)}"

    def text(self, i: int = 0) -> str:
        return self.starts[i][1][0]["text"]


def ev(kind="ping", key=None, **facts) -> Event:
    return Event(kind, facts, key)


def _nothing_wakes_later(rig: Rig) -> None:
    # A day on, a pump still starts nothing: no group is left waiting.
    before = len(rig.starts)
    rig.t = T0 + timedelta(days=1)
    rig.scheduler.pump()
    assert len(rig.starts) == before


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


def test_wake_never_goes_to_a_display_less_body():
    rig = Rig(online=("browser", "desktop"), last="browser")
    rig.bodies.headless = {"browser"}
    rig.scheduler.emit(ev())
    assert [b for b, _ in rig.starts] == ["desktop"]


def test_wake_waits_when_only_display_less_bodies_are_online():
    rig = Rig(online=("browser",), last="browser")
    rig.bodies.headless = {"browser"}
    rig.scheduler.emit(ev())
    assert rig.starts == []
    rig.bodies.ids.append("desktop")
    rig.scheduler.pump()
    assert [b for b, _ in rig.starts] == ["desktop"]


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
    for _ in range(30):  # poll: a fixed sleep is thin against a 1 s batch on Windows
        if rig.starts:
            break
        await asyncio.sleep(0.1)
    assert len(rig.starts) == 1


CAPPED = {
    "a": EventKind("a", batch_seconds=0, max_per_hour=2),
    "b": EventKind("b", batch_seconds=0, max_per_hour=5),
    "free": EventKind("free", batch_seconds=0, max_per_hour=None),
}
CAPPED_NOTES = {k: f"note for {k}" for k in CAPPED}


def capped_rig(**kw) -> Rig:
    rig = Rig(kinds=CAPPED, **kw)
    rig.scheduler._notes = CAPPED_NOTES
    return rig


def test_per_kind_cap_holds_the_next_wake_until_the_window_frees():
    rig = capped_rig()
    for seconds in (0, 60, 120):
        rig.t = T0 + timedelta(seconds=seconds)
        rig.scheduler.emit(ev("a", n=str(seconds)))
    assert len(rig.starts) == 2
    rig.t = T0 + timedelta(seconds=3599)
    rig.scheduler.pump()
    assert len(rig.starts) == 2
    rig.t = T0 + timedelta(seconds=3600)
    rig.scheduler.pump()
    assert len(rig.starts) == 3


def test_held_events_merge_into_one_wake_when_the_cap_frees():
    kinds = {"a": EventKind("a", batch_seconds=30, max_per_hour=1)}
    rig = Rig(kinds=kinds)
    rig.scheduler._notes = {"a": "n"}
    rig.scheduler.emit(ev("a", n="1"))
    rig.t = T0 + timedelta(seconds=30)
    rig.scheduler.pump()
    assert len(rig.starts) == 1
    for i, n in ((100, "3"), (200, "4")):
        rig.t = T0 + timedelta(seconds=i)
        rig.scheduler.emit(ev("a", n=n))
    rig.t = T0 + timedelta(seconds=3700)
    rig.scheduler.pump()
    assert len(rig.starts) == 2
    assert "n: 3" in rig.text(1) and "n: 4" in rig.text(1)


def test_global_cap_counts_every_capped_kind():
    rig = capped_rig(wakes=3)
    for kind in ("a", "b", "a"):
        rig.scheduler.emit(ev(kind))
    assert len(rig.starts) == 3
    rig.scheduler.emit(ev("b"))
    assert len(rig.starts) == 3
    rig.t = T0 + timedelta(seconds=3599)
    rig.scheduler.pump()
    assert len(rig.starts) == 3
    rig.t = T0 + timedelta(seconds=3600)
    rig.scheduler.pump()
    assert len(rig.starts) == 4


def test_exempt_kind_ignores_both_caps_and_is_not_counted():
    rig = capped_rig(wakes=1)
    rig.scheduler.emit(ev("a"))
    rig.scheduler.emit(ev("free"))
    assert len(rig.starts) == 2
    rig.scheduler.emit(ev("free"))
    assert len(rig.starts) == 3
    rig.scheduler.emit(ev("b"))  # global cap of 1 is used by "a" alone
    assert len(rig.starts) == 3


def test_budget_spent_drops_waking_events_and_skips_on_start(caplog):
    rig = Rig(budget=Spent())
    told = []
    with caplog.at_level(logging.WARNING, logger="brain"):
        rig.scheduler.emit(ev("ping"), on_start=lambda: told.append(1))
    assert rig.starts == []
    assert told == []
    assert "ping" in caplog.text
    _nothing_wakes_later(rig)


def test_context_only_events_survive_a_spent_budget():
    rig = Rig(budget=Spent())
    rig.scheduler.emit(ev("focus", title="x"))
    assert rig.scheduler.latest("focus")[""].facts["title"] == "x"


async def test_cap_held_group_arms_a_timer_for_the_cap_wait(monkeypatch):
    rig = capped_rig()
    for seconds in (0, 60, 120):
        rig.t = T0 + timedelta(seconds=seconds)
        rig.scheduler.emit(ev("a"))
    delays = []
    loop = asyncio.get_running_loop()
    monkeypatch.setattr(
        loop, "call_later", lambda d, cb: delays.append(d) or loop.call_soon(lambda: None)
    )
    rig.scheduler.pump()
    assert delays == [3600 - 120]


def failing_rig(**kw) -> Rig:
    rig = Rig(**kw)

    def boom(body_id, content):
        raise RuntimeError("cannot start")

    rig.scheduler._start = boom
    return rig


def test_failed_start_is_logged_not_raised_and_never_marked_told(caplog):
    rig = failing_rig()
    told = []
    with caplog.at_level(logging.ERROR, logger="brain"):
        rig.scheduler.emit(ev("ping"), on_start=lambda: told.append(1))
    assert told == []
    assert "cannot start" in caplog.text
    _nothing_wakes_later(rig)  # dropped: a broken start must not loop


async def test_failed_start_still_rearms_the_timer_for_other_groups():
    rig = failing_rig()
    rig.scheduler.emit(ev("slow"))  # held for its batch
    rig.scheduler.emit(ev("ping"))  # starts now and fails
    assert rig.scheduler._timer is not None
    rig.scheduler._timer.cancel()


def test_on_drop_runs_for_each_dropped_event_when_the_budget_is_spent():
    rig = Rig(budget=Spent())
    dropped = []
    rig.scheduler.emit(ev("ping"), on_drop=lambda: dropped.append("a"))
    rig.scheduler.emit(ev("single"), on_drop=lambda: dropped.append("b"))
    assert rig.starts == []
    assert sorted(dropped) == ["a", "b"]


def test_on_end_runs_when_the_wake_turn_ends():
    rig = Rig()
    ended = []
    rig.scheduler.emit(ev(), on_end=lambda: ended.append(1))
    assert ended == []
    rig.scheduler.turn_ended("other")
    assert ended == []
    rig.scheduler.turn_ended("t1")  # the id start returned
    assert ended == [1]
    rig.scheduler.turn_ended("t1")
    assert ended == [1]


def test_on_end_does_not_run_for_a_replaced_event():
    rig = Rig()
    rig.busy = True
    ended = []
    rig.scheduler.emit(ev("ping", key="k"), on_end=lambda: ended.append("old"))
    rig.scheduler.emit(ev("ping", key="k"), on_end=lambda: ended.append("new"))
    rig.busy = False
    rig.scheduler.pump()
    rig.scheduler.turn_ended("t1")
    assert ended == ["new"]


def test_key_replaces_a_held_event_of_a_never_merged_kind():
    rig = Rig()
    rig.busy = True
    ran = []
    rig.scheduler.emit(ev("single", key="k", a="old"), on_start=lambda: ran.append("old"))
    rig.scheduler.emit(ev("single", key="k", a="new"), on_start=lambda: ran.append("new"))
    rig.scheduler.emit(ev("single", key="other", a="third"))
    rig.busy = False
    rig.scheduler.pump()
    assert "a: new" in rig.text(0) and "old" not in rig.text(0)
    rig.scheduler.turn_ended("t1")
    assert "third" in rig.text(1)
    assert ran == ["new"]


def test_job_question_wakes_twice_even_with_the_hourly_cap_used_up():
    from brain.events import EVENT_KINDS

    rig = Rig(kinds=EVENT_KINDS, wakes=1)
    rig.scheduler._notes = {k: "n" for k in EVENT_KINDS}
    rig.scheduler.emit(ev("timer"))  # uses the one capped wake
    rig.scheduler.turn_ended("t1")
    rig.scheduler.emit(ev("job_question", a="one"))
    rig.scheduler.turn_ended("t2")
    rig.scheduler.emit(ev("job_question", a="two"))
    assert len(rig.starts) == 3
    assert "one" in rig.text(1) and "two" in rig.text(2)


def test_failed_start_runs_on_drop_once_per_event():
    rig = failing_rig()
    dropped = []
    rig.scheduler.emit(
        ev("ping"), on_drop=lambda: dropped.append(1), on_end=lambda: dropped.append("end")
    )
    assert dropped == [1]


def test_a_raising_hook_does_not_stop_the_other_hooks_or_the_pump(caplog):
    rig = Rig()
    rig.busy = True
    ran = []

    def boom():
        raise RuntimeError("hook broke")

    rig.scheduler.emit(ev("single", a="1"), on_start=boom)
    rig.scheduler.emit(ev("single", a="2"), on_start=lambda: ran.append("second"))
    rig.busy = False
    with caplog.at_level(logging.ERROR, logger="brain"):
        rig.scheduler.pump()
        rig.scheduler.turn_ended("t1")
    assert len(rig.starts) == 2 and ran == ["second"]
    assert "hook broke" in caplog.text

    rig2 = Rig()
    ends = []
    rig2.scheduler.emit(ev("slow", a="1"), on_end=boom)
    rig2.scheduler.emit(ev("slow", a="2"), on_end=lambda: ends.append("b"))
    rig2.t = T0 + timedelta(seconds=30)
    rig2.scheduler.pump()
    rig2.scheduler.emit(ev("ping"))
    rig2.busy = True
    rig2.scheduler.turn_ended("t1")  # boom must not stop "b"
    assert ends == ["b"]


def test_pump_drops_events_when_the_emit_guard_stops_with_over_budget():
    guards = Guards()
    guards.add(Guard("test", Hook.emit, lambda ctx: stop("no", "over_budget")))
    rig = Rig(guards=guards)
    rig.scheduler.emit(ev("ping"))
    assert rig.starts == []
    _nothing_wakes_later(rig)


def test_pump_keeps_events_when_the_emit_guard_stops_with_another_code():
    guards = Guards()
    guards.add(Guard("test", Hook.emit, lambda ctx: stop("no", "other")))
    rig = Rig(guards=guards)
    rig.scheduler.emit(ev("ping"))
    assert len(rig.starts) == 1
