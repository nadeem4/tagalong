"""Acceptance tests for the tasks framework: many tasks and many bodies at once, on fakes only.

Each test asserts the intended behaviour of a Jarvis-like Scout. Where the brain still falls
short the test is xfail(strict) with the audit finding it waits on; the slice that closes the
finding removes the mark, so an unexpected pass fails the run.
"""

import asyncio
import datetime
import json
from types import SimpleNamespace

import pytest
from event_log import make_session
from fake_clock import FakeClock
from job_rows import add_timer, records_for
from test_jobs import HANG, FakeAsks, FakeBridge, installed, make_rig  # noqa: F401 (fixture)
from test_sessions import (
    NO_WAIT,
    ChangeApp,
    Failing,
    Gate,
    Open,
    QuietPeer,
    end_job,
    file_memory,
    idle,
    join,
    join_headless,
    make,
    open_asks,
    said,
    say,
    settle,
    states,
    tool_call,
)

from brain.asks import Answer
from brain.bodies import Bodies
from brain.events import EventKind
from brain.experts import ExpertHost, ExpertRun
from brain.jobs import JobError
from brain.memory import Memory
from brain.mind.turn import Final
from brain.protocol import Body, RpcError

TIMER = {"timer": EventKind("timer", batch_seconds=0, max_per_hour=6)}


async def until_real(condition, timeout=15.0):
    async def poll():
        while not condition():
            await asyncio.sleep(0.02)

    await asyncio.wait_for(poll(), timeout)


def texts(message):
    return [b.get("text", "") for b in message["content"] if isinstance(b, dict)]


# 1. Ten quick says ------------------------------------------------------------------------


async def test_1_ten_quick_says_are_all_seen_and_answered_in_order():
    gate = asyncio.Event()
    model = Gate([gate, "first answer", "answer to the rest"])
    session, sent = make(model)
    join(session, "desktop")
    results = [await said(session, sent, "desktop", say("task 1"))]
    await settle()  # the turn is running, held inside the model
    for i in range(2, 11):
        results.append(await said(session, sent, "desktop", say(f"task {i}")))
    gate.set()
    await idle(session)
    seen = [t for call in model.seen for m in call if m["role"] == "user" for t in texts(m)]
    seen_in_order = [t for t in seen if t.startswith("task ")]
    unique = list(dict.fromkeys(seen_in_order))
    answered = session.history[-1]["role"] == "assistant"
    print(
        f"\n[1] says seen: {len(unique)}/10, joined flags: "
        f"{[r.joined for r in results[1:]]}, model calls: {len(model.seen)}, "
        f"in order: {unique == [f'task {i}' for i in range(1, 11)]}, answered last: {answered}"
    )
    assert unique == [f"task {i}" for i in range(1, 11)]
    assert answered and states(sent)[-1] == "ended" and sent[-1][1]["reason"] == "done"


# 2. Stop while a job finishes (C1) --------------------------------------------------------


class Overlap(Gate):
    """Counts model streams alive at once: two turns on one history show as a peak of 2."""

    def __init__(self, steps):
        super().__init__(steps)
        self.active = 0
        self.peak = 0

    async def stream(self, system, messages, tools):
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            async for item in Gate.stream(self, system, messages, tools):
                for _ in range(3):
                    await asyncio.sleep(0)  # stay open long enough for a rival to start
                yield item
        finally:
            self.active -= 1


@pytest.mark.xfail(
    strict=True, reason="C1: _ended starts a wake and the pending turn at once, two on one history"
)
async def test_2_stop_while_a_job_finishes_never_runs_two_turns_at_once():
    gate = asyncio.Event()
    model = Overlap([gate, "w1", "p1", "x", "y", "z"])
    memory = Memory(":memory:")
    session, sent = make(model, memory)
    join(session, "desktop")
    live: list = []
    overlaps: list[str] = []
    real = session._start_turn

    def spy(*a, **k):
        busy = [t for t in live if not t.done()]
        turn = real(*a, **k)
        live.append(session._task)
        if busy:
            overlaps.append(turn)
        return turn

    session._start_turn = spy
    first = await said(session, sent, "desktop", say("task one"))
    await settle()
    joined = await said(session, sent, "desktop", say("task two"))  # joins the running turn's inbox
    session.jobs._on_finished(end_job(memory))  # a job's news is due...
    session.cancel(first.turn)  # ...as the person presses Stop
    await asyncio.sleep(0.2)
    await idle(session)
    roles = [m["role"] for m in session.history]
    print(
        f"\n[2] second say joined={joined.joined}; turns started={len(live)}; "
        f"started while another still ran={len(overlaps)}; peak concurrent model streams="
        f"{model.peak}; history roles={roles}"
    )
    assert not overlaps and model.peak == 1


# 3. Three hand-offs, one card left open (C2, C3) ------------------------------------------


@pytest.mark.xfail(
    strict=True, reason="C3: a third hand-off is refused ('2 jobs are already running'), no queue"
)
async def test_3a_a_third_handoff_is_queued_not_refused(make_rig):  # noqa: F811
    rig = make_rig(FakeAsks(Answer("Plan"), Answer("Plan"), Answer("Plan")))
    await rig.jobs.start("one", str(rig.folder))
    await rig.jobs.start("two", str(rig.folder))
    try:
        third = await rig.jobs.start("three", str(rig.folder))
    except JobError as err:
        print(f"\n[3a] third hand-off REFUSED, nothing queued: {err}")
        raise
    print(f"\n[3a] third hand-off accepted: {third}")


@pytest.mark.xfail(
    strict=True, reason="C2: an unanswered hand-off card blocks the turn, so says and news wait"
)
async def test_3b_an_open_hand_off_card_does_not_block_new_says_and_news(tmp_path, monkeypatch):
    script = tmp_path / "script.json"
    script.write_text(json.dumps(HANG))
    monkeypatch.setenv("FAKE_ACP_SCRIPT", str(script))
    monkeypatch.setenv("FAKE_ACP_LOG", str(tmp_path / "log.jsonl"))
    folder = tmp_path / "proj"
    folder.mkdir()
    clock, bridge, runs = FakeClock(), FakeBridge(), []

    def make_run(expert, **callbacks):
        host = ExpertHost(expert.command, expert.id, idle_s=0, grace=2)
        run = ExpertRun(
            host=host, sleep=clock.sleep, clock=clock.clock, grace=2, bridge=bridge, **callbacks
        )
        runs.append(run)
        return run

    calls = [
        {"type": "tool_use", "id": f"h{i}", "name": "hand_off",
         "input": {"task": f"task {i}", "folder": str(folder)}}
        for i in (1, 2, 3)
    ]  # fmt: skip
    model = Gate(
        [Final(calls, "tool_use", SimpleNamespace()), *["ok"] * 6]  # then plain answers
    )
    bodies, sent = Bodies(), []
    bodies.notify = lambda m, p: sent.append((m, p))
    memory = Memory(":memory:")
    session = make_session(
        model, Open(), bodies, 10, memory, kinds=NO_WAIT,
        make_run=make_run, experts=lambda: [installed()],
    )  # fmt: skip
    outcomes: list[str] = []
    real_start = session.jobs.start

    async def spy_start(task, *a, **k):
        try:
            job = await real_start(task, *a, **k)
            outcomes.append(f"{task}: started")
            return job
        except JobError as err:
            outcomes.append(f"{task}: REFUSED ({err})")
            raise

    session.jobs.start = spy_start
    join(session, "desktop")
    try:
        await session.say("desktop", say("do three things"))
        await until_real(lambda: len(open_asks(sent)) >= 2)  # two cards up, nobody answers
        await session.say("desktop", say("also, what time is it?"))
        session.jobs._on_finished(end_job(memory))  # some earlier job's news
        await asyncio.sleep(0.5)
        saw_say = any("what time is it" in json.dumps(c) for c in model.seen)
        saw_news = any("job_ended" in json.dumps(c) for c in model.seen)
        print(
            f"\n[3b] cards open={len(open_asks(sent))}; hand-off outcomes={outcomes}; "
            f"turn still busy={session._busy()}; model saw new say={saw_say}; "
            f"model saw job news={saw_news}; model calls so far={len(model.seen)}"
        )
        assert saw_say and saw_news
    finally:
        for card in open_asks(sent):
            try:
                session.answer(card["id"], "cancel", "desktop")
            except RpcError:
                pass
        await asyncio.sleep(0.3)
        if session._task is not None:
            session._task.cancel()
        await asyncio.sleep(0.2)
        for job_id in list(session.jobs._runs):
            await session.jobs.stop(job_id)
        for run in runs:
            await run.close()


# 4. Reminder during an outage (C5) --------------------------------------------------------


def _timer_rig(tmp_path):
    tz = datetime.timezone(datetime.timedelta(hours=1))
    now = datetime.datetime(2026, 1, 1, 9, 0, tzinfo=tz)
    memory = file_memory(tmp_path)
    add_timer(
        records_for(memory, lambda: now).work,
        "3pm reminder: call the bank",
        now - datetime.timedelta(minutes=1),
    )
    return memory, now


@pytest.mark.xfail(
    strict=True, reason="C5: a timer whose wake turn errored is marked done and never told again"
)
async def test_4_a_reminder_whose_wake_errored_is_told_again_after_a_restart(tmp_path):
    memory, now = _timer_rig(tmp_path)
    session, sent = make(Failing([]), memory, kinds=TIMER, now=lambda: now)
    join(session, "desktop")
    session.dispatcher.pump()
    await idle(session)
    reason = sent[-1][1]["reason"]
    row = records_for(memory).work.of_kind("timer", ["done", "active", "planned"])[0]
    print(f"\n[4] wake ended '{reason}'; timer row state='{row.state}', told={row.reported_at}")
    again = Gate(["ok", "ok"])
    session2, _ = make(again, memory, kinds=TIMER, now=lambda: now)  # the brain restarts
    join(session2, "desktop")
    session2.dispatcher.pump()
    await idle(session2)
    told = any("3pm reminder" in json.dumps(c) for c in again.seen)
    print(f"[4] after restart, reminder told again: {told}")
    assert reason == "error" and told


async def test_4_control_a_job_whose_wake_errored_is_told_again_after_a_restart(tmp_path):
    memory = file_memory(tmp_path)
    session, sent = make(Failing([]), memory)
    join(session, "desktop")
    session.jobs._on_finished(end_job(memory))
    await idle(session)
    assert sent[-1][1]["reason"] == "error"
    again = Gate(["ok", "ok"])
    session2, _ = make(again, memory)
    join(session2, "desktop")
    session2.dispatcher.pump()
    await idle(session2)
    told = any("job_ended" in json.dumps(c) for c in again.seen)
    print(f"\n[4 control] job result told again after restart: {told}")
    assert told


# 5. Crash mid-turn (C4) -------------------------------------------------------------------


@pytest.mark.xfail(
    strict=True, reason="C4: says accepted mid-turn exist only in memory until the turn ends"
)
async def test_5_says_accepted_before_a_crash_are_not_lost(tmp_path):
    memory = file_memory(tmp_path)
    gate = asyncio.Event()
    session, sent = make(Gate([gate, "x", "y", "z"]), memory)
    join(session, "desktop")
    join(session, "whatsapp")
    a = await said(session, sent, "desktop", say("task A: book the flight"))
    await settle()
    b = await said(session, sent, "whatsapp", say("task B: email the landlord"))
    try:
        # A hard kill: no turn end, nothing saved. A new brain opens the same database.
        saved = json.dumps(memory.load_messages())
        revived, _ = make(Gate(["x"]), memory)
        known = json.dumps(revived.history)
        has_a = "task A" in saved or "task A" in known
        has_b = "task B" in saved or "task B" in known
        print(
            f"\n[5] both says got turn ids ({a.turn[:6]}, {(b.turn or 'queued')[:6]}); "
            f"after the crash task A kept={has_a}, task B kept={has_b}"
        )
        assert has_a and has_b
    finally:
        gate.set()
        session._task.cancel()
        await asyncio.sleep(0.1)
        await idle(session)


# 6. Desktop, phone and browser at once ----------------------------------------------------


async def test_6a_each_reply_goes_to_the_body_that_asked():
    gate = asyncio.Event()
    session, sent = make(Gate([gate, "for the desktop", "for the phone"]))
    join(session, "desktop")
    join(session, "whatsapp")
    await session.say("desktop", say("hi from the desk"))
    await settle()
    later = await said(
        session, sent, "whatsapp", say("hi from the phone")
    )  # waits for its own turn
    gate.set()
    await idle(session)
    replies = [(p["body"], p["delta"]) for m, p in sent if m == "reply" and "delta" in p]
    print(f"\n[6a] phone say joined={later.joined}; replies (body, text)={replies}")
    assert replies == [("desktop", "for the desktop"), ("whatsapp", "for the phone")]


async def test_6b_a_browser_says_origin_is_recorded_as_the_browser():
    session, sent = make(Gate(["a"]))
    join(session, "desktop")
    join_headless(session, "browser")
    await session.say("browser", say("summarise this page"))
    await idle(session)
    [row] = session.events.ready()
    print(f"\n[6b] browser say recorded source: {row.source}")
    assert (row.kind, row.source) == ("say", "browser")


async def test_6c_two_bodies_answering_one_card_second_gets_not_found():
    session, sent = make(Gate(["unused"]))
    session.toolbox.sources.insert(1, ChangeApp())
    join(session, "desktop")
    join(session, "whatsapp")
    await session.toolbox.run(tool_call())
    [card] = open_asks(sent)
    session.answer(card["id"], "allow", "desktop")
    with pytest.raises(RpcError) as second:
        session.answer(card["id"], "allow", "whatsapp")
    print(f"\n[6c] second answer refused: {second.value.code}")


class RecordingPeer(QuietPeer):
    def __init__(self):
        self.closed = False
        self.frames: list = []

    def send(self, frame):
        self.frames.append(frame)

    def close(self):
        self.closed = True


@pytest.mark.xfail(
    strict=True, reason="M1: two desktops share the id 'desktop'; the second knocks off the first"
)
async def test_6d_two_desktops_with_the_same_id_can_both_stay_connected():
    bodies = Bodies()
    one, two = RecordingPeer(), RecordingPeer()
    desk = Body(id="desktop", kind="desktop", name="PC")
    bodies.connect(desk, [], one, None)
    bodies.connect(desk, [], two, None)
    print(f"\n[6d] first desktop closed: {one.closed}; online: {bodies.online_ids()}")
    assert not one.closed


class Chatty:
    """A reply of 600 streamed chunks, the way a long answer reaches the bodies."""

    model_id = "claude-sonnet-5-5"

    async def stream(self, system, messages, tools):
        for _ in range(600):
            yield "word "
        yield Final([{"type": "text", "text": "word " * 600}], "end_turn", SimpleNamespace())


@pytest.mark.xfail(
    strict=True, reason="M3: a body away during a long reply overflows its 500-frame replay window"
)
async def test_6e_a_body_that_was_away_during_a_long_reply_can_catch_up():
    bodies = Bodies()
    session = make_session(Chatty(), Open(), bodies, 10, Memory(":memory:"), kinds=NO_WAIT)
    peer = RecordingPeer()
    desk = Body(id="desktop", kind="desktop", name="PC")
    bodies.connect(desk, [], peer, None)
    bodies.connect(Body(id="whatsapp", kind="whatsapp", name="phone"), [], RecordingPeer(), None)
    bodies.disconnect("desktop", peer)  # the laptop sleeps
    await session.say("whatsapp", say("write me a long answer"))
    await idle(session)
    back = bodies.connect(desk, [], RecordingPeer(), 0)
    print(f"\n[6e] desktop reconnects: resync={back.resync}, frames replayed={len(back.backlog)}")
    assert not back.resync
