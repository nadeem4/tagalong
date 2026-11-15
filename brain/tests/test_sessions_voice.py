"""The ear guide reaches every turn that is read aloud, and only those.

A spoken say, a typed say on a body that asked for read-aloud, and a brain-started wake turn
carry the guide; a silenced or unread turn does not. Fake model, voice and bodies only.
"""

from test_sessions import (
    Gate,
    RecordingVoice,
    finish_quietly,
    idle,
    join,
    make,
    read_aloud,
    say,
    spoken_say,
)

from brain.mind.prompt import ear_note


def has_note(model, call: int = 0) -> bool:
    content = model.seen[call][-1]["content"]
    return any(b.get("text") == ear_note() for b in content if isinstance(b, dict))


async def test_a_typed_say_on_a_read_aloud_body_carries_the_ear_note():
    model = Gate(["hello"])
    session, _ = make(model)
    session.voice = RecordingVoice()
    join(session, "desktop")
    read_aloud(session)
    await session.say("desktop", say("typed"))
    await finish_quietly(session)
    assert has_note(model)


async def test_a_spoken_say_silenced_by_the_body_carries_no_note():
    model = Gate(["hello"])
    session, _ = make(model)
    session.voice = RecordingVoice()
    join(session, "desktop")
    read_aloud(session, on=False)
    await session.say("desktop", spoken_say("hi"))
    await finish_quietly(session)
    assert not has_note(model)


async def test_an_unread_typed_say_carries_no_note():
    model = Gate(["hello"])
    session, _ = make(model)
    session.voice = RecordingVoice()
    join(session, "desktop")
    await session.say("desktop", say("typed"))
    await finish_quietly(session)
    assert not has_note(model)


async def test_a_spoken_say_carries_the_note():
    model = Gate(["hello"])
    session, _ = make(model)
    session.voice = RecordingVoice()
    join(session, "desktop")
    await session.say("desktop", spoken_say("hi"))
    await finish_quietly(session)
    assert has_note(model)


async def test_a_read_aloud_wake_turn_carries_the_note():
    model = Gate(["welcome back"])
    session, _ = make(model, kinds=None)
    session.voice = RecordingVoice()
    join(session, "desktop")
    read_aloud(session)
    session.body_event("desktop", "back", {"idle_seconds": 600})
    await idle(session)
    assert has_note(model)


async def test_a_wake_turn_that_is_not_read_aloud_carries_no_note():
    model = Gate(["welcome back"])
    session, _ = make(model, kinds=None)
    session.voice = RecordingVoice()
    join(session, "desktop")
    session.body_event("desktop", "back", {"idle_seconds": 600})
    await idle(session)
    assert not has_note(model)
