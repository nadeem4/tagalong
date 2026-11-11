"""Sources enter through the dispatcher: a say, a wake's news, a card answer.

A reply goes to the body the item came from, news is marked told only when the turn carrying it
finishes, and a phone-only setup still hears a job's question. Fake model and bodies only.
"""

import asyncio
import json

from job_rows import records_for
from test_sessions import (
    Gate,
    QuietPeer,
    end_job,
    finish_quietly,
    idle,
    join,
    make,
    say,
    settle,
    wake_started,
)

from brain.dispatcher import Item
from brain.events import EVENT_KINDS, Event
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
    session.say("desktop", say("first from the desktop"))
    await idle(session)
    sent.clear()
    posted = spy_posts(session)
    session.say("whatsapp", say("hi from the phone"))
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
    first = session.say("desktop", say("long question"))
    await settle()
    second = session.say("whatsapp", say("quick one"))
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
    session.post_event(Event("job_question", {"job": "j1", "message": "Which db?"}))
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
    event = Event("back", {"body": "wa", "idle_seconds": 900}, "back:wa", origin_body="wa")
    session._from_body(event)
    await idle(session)
    assert wake_started(sent) == ["wa"]
    replies = [p["body"] for m, p in sent if m == "reply"]
    assert replies and set(replies) == {"wa"}


async def test_cancel_before_the_say_reaches_its_turn_ends_it_cancelled():
    session, sent = make(Gate(["never"]))
    result = session.say("desktop", say("a"))
    session.cancel(result.turn)  # the turn has not begun: the say still waits at the door
    await settle()
    states = [(p["state"], p.get("reason")) for m, p in sent if m == "turn"]
    assert states == [("started", None), ("ended", "cancelled")]
    assert session._task is None


async def test_card_answer_not_held_behind_waiting_say():
    gate = asyncio.Event()
    session, _ = make(Gate([gate, "ok"]))
    join(session, "desktop")
    join(session, "whatsapp")
    session.say("desktop", say("first"))
    await settle()  # the turn is running, held on the gate
    session.say("whatsapp", say("from the phone"))  # its own turn, queued behind the first
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
    first = session.say("desktop", say("one"))
    await settle()
    second = session.say("desktop", say("two"))
    assert second.joined is True and second.turn == first.turn
    await settle()
    assert len(session._inbox) == 1  # handed to the running turn, which takes it at its next step
    gate.set()
    await idle(session)
    assert session._inbox == []
    assert any("two" in json.dumps(m) for m in model.seen[-1])
