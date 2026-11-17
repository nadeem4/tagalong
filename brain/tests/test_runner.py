"""The runner's pick: person events first, news oldest first, one turn per body, and a news
event with no body to tell it waits instead of being dropped. Pure pieces run on fakes.
"""

from datetime import UTC, datetime, timedelta

from brain.bodies import Bodies
from brain.builtin_guards import daily_budget_on_emit, wake_caps
from brain.events import Event, EventLog
from brain.guards import Guards
from brain.masking import Masker
from brain.presence import Presence
from brain.runner import GROUP_CAP, Runner, pick
from brain.store.db import open_db, utc_text
from brain.store.events import EventRow

T0 = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)


def row(id: str, kind: str = "timer", at: int = 0, source: str = "timer:1") -> EventRow:
    return EventRow(id=id, kind=kind, at=utc_text(T0 + timedelta(seconds=at)), source=source)


def always(_r: EventRow) -> bool:
    return True


def to(body: str):
    return lambda _r: body


def test_person_events_go_before_older_news():
    got = pick([row("n", at=0), row("s", "say", at=5, source="desktop")], to("desktop"), always)
    assert got is not None
    assert [e.id for e in got.events] == ["s", "n"]


def test_news_is_told_oldest_first():
    ready = [row("b", at=9), row("a", at=1), row("c", at=4)]
    got = pick(ready, to("desktop"), always)
    assert got is not None
    assert [e.id for e in got.events] == ["a", "c", "b"]


def test_one_turn_groups_ready_events_for_one_body_up_to_20():
    ready = [row(f"n{i:02}", at=i) for i in range(GROUP_CAP + 5)]
    got = pick(ready, to("desktop"), always)
    assert got is not None
    assert got.body == "desktop"
    assert [e.id for e in got.events] == [f"n{i:02}" for i in range(GROUP_CAP)]


def test_a_say_from_x_is_not_grouped_into_ys_turn():
    ready = [row("sx", "say", at=0, source="x"), row("sy", "say", at=1, source="y")]
    got = pick(ready, lambda r: r.source, always)
    assert got is not None
    assert (got.body, [e.id for e in got.events]) == ("x", ["sx"])


def test_a_closed_gate_skips_the_event_and_never_rides_along():
    ready = [row("closed", at=0), row("open", at=1)]
    got = pick(ready, to("desktop"), lambda r: r.id != "closed")
    assert got is not None
    assert [e.id for e in got.events] == ["open"]


def test_nothing_ready_picks_nothing():
    assert pick([], to("desktop"), always) is None


class FakeBodies(Bodies):
    def __init__(self, online: list[str], display: list[str]) -> None:
        super().__init__()
        self.online = online
        self.display = display

    def is_online(self, body_id: str) -> bool:
        return body_id in self.online

    def display_ids(self) -> list[str]:
        return [b for b in self.online if b in self.display]


class Budget:
    def __init__(self) -> None:
        self.open = True

    def allows(self) -> bool:
        return self.open


class Rig:
    def __init__(self, online=("desktop", "browser"), display=("desktop",), quiet=None) -> None:
        self.t = T0  # the rig's clock; tests move it
        self.budget = Budget()
        guards = Guards()
        guards.add(daily_budget_on_emit(self.budget))
        guards.add(wake_caps(100))
        self.bodies = FakeBodies(list(online), list(display))
        self.presence = Presence(self.bodies, lambda: self.t)
        db = open_db(":memory:")
        self.log = EventLog(db, Masker(lambda: []), lambda: self.t)
        self.runner = Runner(
            self.log, self.presence, self.bodies, None, lambda: self.t, guards, quiet
        )

    def post(self, kind: str, source: str, id: str, at: int | None = None) -> EventRow:
        when = None if at is None else T0 + timedelta(seconds=at)
        self.log.post(Event(kind, source, {}, id=id, at=when))
        row = self.log.get(id)
        assert row is not None
        return row


def test_headless_say_answers_on_the_body_in_use():
    rig = Rig()
    rig.presence.touch("desktop")
    say = rig.post("say", "browser", "s1")  # the browser shows nothing
    got = pick([say], rig.runner.target, always)
    assert got is not None
    assert got.body == "desktop"


def test_a_say_from_a_displaying_body_answers_there():
    rig = Rig(display=("desktop", "browser"))
    rig.presence.touch("desktop")
    say = rig.post("say", "browser", "s1")
    assert rig.runner.target(say) == "browser"


def test_news_goes_to_the_body_in_use():
    rig = Rig()
    rig.presence.touch("desktop")
    assert rig.runner.target(rig.post("timer", "timer:1", "n1")) == "desktop"


def test_news_falls_back_to_the_body_that_caused_it():
    rig = Rig()
    say = rig.post("say", "desktop", "s1")
    rig.log.post(Event("job_ended", "job:1", {}, caused_by=say.id, id="n1"))
    news = rig.log.get("n1")
    assert news is not None
    assert rig.runner.target(news) == "desktop"


def test_news_with_no_target_is_skipped_not_dropped():
    rig = Rig(online=(), display=())
    news = rig.post("timer", "timer:1", "n1")
    assert pick(rig.log.ready(), rig.runner.target, always) is None
    kept = rig.log.get(news.id)
    assert kept is not None
    assert (kept.state, kept.attempts) == ("new", 0)


def test_a_say_from_a_displayless_body_goes_to_a_displaying_one():
    rig = Rig(online=("browser", "desktop"), display=("desktop",))
    rig.presence.touch("browser")  # the browser is in use but shows nothing
    say = rig.post("say", "browser", "s1")
    assert rig.runner.target(say) == "desktop"


def test_news_skips_a_displayless_body_in_use():
    rig = Rig(online=("browser", "desktop"), display=("desktop",))
    rig.presence.touch("browser")
    assert rig.runner.target(rig.post("timer", "timer:1", "n1")) == "desktop"


def test_equal_times_keep_arrival_order():
    ready = [row("first", at=3), row("second", at=3), row("third", at=3)]
    got = pick(ready, to("desktop"), always)
    assert got is not None
    assert [e.id for e in got.events] == ["first", "second", "third"]


def test_idle_news_waits_10s_after_a_say():
    rig = Rig()
    say = rig.post("say", "desktop", "s1")
    news = rig.post("job_quiet", "job:1", "n1")  # idle, no batching
    assert rig.runner.gate(news)
    rig.runner.record_take([say])
    assert not rig.runner.gate(news)
    rig.t = T0 + timedelta(seconds=10)
    assert rig.runner.gate(news)


def test_next_pause_news_waits_while_any_speech_is_on():
    rig = Rig()
    news = rig.post("timer", "timer:1", "n1")  # next_pause
    rig.presence.speech("desktop", "talking")
    assert not rig.runner.gate(news)
    rig.presence.speech("desktop", "idle")
    assert rig.runner.gate(news)


def test_idle_news_waits_while_speech_is_on():
    rig = Rig()
    news = rig.post("job_quiet", "job:1", "n1")
    rig.presence.speech("desktop", "talking")
    assert not rig.runner.gate(news)


def test_quiet_hours_hold_news_but_not_says():
    rig = Rig(quiet=lambda _at: True)
    assert not rig.runner.gate(rig.post("timer", "timer:1", "n1"))
    assert rig.runner.gate(rig.post("say", "desktop", "s1"))
    assert rig.runner.gate(rig.post("card_answer", "desktop", "c1"))
    # a kind with no hourly cap (an expert's question) is never held for quiet hours
    assert rig.runner.gate(rig.post("job_question", "job:1", "q1"))


def test_a_spent_budget_holds_news_but_not_says():
    rig = Rig()
    rig.budget.open = False
    assert not rig.runner.gate(rig.post("timer", "timer:1", "n1"))
    assert rig.runner.gate(rig.post("say", "desktop", "s1"))


def test_a_capped_kind_waits_and_is_not_dropped():
    rig = Rig()
    news = rig.post("timer", "timer:1", "n1")  # 6 an hour
    for i in range(6):
        rig.runner.record_take([rig.post("timer", f"timer:{i}", f"t{i}")])
    assert not rig.runner.gate(news)
    kept = rig.log.get("n1")
    assert kept is not None
    assert (kept.state, kept.attempts) == ("new", 0)
    rig.t = T0 + timedelta(hours=1, seconds=1)
    assert rig.runner.gate(news)


def test_batch_seconds_delays_only_the_oldest_of_a_kind():
    rig = Rig()
    first = rig.post("job_ended", "job:1", "a", at=0)  # batches 30 s
    second = rig.post("job_ended", "job:2", "b", at=20)
    rig.t = T0 + timedelta(seconds=25)
    assert not rig.runner.gate(first)
    assert not rig.runner.gate(second)
    rig.t = T0 + timedelta(seconds=31)  # the oldest has waited 30 s; the newer rides with it
    assert rig.runner.gate(first)
    assert rig.runner.gate(second)


def test_a_closed_gate_does_not_use_up_the_cap():
    rig = Rig()
    for i in range(5):
        rig.runner.record_take([rig.post("timer", f"timer:{i}", f"t{i}")])
    news = rig.post("timer", "timer:9", "n1")
    for _ in range(10):  # checking is free: the wake is recorded only when a take succeeds
        assert rig.runner.gate(news)
    rig.runner.record_take([news])
    assert not rig.runner.gate(rig.post("timer", "timer:10", "n2"))


def test_a_turn_with_many_events_of_a_kind_is_one_wake():
    rig = Rig()
    rig.runner.record_take([rig.post("timer", f"timer:{i}", f"t{i}") for i in range(3)])
    for i in range(2):
        rig.runner.record_take([rig.post("timer", f"timer:x{i}", f"x{i}")])
    assert rig.runner.gate(rig.post("timer", "timer:9", "n1"))  # 3 wakes, not 5, cap is 6
