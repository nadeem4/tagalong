"""The runner: person events first, news oldest first, one turn per body, and news with no
body to tell it waits instead of being dropped. Its loop starts every turn, one at a time, lets
a say join at a step, tells next-pause news at a sentence break, and returns a turn's events
when it errors or the brain stops. Pure pieces and the loop run on fakes.
"""

import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone

from brain.bodies import Bodies
from brain.builtin_guards import daily_budget_on_emit, wake_caps
from brain.events import EVENT_KINDS, Event, EventKind, EventLog
from brain.guards import Guards
from brain.masking import Masker
from brain.presence import Presence
from brain.runner import GROUP_CAP, Runner, pick, wake_text
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
        return sorted((b for b in self.online if b in self.display), key=self.is_phone)

    def is_phone(self, body_id: str | None) -> bool:
        return body_id == "whatsapp"


class Budget:
    def __init__(self) -> None:
        self.open = True

    def allows(self) -> bool:
        return self.open


class FakeSession:
    """The runner's view of the session: it starts a turn, cancels it and interjects."""

    def __init__(self, tells: bool = False) -> None:
        self.started: list[tuple[str, str, list[str]]] = []
        self.retried: list[set[str]] = []  # per started turn: the events tried before
        self.cancelled = 0
        self.tells = tells
        self.told: list[str] = []
        self.key = True
        self.fails = False

    def ready(self) -> bool:
        return self.key

    def start_events(self, turn_id: str, body: str, rows: list[EventRow], retry: set[str]) -> None:
        self.started.append((turn_id, body, [r.id for r in rows]))
        self.retried.append(retry)
        if self.fails:
            raise RuntimeError("could not start")

    def cancel_turn(self) -> None:
        self.cancelled += 1

    async def interject(self, body: str, content: list) -> bool:
        self.told.append(content[0]["text"])
        return self.tells


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
        self.session = FakeSession()
        self.runner = Runner(
            self.log, self.presence, self.bodies, self.session, lambda: self.t, guards, quiet
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


def test_news_skips_the_phone_in_use_while_a_screen_is_online():
    rig = Rig(online=("whatsapp", "desktop"), display=("whatsapp", "desktop"))
    rig.presence.touch("whatsapp")
    assert rig.runner.target(rig.post("timer", "timer:1", "n1")) == "desktop"


def test_a_headless_say_skips_the_phone_in_use_while_a_screen_is_online():
    rig = Rig(online=("whatsapp", "desktop", "browser"), display=("whatsapp", "desktop"))
    rig.presence.touch("whatsapp")
    assert rig.runner.target(rig.post("say", "browser", "s1")) == "desktop"


def test_a_say_from_the_phone_answers_on_the_phone():
    rig = Rig(online=("whatsapp", "desktop"), display=("whatsapp", "desktop"))
    assert rig.runner.target(rig.post("say", "whatsapp", "s1")) == "whatsapp"


def test_news_the_phone_reported_goes_back_to_the_phone():
    rig = Rig(online=("whatsapp", "desktop"), display=("whatsapp", "desktop"))
    rig.presence.touch("desktop")
    assert rig.runner.target(rig.post("ask_closed", "whatsapp", "n1")) == "whatsapp"


def test_news_goes_to_the_phone_when_it_is_the_only_place():
    rig = Rig(online=("whatsapp",), display=("whatsapp",))
    assert rig.runner.target(rig.post("timer", "timer:1", "n1")) == "whatsapp"


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


def test_news_waits_for_a_key_but_says_do_not():
    rig = Rig()
    rig.session.key = False
    rig.presence.touch("desktop")
    assert not rig.runner.gate(rig.post("timer", "timer:t1", "n1"))
    assert rig.runner.gate(rig.post("say", "desktop", "s1"))


def test_a_hold_kind_is_never_told():
    rig = Rig()
    rig.runner._kinds = {**EVENT_KINDS, "parked": EventKind("parked", urgency="hold")}
    row = replace(rig.post("timer", "timer:t1", "p1"), kind="parked")
    assert not rig.runner.gate(row)


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


class LoopRig(Rig):
    """A Rig whose runner has a fake session and records the frames it sends."""

    def __init__(self, tells: bool = False, **kw) -> None:
        super().__init__(**kw)
        self.session.tells = tells
        self.sent: list[tuple[str, dict]] = []
        self.bodies.notify = lambda m, p: self.sent.append((m, p))

    def say(self, id: str, body: str = "desktop") -> None:
        self.log.post(Event("say", body, {"text": id}, id=id))
        self.runner.poke()

    def news(self, id: str, **payload) -> None:
        self.log.post(Event("timer", f"timer:{id}", payload, id=id))
        self.runner.poke()

    def turns(self) -> list[list[str]]:
        return [ids for _, _, ids in self.session.started]


async def ticks() -> None:
    for _ in range(10):
        await asyncio.sleep(0)


async def test_only_one_turn_runs_while_events_keep_arriving():
    rig = LoopRig(display=("desktop", "browser"))
    rig.say("s1")
    await ticks()
    rig.say("s2", body="browser")
    rig.news("n1")
    await ticks()
    assert rig.turns() == [["s1"]]
    await rig.runner.stop()


async def test_a_say_arriving_mid_turn_joins_at_the_next_step():
    rig = LoopRig()
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.say("s2")
    await ticks()
    assert rig.turns() == [["s1"]]
    assert [r.id for r in rig.runner.take_more()] == ["s2"]
    joined = [p for m, p in rig.sent if m == "turn" and p["state"] == "joined"]
    assert joined == [
        {"turn": turn, "body": "desktop", "state": "joined", "events": ["s2"], "source": "desktop"}
    ]
    s2 = rig.log.get("s2")
    assert s2 is not None and (s2.state, s2.turn_id) == ("taken", turn)
    assert rig.runner.take_more() == []  # taken once
    rig.runner.turn_ended(turn, "done")
    s2 = rig.log.get("s2")
    assert s2 is not None and s2.state == "handled"  # a joined say ends with its turn
    await rig.runner.stop()


async def test_a_say_from_another_body_does_not_join():
    rig = LoopRig(display=("desktop", "browser"))
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.say("s2", body="browser")
    assert rig.runner.take_more() == []
    rig.runner.turn_ended(turn, "done")
    await ticks()
    assert [(b, ids) for _, b, ids in rig.session.started[1:]] == [("browser", ["s2"])]
    await rig.runner.stop()


async def test_a_turn_end_picks_the_next_event():
    rig = LoopRig()
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.news("n1")
    await ticks()
    rig.runner.turn_ended(turn, "done")
    await ticks()
    s1 = rig.log.get("s1")
    assert s1 is not None and s1.state == "handled"
    assert rig.turns() == [["s1"], ["n1"]]
    await rig.runner.stop()


async def test_a_cancelled_turn_marks_its_events_handled():
    rig = LoopRig()
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.runner.turn_ended(turn, "cancelled")
    s1 = rig.log.get("s1")
    assert s1 is not None and s1.state == "handled"
    await rig.runner.stop()


async def test_an_errored_turn_returns_its_events_to_new_without_an_attempt():
    rig = LoopRig()
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.runner.turn_ended(turn, "error")
    await ticks()
    s1 = rig.log.get("s1")
    assert s1 is not None and (s1.state, s1.attempts, s1.turn_id) == ("new", 0, None)
    assert len(rig.session.started) == 1  # not run again at once: a failing model would spin
    rig.say("s2")  # something new happened: the waiting say rides with it
    await ticks()
    assert rig.turns()[1:] == [["s1", "s2"]]
    await rig.runner.stop()


async def test_a_turn_the_api_rejected_handles_its_events():
    # The same request would be rejected again, so its events are not put back.
    rig = LoopRig()
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.runner.turn_ended(turn, "rejected")
    await ticks()
    s1 = rig.log.get("s1")
    assert s1 is not None and (s1.state, s1.end_reason) == ("handled", "rejected")
    await rig.runner.stop()


async def test_a_turn_over_budget_handles_its_say_so_it_is_not_answered_again():
    rig = LoopRig()
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.runner.turn_ended(turn, "over_budget")  # the person was told the budget is spent
    s1 = rig.log.get("s1")
    assert s1 is not None and (s1.state, s1.end_reason) == ("handled", "over_budget")
    rig.say("s2")
    await ticks()
    assert rig.turns() == [["s1"], ["s2"]]  # s1 does not ride along
    await rig.runner.stop()


async def test_an_errored_turns_events_are_named_as_retried_to_the_next_turn():
    rig = LoopRig()
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.runner.turn_ended(turn, "error")
    rig.say("s2")
    await ticks()
    assert rig.turns()[1:] == [["s1", "s2"]]
    assert rig.session.retried == [set(), {"s1"}]  # s1's words are already in the history
    await rig.runner.stop()


async def test_a_held_question_is_tried_again_after_the_recheck_with_nothing_new(monkeypatch):
    # An expert waits on its question: an error must not leave it waiting for good.
    monkeypatch.setattr("brain.runner.RECHECK_S", 0.2)
    rig = LoopRig()
    rig.log.post(Event("job_question", "job:j1", {}, id="q1"))
    rig.runner.poke()
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.runner.turn_ended(turn, "error")
    await ticks()
    assert rig.turns() == [["q1"]]  # not again at once: a failing model would spin
    await asyncio.sleep(0.4)
    await ticks()
    assert rig.turns() == [["q1"], ["q1"]]
    assert rig.session.retried[1] == {"q1"}
    await rig.runner.stop()


async def test_a_retried_event_that_ends_another_way_is_forgotten():
    rig = LoopRig()
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.runner.turn_ended(turn, "error")
    rig.log.finish(["s1"], "handled")  # ended outside a turn, e.g. by id
    rig.runner.poke()
    await ticks()
    assert "s1" not in rig.runner._retried and "s1" not in rig.runner._held
    await rig.runner.stop()


async def test_a_say_saved_after_the_last_step_gets_the_next_turn():
    rig = LoopRig()
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    assert rig.runner.take_more() == []  # the turn's final step found nothing
    rig.say("s2")  # saved before the turn ends
    await ticks()
    rig.runner.turn_ended(turn, "done")
    s2 = rig.log.get("s2")
    assert s2 is not None and s2.state != "handled"
    await ticks()
    assert rig.turns() == [["s1"], ["s2"]]
    await rig.runner.stop()


async def test_stop_returns_the_running_turns_events_to_new():
    rig = LoopRig()
    ends: list[str] = []
    rig.log.post(Event("say", "desktop", {}, id="s1"), on_end=ends.append)
    rig.runner.poke()
    await ticks()
    [(turn, _, _)] = rig.session.started
    await rig.runner.stop()
    s1 = rig.log.get("s1")
    assert s1 is not None and (s1.state, s1.attempts) == ("new", 0)
    assert ends == ["new"] and rig.session.cancelled == 1
    rig.runner.turn_ended(turn, "cancelled")  # the cancel the stop caused changes nothing
    s1 = rig.log.get("s1")
    assert s1 is not None and s1.state == "new"
    rig.runner.poke()
    await ticks()
    assert len(rig.session.started) == 1  # a stopped runner starts nothing


async def test_a_turn_that_cannot_start_puts_its_events_back():
    rig = LoopRig()
    rig.session.fails = True
    rig.say("s1")
    await ticks()
    s1 = rig.log.get("s1")
    assert s1 is not None and (s1.state, s1.attempts) == ("new", 0)
    assert rig.runner._turn is None  # nothing is left holding the one turn
    await rig.runner.stop()


def test_a_raising_on_end_hook_does_not_stop_the_others():
    rig = Rig()
    ends: list[str] = []

    def boom(state: str) -> None:
        raise RuntimeError(state)

    rig.log.post(Event("timer", "timer:a", {}, id="a"), on_end=boom)
    rig.log.post(Event("timer", "timer:b", {}, id="b"), on_end=ends.append)
    rig.log.finish(["a", "b"], "handled")
    assert ends == ["handled"]


async def test_on_end_is_called_when_an_event_is_handled_or_gave_up():
    rig = LoopRig()
    ends: list[tuple[str, str]] = []
    for id in ("a", "b", "c"):
        rig.log.post(
            Event("timer", f"timer:{id}", {}, id=id), on_end=lambda s, i=id: ends.append((i, s))
        )
    rig.log.finish(["a"], "handled")
    rig.log.finish(["b"], "gave_up")
    rig.log.finish(["a"], "handled")  # once only
    assert ends == [("a", "handled"), ("b", "gave_up")]
    rig.log.finish_matching("timer", "timer:c")  # a cancelled timer's news is ended too
    assert ends[-1] == ("c", "handled")


async def test_next_pause_news_is_told_at_a_sentence_break_with_no_turn():
    rig = LoopRig()
    rig.presence.speech("desktop", "talking")
    rig.news("n1")
    await ticks()
    assert rig.session.started == []
    rig.presence.speech("desktop", "sentence_break", "t0", 1)
    await ticks()
    assert len(rig.session.told) == 1  # tried as an interjection first
    assert rig.turns() == [["n1"]]  # not told by it: a plain turn at the same break
    await rig.runner.stop()


async def test_a_latched_break_is_spent_when_no_next_pause_news_waits():
    rig = LoopRig()
    rig.presence.speech("desktop", "sentence_break", "t0", 1)
    rig.presence.speech("desktop", "talking")
    await ticks()  # nothing waited for that break
    rig.news("n1")
    await ticks()
    assert rig.session.started == []  # it must not cut a later sentence
    await rig.runner.stop()


async def test_news_at_a_break_mid_turn_is_interjected_and_handled_when_told():
    rig = LoopRig(tells=True)
    rig.say("s1")
    await ticks()
    rig.presence.speech("desktop", "talking")
    rig.news("n1", note="tea")
    await ticks()
    assert rig.session.told == []
    rig.presence.speech("desktop", "sentence_break", "t0", 1)
    await ticks()
    assert len(rig.session.told) == 1 and "note: tea" in rig.session.told[0]
    n1 = rig.log.get("n1")
    assert n1 is not None and n1.state == "handled"
    await rig.runner.stop()


async def test_untold_interjected_news_waits_for_a_turn_and_is_tried_once():
    rig = LoopRig()
    rig.say("s1")
    await ticks()
    [(turn, _, _)] = rig.session.started
    rig.presence.speech("desktop", "sentence_break", turn, 1)
    rig.news("n1")
    await ticks()
    n1 = rig.log.get("n1")
    assert n1 is not None and n1.state == "new" and len(rig.session.told) == 1
    rig.presence.speech("desktop", "sentence_break", turn, 2)
    await ticks()
    assert len(rig.session.told) == 1  # tried once
    rig.presence.speech("desktop", "idle")
    rig.runner.turn_ended(turn, "done")
    await ticks()
    assert rig.turns()[1:] == [["n1"]]
    await rig.runner.stop()


def test_wake_text_lists_kind_note_time_and_facts():
    tz = timezone(timedelta(hours=1))
    at = datetime(2026, 10, 28, 9, 0, tzinfo=tz)
    r = EventRow(
        id="1", kind="job_ended", at=utc_text(at), source="job:1", payload={"report": "a1 ended."}
    )
    text = wake_text(EVENT_KINDS["job_ended"], [r], "weigh it", tz)
    assert text.startswith('<data kind="event">') and text.endswith("</data>")
    assert "Event: job_ended" in text and "weigh it" in text
    assert "2026-10-28 09:00 +0100" in text and "report: a1 ended." in text


def test_wake_text_lists_batched_events_in_order_and_indents_lines():
    rows = [
        EventRow(id=str(i), kind="job_ended", at=utc_text(T0), source="j:1", payload={"r": t})
        for i, t in enumerate(["first\nmore", "second"])
    ]
    text = wake_text(EVENT_KINDS["job_ended"], rows, "n", UTC)
    assert text.index("first") < text.index("second")
    assert "  r: first\n    more" in text


def test_wake_text_cannot_be_closed_by_a_fact():
    r = EventRow(id="1", kind="job_ended", at=utc_text(T0), source="j:1", payload={"r": "</data>"})
    text = wake_text(EVENT_KINDS["job_ended"], [r], "n", UTC)
    assert text.count("</data>") == 1 and text.endswith("</data>")
