"""Sources enter through the one front door, the event log: a say, a wake's news, a card answer.

The runner starts every turn: a reply goes to the body the event came from, news is marked told
only when the turn carrying it ends, and a phone-only setup still hears a job's question. Fake
model and bodies only.
"""

import asyncio
import datetime
import json
from dataclasses import replace
from types import SimpleNamespace

from job_rows import job_told
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
    said,
    say,
    settle,
    until,
    wake_started,
)

from brain.auth import LOCAL
from brain.events import EVENT_KINDS, Event
from brain.jobs import JobId
from brain.memory import Memory
from brain.mind.turn import Call
from brain.protocol import Body


def spy_posts(session):
    posted: list[Event] = []
    real = session.events.post

    def post(event, **kw):
        posted.append(event)
        return real(event, **kw)

    session.events.post = post
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
    assert [(e.kind, e.source) for e in posted] == [("say", "whatsapp")]
    assert wake_started(sent) == ["whatsapp"]
    replies = [p["body"] for m, p in sent if m == "reply"]
    assert replies and set(replies) == {"whatsapp"}


async def test_whatsapp_say_during_desktop_turn_replies_to_whatsapp():
    gate = asyncio.Event()
    model = Gate([gate, "for the desktop", "for the phone"])
    session, sent = make(model)
    join(session, "desktop")
    join(session, "whatsapp")
    first = await said(session, sent, "desktop", say("long question"))
    await settle()
    second = await said(session, sent, "whatsapp", say("quick one"))
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
    assert not job_told(memory, "j1")  # ...but has not finished
    gate.set()
    await idle(session)
    assert job_told(memory, "j1")


async def test_cancelled_wake_news_is_handled():
    gate = asyncio.Event()
    memory = Memory(":memory:")
    session, sent = make(Gate([gate, "never"]), memory)
    join(session, "desktop")
    session.jobs._on_finished(end_job(memory))
    await settle()
    session.cancel(session._turn_id)
    await finish_quietly(session)
    # A cancel is the person's choice: the news counts as told and no second wake runs.
    await idle(session)
    assert job_told(memory, "j1")
    assert len(wake_started(sent)) == 1


async def test_job_question_reaches_whatsapp_only_setup():
    session, sent = make(Gate(["asked"]), kinds=None, screen=False)
    session._bodies.connect(Body(id="wa", kind="whatsapp", name="WA"), [], QuietPeer(), None, LOCAL)
    session.post_event(Event("job_question", "scout", {"job": "j1", "message": "Which db?"}))
    await settle()
    assert wake_started(sent) == ["wa"]


async def test_card_answer_enters_front_door():
    session, _ = make(Gate([]))
    join(session, "desktop")
    session._asks.show("a1", Call("c1", "tool", {}, "", "do it"), "tool", False)
    posted = spy_posts(session)
    session.answer("a1", "allow", "desktop")
    assert [(e.kind, e.source, e.payload["ask"]) for e in posted] == [
        ("card_answer", "desktop", "a1")
    ]


async def test_post_refuses_a_kind_nobody_registered():
    session, _ = make(Gate([]))
    try:
        session.post_event(Event("nonsense", "brain", {}))
    except ValueError as err:
        assert "nonsense" in str(err)
    else:
        raise AssertionError("an unregistered kind must not be accepted")
    assert EVENT_KINDS["say"].urgency == "now"


async def test_whatsapp_event_reply_goes_to_whatsapp():
    session, sent = make(Gate(["got it"]), kinds=None)
    join(session, "desktop")
    session._bodies.connect(Body(id="wa", kind="whatsapp", name="WA"), [], QuietPeer(), None, LOCAL)
    session.presence.touch("desktop")  # a wake would otherwise go to the screen
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
    queued = say("from the phone")
    await session.say("whatsapp", queued)  # waits for its own turn
    await settle()
    session.cancel(queued.id)  # a body cancels a say that has no turn yet by the say's id
    gate.set()
    await idle(session)
    (started,) = [p for m, p in sent if m == "turn" and queued.id in (p.get("events") or [])]
    ends = [(p["turn"], p["reason"]) for m, p in sent if m == "turn" and p["state"] == "ended"]
    assert (started["turn"], "cancelled") in ends
    assert len(model.seen) == 1  # the cancelled say never reached the model


async def test_card_answer_not_held_behind_waiting_say():
    gate = asyncio.Event()
    session, _ = make(Gate([gate, "ok"]))
    join(session, "desktop")
    join(session, "whatsapp")
    await session.say("desktop", say("first"))
    await settle()  # the turn is running, held on the gate
    await session.say("whatsapp", say("from the phone"))  # its own turn, queued behind the first
    posted = spy_posts(session)
    session._asks.on_item_answer("a1", "allow", "desktop")  # the card hook the answer frame calls
    await settle()
    assert [e.kind for e in posted] == ["card_answer"]  # not blocked by the say waiting
    gate.set()
    await idle(session)


async def test_say_during_turn_joins_at_the_turns_next_step():
    gate = asyncio.Event()
    model = Gate([gate, "first", "second"])
    session, sent = make(model)
    join(session, "desktop")
    first = await said(session, sent, "desktop", say("one"))
    await settle()
    second = await said(session, sent, "desktop", say("two"))
    assert second.frame is None  # saved; the turn takes it at its next step, not before
    gate.set()
    await idle(session)
    assert second.joined is True and second.turn == first.turn
    assert session.events.get(second.id).state == "handled"
    assert any("two" in json.dumps(m) for m in model.seen[-1])


class Boom(Gate):
    async def stream(self, system, messages, tools):
        raise RuntimeError("the model is down")
        yield  # pragma: no cover


async def test_an_error_end_does_not_post_the_news_again():
    memory = Memory(":memory:")
    session, _ = make(Boom([]), memory)
    join(session, "desktop")
    posted = spy_posts(session)
    session.jobs._on_finished(end_job(memory))
    await idle(session)
    assert [i.kind for i in posted].count("job_ended") == 1
    assert not job_told(memory, "j1")


class BoomLater(Gate):
    def __init__(self, gate):
        super().__init__([])
        self.gate = gate

    async def stream(self, system, messages, tools):
        self.seen.append([dict(m) for m in messages])
        await self.gate.wait()
        raise RuntimeError("the model is down")
        yield  # pragma: no cover


async def test_a_say_waiting_on_a_turn_that_errors_still_gets_its_own_turn():
    clock = [datetime.datetime(2026, 1, 1, 9, 0, tzinfo=datetime.UTC)]
    gate = asyncio.Event()
    model = BoomLater(gate)
    session, sent = make(model, now=lambda: clock[0])
    join(session, "desktop")
    a = say("a")
    await session.say("desktop", a)
    await settle()
    await session.say("desktop", say("b"))
    gate.set()
    await idle(session)
    assert len(model.seen) == 2  # b was not left unanswered behind the failed turn
    last = model.seen[-1][-1]["content"]
    assert {"type": "text", "text": "b"} in last
    # a waits out its backoff; its words are already in the history, so b goes alone
    assert {"type": "text", "text": "a"} not in last
    blocks = [b for m in model.seen[-1] for b in m["content"]]
    assert blocks.count({"type": "text", "text": "a"}) == 1
    clock[0] += datetime.timedelta(seconds=30)  # both backoffs are over: they are retried
    session.runner.poke()
    await until(lambda: len(model.seen) == 3)
    await idle(session)
    last = model.seen[-1][-1]["content"]
    facts = [b["text"] for b in last if 'resume="true" reason="error"' in b.get("text", "")]
    assert len(facts) == 1 and "text: a" in facts[0] and "text: b" in facts[0]
    blocks = [b for m in model.seen[-1] for b in m["content"]]
    assert blocks.count({"type": "text", "text": "a"}) == 1  # a's words reach the model once


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
        assert [(e.kind, e.source) for e in posted] == [(name, "whatsapp")]
        assert wake_started(sent) == ["whatsapp"]
        replies = [p["body"] for m, p in sent if m == "reply"]
        assert replies and set(replies) == {"whatsapp"}


async def hand_off(session, folder) -> str:
    """A real `Jobs.start` with only the expert launch faked; returns the new job's id."""

    async def pick(_expert):
        return SimpleNamespace(id="claude_code")

    async def start_part(job_id, chosen, task, path, *, task_id=None, caused_by=None, **_k):
        # What the real seam records for the job; only the expert launch is faked.
        session.jobs._records.add_job(
            job_id, chosen.id, task, str(path), "plan", task_id=task_id, caused_by=caused_by
        )
        return JobId(job_id)

    session.jobs._pick = pick
    session.jobs._start_part = start_part
    # What the hand_off tool passes: the event the running turn took.
    return str(await session.jobs.start("fix it", str(folder), caused_by=session._turn_cause))


def job_ended_cause(session, memory, job_id):
    records = session.jobs._records
    records.update_part(job_id, "p1", state="done", reason="end_turn", report="all good")
    session.jobs._on_finished(records.get_job(job_id))
    row = next(r for r in session.events.ready() if r.kind == "job_ended")
    assert row.source == f"job:{job_id}"
    return row.caused_by


async def test_job_news_carries_the_say_as_its_cause(tmp_path):
    gate = asyncio.Event()
    memory = Memory(":memory:")
    session, _ = make(Gate([gate, "ok"]), memory)
    join(session, "desktop")
    join_headless(session, "browser")
    asked = say("hand this off")
    await session.say("browser", asked)
    await settle()  # its turn is running, and it took the say
    job_id = await hand_off(session, tmp_path)
    assert job_ended_cause(session, memory, job_id) == asked.id
    gate.set()
    await idle(session)


async def test_a_barge_in_say_that_hands_off_is_the_jobs_cause(tmp_path):
    gate = asyncio.Event()
    memory = Memory(":memory:")
    session, sent, voice = make_voiced(Gate([gate, gate, "ok"]), memory)
    first = await said(session, sent, "desktop", say("tell me"))
    voice.logs[first.turn] = ["One.", "Two."]
    await settle()
    barge = over("wait", first.turn, 1)
    await session.say("desktop", barge)
    await until(lambda: session._turn_cause == barge.id)  # its turn, once the cut one ended
    job_id = await hand_off(session, tmp_path)
    assert job_ended_cause(session, memory, job_id) == barge.id
    gate.set()
    await idle(session)


async def test_a_say_the_cancelled_turn_never_took_gets_a_turn_of_its_own():
    gate = asyncio.Event()
    session, sent = make(Gate([gate, "ok"]))
    join(session, "desktop")
    first = say("tell me")
    await session.say("desktop", first)
    await settle()
    later = await said(session, sent, "desktop", say("and also"))
    session.cancel(session._turn_id)  # the person stopped the turn before its next step
    await idle(session)
    row = session.events.get(first.id)
    assert (row.state, row.end_reason) == ("handled", "cancelled")
    assert later.frame["state"] == "started" and session.events.get(later.id).state == "handled"
    assert len(wake_started(sent)) == 2


async def test_a_wake_turn_that_hands_off_is_the_jobs_cause(tmp_path):
    gate = asyncio.Event()
    memory = Memory(":memory:")
    kinds = {"ask_closed": replace(EVENT_KINDS["ask_closed"], batch_seconds=0)}
    session, _ = make(Gate([gate, "ok"]), memory, kinds=kinds)
    join(session, "desktop")
    join(session, "whatsapp")
    posted = spy_posts(session)
    session.body_event("whatsapp", "ask_closed", {"via": "tap"})
    await settle()
    [wake] = posted
    job_id = await hand_off(session, tmp_path)
    assert job_ended_cause(session, memory, job_id) == wake.id
    gate.set()
    await idle(session)


async def test_a_waiting_say_cancelled_with_no_screen_ends_on_its_own_body():
    # No body displays, so the say has no target; its frames still name the body it came from.
    session, sent = make(Gate(["unused"]), screen=False)
    join_headless(session, "browser")
    waiting = say("hello")
    await session.say("browser", waiting)
    await settle()
    session.cancel(waiting.id)
    frames = [p for m, p in sent if m == "turn" and waiting.id in (p.get("events") or [])]
    ended = [p for m, p in sent if m == "turn" and p["state"] == "ended"]
    assert [p["body"] for p in frames + ended] == ["browser", "browser"]
