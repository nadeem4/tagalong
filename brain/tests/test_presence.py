"""Presence: which body the person is using and what Scout's speech is doing. A pure record
(no queue, no turns), so the runner can read it. A fake clock stands in for every wait.
"""

from datetime import UTC, datetime, timedelta

from brain.bodies import Bodies
from brain.presence import Presence

T0 = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)


class FakeBodies(Bodies):
    def __init__(self, online: list[str]) -> None:
        super().__init__()
        self.ids = online

    def is_online(self, body_id: str) -> bool:
        return body_id in self.ids


class Rig:
    def __init__(self, online=("desktop", "phone")) -> None:
        self.t = T0
        self.bodies = FakeBodies(list(online))
        self.pokes = 0
        self.p = Presence(self.bodies, lambda: self.t)
        self.p.on_change = self._poke

    def _poke(self) -> None:
        self.pokes += 1

    def later(self, seconds: float = 1) -> None:
        self.t += timedelta(seconds=seconds)


def test_talking_follows_the_desktop_then_the_mouth():
    rig = Rig()
    assert not rig.p.talking()
    rig.p.mouth("talking")
    assert rig.p.talking()
    rig.p.speech("desktop", "idle")  # a body that reports is the truth; idle ends its claim
    assert rig.p.talking()  # the mouth speaks again
    rig.p.speech("desktop", "talking")
    rig.p.mouth("idle")  # the brain's synth ran ahead of the speaker
    assert rig.p.talking()
    rig.p.speech("desktop", "idle")
    assert not rig.p.talking()


def test_a_body_leaving_hands_the_source_back_to_the_mouth():
    rig = Rig()
    rig.p.speech("desktop", "talking")
    rig.p.speech("browser", "talking")
    rig.p.speech_gone("browser")
    assert rig.p.talking()  # the desktop still plays
    rig.p.speech_gone("desktop")
    assert not rig.p.talking()


def test_using_now_is_the_last_touched_online_body():
    rig = Rig()
    assert rig.p.using_now() is None
    rig.p.touch("desktop")
    rig.later()
    rig.p.touch("phone")
    assert rig.p.using_now() == "phone"
    rig.later()
    rig.p.touch("desktop")
    assert rig.p.using_now() == "desktop"


def test_using_now_skips_an_offline_body():
    rig = Rig()
    rig.p.touch("desktop")
    rig.later()
    rig.p.touch("phone")
    rig.bodies.ids = ["desktop"]
    assert rig.p.using_now() == "desktop"
    rig.bodies.ids = []
    assert rig.p.using_now() is None


def test_a_speech_change_pokes():
    rig = Rig()
    rig.p.speech("desktop", "talking")
    rig.p.mouth("talking")
    rig.p.speech_gone("desktop")
    assert rig.pokes == 3


def test_heard_is_the_turn_and_sentences_of_the_last_break():
    rig = Rig()
    assert rig.p.heard("desktop") == ("", 0)
    rig.p.speech("desktop", "sentence_break", turn="t1", n=2)
    assert rig.p.heard("desktop") == ("t1", 2)
    rig.p.speech("desktop", "talking")  # a plain state keeps what was heard
    assert rig.p.heard("desktop") == ("t1", 2)
    assert rig.p.heard("phone") == ("", 0)


def test_a_sentence_break_is_latched_until_it_is_taken():
    rig = Rig()
    assert not rig.p.break_seen()
    rig.p.speech("desktop", "sentence_break")
    rig.p.speech("desktop", "talking")  # two frames, no look between: the break still counts
    assert rig.p.break_seen()
    assert not rig.p.break_seen()  # spent by the take


def test_latest_keeps_the_newest_fact_of_a_kind_per_source():
    rig = Rig()
    assert rig.p.latest("focus") == {}
    rig.p.record("focus", "desktop", {"title": "a"})
    rig.p.record("focus", "browser", {"title": "b"})
    rig.p.record("focus", "desktop", {"title": "c"})
    assert rig.p.latest("focus") == {"desktop": {"title": "c"}, "browser": {"title": "b"}}
    assert rig.p.latest("tab") == {}


def test_at_break_follows_the_body_playing_now():
    rig = Rig()
    rig.p.mouth("sentence_break")
    assert rig.p.at_break()
    rig.p.speech("desktop", "talking")  # a reporting body overrides the mouth
    assert not rig.p.at_break()
    rig.p.speech("desktop", "sentence_break", "t1", 1)
    assert rig.p.at_break()


def test_talking_while_any_body_talks():
    rig = Rig()
    rig.p.speech("a", "talking")
    rig.p.speech("b", "talking")
    rig.p.speech("a", "idle")
    assert rig.p.talking()  # b still plays
    rig.p.speech("b", "idle")
    assert not rig.p.talking()


def test_at_break_needs_every_reporter_at_a_break():
    rig = Rig()
    rig.p.speech("a", "sentence_break", "t1", 1)
    rig.p.speech("b", "talking")
    assert not rig.p.at_break()
    rig.p.speech("b", "sentence_break", "t1", 1)
    assert rig.p.at_break()
    rig.p.speech("a", "talking")  # b alone at a break does not release a
    rig.p.speech("b", "sentence_break", "t1", 2)
    assert not rig.p.at_break()


def test_a_body_that_leaves_no_longer_holds_the_break():
    rig = Rig()
    rig.p.speech("a", "sentence_break", "t1", 1)
    rig.p.speech("b", "talking")
    rig.p.speech_gone("b")
    assert rig.p.at_break()
