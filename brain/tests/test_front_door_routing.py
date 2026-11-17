"""Sources enter through the dispatcher: a say, a wake's news, a card answer.

A reply goes to the body the item came from, news is marked told only when the turn carrying it
finishes, and a phone-only setup still hears a job's question. Fake model and bodies only.
"""

import asyncio
import json
from dataclasses import replace
from types import SimpleNamespace

from job_rows import records_for
from test_session_interrupt import make_voiced, over
from test_sessions import (
    Gate,
    QuietPeer,
    end_job,
    finish_quietly,
    idle,
    join,
    join_headless,
    make,
    say,
    settle,
    wake_started,
)

from brain.dispatcher import Item
from brain.events import EVENT_KINDS, Event
from brain.jobs import JobId
from brain.memory import Memory
from brain.mind.turn import Call
from brain.protocol import Body


def spy_posts(session):
    posted: list[Item] = []
    real = session.dispatcher.post

    def post(item):
        posted.append(item)
        real(item)

    session.dispatcher.post = post
    return posted


async def test_reply_goes_to_origin_body():
    session, sent = make(Gate(["hi desktop", "hello phone"]))
    join(session, "desktop")
    join(session, "whatsapp")
    await session.say("desktop", say("first from the desktop"))
    await idle(session)
    sent.clear()
    posted = spy_posts(session)
    await session.say("whatsapp", say("hi from the phone"))
    await idle(session)
    assert [(i.kind, i.origin_body) for i in posted] == [("say", "whatsapp")]
    assert wake_started(sent) == ["whatsapp"]
    replies = [p["body"] for m, p in sent if m == "reply"]
    assert replies and set(replies) == {"whatsapp"}


async def test_whatsapp_say_during_desktop_turn_replies_to_whatsapp():
    gate = asyncio.Event()
    model = Gate([gate, "for the desktop", "for the phone"])
    session, sent = make(model)
    join(session, "desktop")
    join(session, "whatsapp")
    first = await session.say("desktop", say("long question"))
    await settle()
    second = await session.say("whatsapp", say("quick one"))
    assert second.joined is False and second.turn != first.turn
    gate.set()
    await idle(session)
    assert wake_started(sent) == ["desktop", "whatsapp"]
    by_turn = {}
    for method, params in sent:
        if method == "reply":
            by_turn.setdefault(params["turn"], set()).add(params["body"])
    assert by_turn == {first.turn: {"desktop"}, second.turn: {"whatsapp"}}


async def test_wake_not_reported_until_turn_finishes():
    gate = asyncio.Event()
    memory = Memory(":memory:")
    session, sent = make(Gate([gate, "told"]), memory)
    join(session, "desktop")
    session.jobs._on_finished(end_job(memory))
    await settle()
    assert wake_started(sent) == ["desktop"]  # the wake is running...
    assert not records_for(memory).get_job("j1").parts[-1].reported  # ...but has not finished
    gate.set()
    await idle(session)
    assert records_for(memory).get_job("j1").parts[-1].reported


async def test_cancelled_wake_news_survives():
    gate = asyncio.Event()
    memory = Memory(":memory:")
    session, sent = make(Gate([gate, "never"]), memory)
    join(session, "desktop")
    session.jobs._on_finished(end_job(memory))
    await settle()
    session.cancel(session._turn_id)
    await finish_quietly(session)
    # Cancelled, so not told yet; the news is posted again and the next wake tells it.
    await idle(session)
    assert records_for(memory).get_job("j1").parts[-1].reported
    assert len(wake_started(sent)) == 2


async def test_job_question_reaches_whatsapp_only_setup():
    session, sent = make(Gate(["asked"]), kinds=None)
    session._bodies.connect(Body(id="wa", kind="whatsapp", name="WA"), [], QuietPeer(), None)
    session.post_event(Event("job_question", "scout", {"job": "j1", "message": "Which db?"}))
    await settle()
    assert wake_started(sent) == ["wa"]


async def test_card_answer_enters_front_door():
    session, _ = make(Gate([]))
    join(session, "desktop")
    session._asks.show("a1", Call("c1", "tool", {}, "", "do it"), "tool", False)
    posted = spy_posts(session)
    session.answer("a1", "allow", "desktop")
    assert [(i.kind, i.origin_body, i.payload["ask"]) for i in posted] == [
        ("card_answer", "desktop", "a1")
    ]


async def test_post_refuses_a_kind_nobody_registered():
    session, _ = make(Gate([]))
    try:
        session.dispatcher.post(Item("nonsense", "brain", {}, "idle"))
    except ValueError as err:
        assert "nonsense" in str(err)
    else:
        raise AssertionError("an unregistered kind must not be accepted")
    assert EVENT_KINDS["say"].urgency == "now"


async def test_whatsapp_event_reply_goes_to_whatsapp():
    session, sent = make(Gate(["got it"]), kinds=None)
    join(session, "desktop")
    session._bodies.connect(Body(id="wa", kind="whatsapp", name="WA"), [], QuietPeer(), None)
    session._last_body = "desktop"  # a wake would otherwise go to the screen
    event = Event("back", "wa", {"body": "wa", "idle_seconds": 900})
    session._from_body(event)
    await idle(session)
    assert wake_started(sent) == ["wa"]
    replies = [p["body"] for m, p in sent if m == "reply"]
    assert replies and set(replies) == {"wa"}


async def test_cancelling_a_say_queued_behind_a_turn_ends_it_cancelled():
    gate = asyncio.Event()
    model = Gate([gate, "one"])
    session, sent = make(model)
    join(session, "desktop")
    join(session, "whatsapp")
    await session.say("desktop", say("first"))
    await settle()
    queued = await session.say("whatsapp", say("from the phone"))  # waits for its own turn
    session.cancel(queued.turn)
    gate.set()
    await idle(session)
    ends = [(p["turn"], p["reason"]) for m, p in sent if m == "turn" and p["state"] == "ended"]
    assert (queued.turn, "cancelled") in ends
    assert len(model.seen) == 1  # the cancelled say never reached the model


async def test_card_answer_not_held_behind_waiting_say():
    gate = asyncio.Event()
    session, _ = make(Gate([gate, "ok"]))
    join(session, "desktop")
    join(session, "whatsapp")
    await session.say("desktop", say("first"))
    await settle()  # the turn is running, held on the gate
    await session.say("whatsapp", say("from the phone"))  # its own turn, queued behind the first
    seen: list[str] = []
    session.ask_runner.answered = lambda ask, option, body: seen.append(ask)
    session.dispatcher.post(Item("card_answer", "desktop", {"ask": "a1", "option": "allow"}, "now"))
    await settle()
    assert seen == ["a1"]  # the door was not blocked by the say waiting for the turn
    gate.set()
    await idle(session)


async def test_say_during_turn_joins_through_the_dispatcher():
    gate = asyncio.Event()
    model = Gate([gate, "first", "second"])
    session, _ = make(model)
    join(session, "desktop")
    first = await session.say("desktop", say("one"))
    await settle()
    second = await session.say("desktop", say("two"))
    assert second.joined is True and second.turn == first.turn
    await settle()
    assert len(session._inbox) == 1  # handed to the running turn, which takes it at its next step
    gate.set()
    await idle(session)
    assert session._inbox == []
    assert any("two" in json.dumps(m) for m in model.seen[-1])


class Boom(Gate):
    async def stream(self, system, messages, tools):
        raise RuntimeError("the model is down")
        yield  # pragma: no cover


async def test_joined_is_decided_when_the_say_is_delivered():
    gate = asyncio.Event()
    model = Gate([gate, "one", "two"])
    session, sent = make(model)
    join(session, "desktop")
    first = await session.say("desktop", say("a"))
    await settle()
    real = session.dispatcher.deliver

    async def late(items):
        gate.set()  # the running turn ends before this say is delivered
        for _ in range(100):
            if session._task is None:
                break
            await asyncio.wait({session._task})
            await asyncio.sleep(0)
        await real(items)

    session.dispatcher.deliver = late
    second = await session.say("desktop", say("b"))
    assert second.joined is False and second.turn != first.turn
    await idle(session)
    assert {"type": "text", "text": "b"} in model.seen[-1][-1]["content"]
    starts = [p["turn"] for m, p in sent if m == "turn" and p["state"] == "started"]
    assert starts == [first.turn, second.turn]


async def test_a_say_after_the_turns_last_read_gets_a_turn_of_its_own():
    gate = asyncio.Event()
    model = Gate([gate, "one", "two"])
    session, _ = make(model)
    join(session, "desktop")
    first = await session.say("desktop", say("a"))
    await settle()
    session._inbox_open = False  # the turn has done its last read of what was said
    second = await session.say("desktop", say("late"))
    assert second.joined is False and second.turn != first.turn
    gate.set()
    await idle(session)
    assert {"type": "text", "text": "late"} in model.seen[-1][-1]["content"]


async def test_news_is_posted_again_once_when_its_turn_is_cancelled_twice():
    g1, g2 = asyncio.Event(), asyncio.Event()
    memory = Memory(":memory:")
    session, _ = make(Gate([g1, g2]), memory)
    join(session, "desktop")
    posted = spy_posts(session)
    session.jobs._on_finished(end_job(memory))
    await settle()
    first = session._turn_id
    session.cancel(first)
    for _ in range(100):  # the news is posted again and its wake starts
        if session._turn_id not in (None, first):
            break
        await asyncio.sleep(0)
    assert session._turn_id not in (None, first)
    session.cancel(session._turn_id)
    await finish_quietly(session)
    await idle(session)
    assert [i.kind for i in posted].count("job_ended") == 2  # the first, and one more
    assert not records_for(memory).get_job("j1").parts[-1].reported


async def test_an_error_end_does_not_post_the_news_again():
    memory = Memory(":memory:")
    session, _ = make(Boom([]), memory)
    join(session, "desktop")
    posted = spy_posts(session)
    session.jobs._on_finished(end_job(memory))
    await idle(session)
    assert [i.kind for i in posted].count("job_ended") == 1
    assert not records_for(memory).get_job("j1").parts[-1].reported


async def test_news_that_did_not_opt_in_is_not_posted_again():
    session, _ = make(Gate([asyncio.Event(), "never"]))
    join(session, "desktop")
    posted = spy_posts(session)
    session.post_event(Event("job_ended", "scout", {"report": "r"}), on_end=lambda reason: None)
    await settle()
    session.cancel(session._turn_id)
    await finish_quietly(session)
    await settle()
    assert [i.kind for i in posted].count("job_ended") == 1  # a settled question is not re-asked


async def test_a_say_survives_its_body_disconnecting_before_delivery():
    model = Gate(["answered"])
    session, _ = make(model)
    join(session, "desktop")
    real = session.dispatcher.deliver
    release = asyncio.Event()

    async def late(items):
        await release.wait()
        await real(items)

    session.dispatcher.deliver = late
    task = asyncio.create_task(session.say("desktop", say("still here")))
    await settle()
    task.cancel()  # the connection closed; its handler task is cancelled
    release.set()
    await idle(session)
    assert {"type": "text", "text": "still here"} in model.seen[0][-1]["content"]


class BoomLater(Gate):
    def __init__(self, gate):
        super().__init__([])
        self.gate = gate

    async def stream(self, system, messages, tools):
        self.seen.append([dict(m) for m in messages])
        await self.gate.wait()
        raise RuntimeError("the model is down")
        yield  # pragma: no cover


async def test_a_say_joined_to_a_turn_that_errors_gets_its_own_turn():
    gate = asyncio.Event()
    model = BoomLater(gate)
    session, _ = make(model)
    join(session, "desktop")
    await session.say("desktop", say("a"))
    await settle()
    assert (await session.say("desktop", say("b"))).joined is True
    gate.set()
    await idle(session)
    assert len(model.seen) == 2  # b was not left unanswered in the failed turn's history


async def test_whatsapp_moments_wake_on_the_whatsapp_body():
    # The bridge reports a closed ask and a many-asks reply as facts; Scout's words must go
    # back to the phone even when the desktop spoke last.
    for name, data in (("ask_closed", {"via": "tap"}), ("many_pending", {"asks": 2})):
        session, sent = make(
            Gate(["hi desktop", "words for the phone"]),
            kinds={
                n: replace(EVENT_KINDS[n], batch_seconds=0) for n in ("ask_closed", "many_pending")
            },
        )
        join(session, "desktop")
        join(session, "whatsapp")
        await session.say("desktop", say("first from the desktop"))
        await idle(session)
        sent.clear()
        posted = spy_posts(session)
        session.body_event("whatsapp", name, data)
        await idle(session)
        assert [(i.kind, i.origin_body) for i in posted] == [(name, "whatsapp")]
        assert wake_started(sent) == ["whatsapp"]
        replies = [p["body"] for m, p in sent if m == "reply"]
        assert replies and set(replies) == {"whatsapp"}


async def hand_off(session, folder) -> str:
    """A real `Jobs.start` with only the expert launch faked; returns the new job's id."""

    async def pick(_expert):
        return SimpleNamespace(id="claude_code")

    async def start_part(job_id, *_a, **_k):
        return JobId(job_id)

    session.jobs._pick = pick
    session.jobs._start_part = start_part
    return str(await session.jobs.start("fix it", str(folder)))


def job_ended_cause(session, memory, job_id):
    session.jobs._on_finished(end_job(memory, job_id))
    row = next(r for r in session.events.ready() if r.kind == "job_ended")
    assert row.source == f"job:{job_id}"
    return row.caused_by


async def test_job_news_carries_the_say_as_its_cause(tmp_path):
    gate = asyncio.Event()
    memory = Memory(":memory:")
    session, _ = make(Gate([gate, "ok"]), memory)
    join(session, "desktop")
    join_headless(session, "browser")
    await session.say("browser", say("hand this off"))
    await settle()  # its turn is running, and it took the say
    [say_row] = [r for r in session.events.ready() if r.kind == "say"]
    job_id = await hand_off(session, tmp_path)
    assert job_ended_cause(session, memory, job_id) == say_row.id
    gate.set()
    await idle(session)


async def test_a_barge_in_say_that_hands_off_is_the_jobs_cause(tmp_path):
    gate = asyncio.Event()
    memory = Memory(":memory:")
    session, _, voice = make_voiced(Gate([gate, gate, "ok"]), memory)
    first = await session.say("desktop", say("tell me"))
    voice.logs[first.turn] = ["One.", "Two."]
    await settle()
    await session.say("desktop", over("wait", first.turn, 1))
    await settle()
    row = next(r for r in session.events.ready() if r.payload.get("text") == "wait")
    job_id = await hand_off(session, tmp_path)
    assert job_ended_cause(session, memory, job_id) == row.id
    gate.set()
    await idle(session)


async def test_a_say_joined_to_a_cut_turn_is_the_next_turns_cause(tmp_path):
    gate = asyncio.Event()
    memory = Memory(":memory:")
    session, _ = make(Gate([gate, gate, "ok"]), memory)
    join(session, "desktop")
    await session.say("desktop", say("tell me"))
    await settle()
    joined = await session.say("desktop", say("and also"))
    assert joined.joined is True
    session.cancel(session._turn_id)  # the turn ends with the joined words unanswered
    await settle()
    row = next(r for r in session.events.ready() if r.payload.get("text") == "and also")
    assert session._turn_cause == row.id
    gate.set()
    await idle(session)


async def test_a_wake_turn_that_hands_off_is_the_jobs_cause(tmp_path):
    gate = asyncio.Event()
    memory = Memory(":memory:")
    kinds = {"ask_closed": replace(EVENT_KINDS["ask_closed"], batch_seconds=0)}
    session, _ = make(Gate([gate, "ok"]), memory, kinds=kinds)
    join(session, "desktop")
    join(session, "whatsapp")
    session.body_event("whatsapp", "ask_closed", {"via": "tap"})
    await settle()
    [wake_row] = [r for r in session.events.ready() if r.kind == "ask_closed"]
    job_id = await hand_off(session, tmp_path)
    assert job_ended_cause(session, memory, job_id) == wake_row.id
    gate.set()
    await idle(session)
