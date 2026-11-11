"""A request no tool covers becomes a Connect offer, and Scout carries on once it is done.

Fake model, fake install_app: the loop is choose -> choice event -> install_app -> setup_done
event, all in one live conversation. The pending request lives only in that history, so a new
Session (a restart) resumes nothing. The brain's own wording is checked in mind/*.md, not here.
"""

import asyncio
import datetime
import json
from types import SimpleNamespace

from test_sessions import Gate, Open, join, say, settle

from brain.bodies import Bodies
from brain.events import Event, EventKind
from brain.memory import Memory
from brain.mind.turn import Final
from brain.sessions import Session
from brain.toolbox import ToolSpec

KINDS = {
    "choice": EventKind("choice", batch_seconds=None, max_per_hour=None),
    "setup_done": EventKind("setup_done", batch_seconds=None, max_per_hour=None),
}
REQUEST = "put lunch with Sam on my calendar tomorrow"
CONNECT = "Connect Google Calendar"


def use(name, **args):
    block = {"type": "tool_use", "id": f"t_{name}", "name": name, "input": args}
    return Final([block], "tool_use", SimpleNamespace())


def rig(steps, memory=None):
    model = Gate(steps)
    bodies = Bodies()
    bodies.notify = lambda m, p: None
    installs: list[dict] = []

    async def install_app(args):
        installs.append(args)
        # sign-in finishes later, in the browser: the app reports through an event
        session.scheduler.emit(
            Event(
                "setup_done",
                {"app": "gcal", "name": "Google Calendar", "ok": True, "tools": "create_event"},
                key="gcal",
            )
        )
        return json.dumps({"id": "gcal", "status": "signing_in"})

    spec = ToolSpec("install_app", "Add an app.", {"type": "object"}, default_mode="auto")
    session = Session(
        model,
        Open(),
        bodies,
        10,
        memory or Memory(":memory:"),
        now=lambda: datetime.datetime(2026, 1, 1, 9, 0, tzinfo=datetime.UTC),
        kinds=KINDS,
        extra_tools=[(spec, install_app)],
    )
    return session, model, installs


async def idle(session):
    await settle()  # a say or an answer reaches its turn through the dispatcher
    while session._task is not None:
        task = session._task
        await asyncio.wait({task})
        await asyncio.sleep(0)


def texts(messages):
    return [b.get("text", "") for m in messages for b in m["content"] if isinstance(b, dict)]


async def test_a_missing_tool_is_offered_then_connected_then_the_request_resumes():
    session, model, installs = rig(
        [
            use(
                "choose",
                question="Connect Google Calendar?",
                options=[CONNECT, "Not now"],
                recommended=CONNECT,
            ),
            "Asked.",  # ends the turn; the answer comes back as an event
            use("install_app", id="gcal"),
            "Opening the sign-in.",
            "Connected. Adding lunch with Sam.",
        ]
    )
    join(session, "desktop")
    session.say("desktop", say(REQUEST))
    await idle(session)
    (ask,) = [a for a in session.open_asks() if a.get("tool") == "choose"]
    assert ask["options"] == [CONNECT, "Not now"]

    session.answer(ask["id"], CONNECT, "desktop")
    await asyncio.sleep(0)
    await idle(session)

    assert installs == [{"id": "gcal"}]
    last = texts(model.seen[-1])
    assert any("Event: setup_done" in t and "create_event" in t for t in last)
    assert REQUEST in last  # the original request is still in the live history
    assert session.history[-1]["content"][-1]["text"] == "Connected. Adding lunch with Sam."


async def test_after_a_restart_nothing_resumes():
    saved = Memory(":memory:")  # what the chat left behind: the request and the Connect offer
    saved.save_messages(
        [
            {"role": "user", "content": [{"type": "text", "text": REQUEST}]},
            {"role": "assistant", "content": [{"type": "text", "text": "Connect Calendar?"}]},
        ]
    )
    session, model, installs = rig([], memory=saved)
    join(session, "desktop")
    session.scheduler.pump()
    await idle(session)
    assert len(session.history) == 2  # rebuilt through mind/resume.py, as saved text only
    assert session._task is None and model.seen == [] and installs == []
    assert session.open_asks() == []  # the Connect question died with the old process
