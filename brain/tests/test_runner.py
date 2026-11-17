"""The runner's pick: person events first, news oldest first, one turn per body, and a news
event with no body to tell it waits instead of being dropped. Pure pieces run on fakes.
"""

from datetime import UTC, datetime, timedelta

from brain.bodies import Bodies
from brain.events import Event, EventLog
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


class Rig:
    def __init__(self, online=("desktop", "browser"), display=("desktop",)) -> None:
        self.bodies = FakeBodies(list(online), list(display))
        self.presence = Presence(self.bodies, lambda: T0)
        db = open_db(":memory:")
        self.log = EventLog(db, Masker(lambda: []), lambda: T0)
        self.runner = Runner(self.log, self.presence, self.bodies, None, lambda: T0, None)

    def post(self, kind: str, source: str, id: str) -> EventRow:
        self.log.post(Event(kind, source, {}, id=id))
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
