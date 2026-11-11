"""Setup events: a finished install or login is saved as an open item until Scout's wake turn
starts, so a restart or a spent budget does not lose the news. Fake emit records the hooks.
"""

from datetime import UTC, datetime

from brain.events import Event
from brain.memory import Memory
from brain.open_items import OpenItems
from brain.setup.events import SetupEvents

NOW = datetime(2026, 11, 11, 9, 0, 0, tzinfo=UTC)


class FakeEmit:
    def __init__(self):
        self.sent: list[tuple[Event, dict]] = []

    def __call__(self, event, **hooks):
        self.sent.append((event, hooks))


def make(mem, emit):
    return SetupEvents(OpenItems(mem.db, lambda: NOW), emit, lambda: NOW)


def test_setup_event_survives_restart(tmp_path):
    mem = Memory(tmp_path / "t.db")
    emit = FakeEmit()
    event = Event("setup_done", {"expert": "claude", "ok": True}, key="claude")
    make(mem, emit).emit(event)
    assert emit.sent[0][0] == event  # passed on at once

    after = FakeEmit()  # the brain restarted before Scout spoke
    make(mem, after).resume()
    [(again, hooks)] = after.sent
    assert (again.kind, again.facts, again.key) == ("setup_done", event.facts, "claude")
    assert "on_start" not in hooks  # a started turn is not yet a told one
    hooks["on_end"]()  # the wake turn finished: the news was told
    third = FakeEmit()
    make(mem, third).resume()
    assert third.sent == []
    mem.close()


def test_a_newer_event_with_the_same_key_replaces_the_saved_one(tmp_path):
    mem = Memory(tmp_path / "t.db")
    events = make(mem, FakeEmit())
    events.emit(Event("setup_login", {"expert": "claude", "ok": False}, key="claude"))
    events.emit(Event("setup_login", {"expert": "claude", "ok": True}, key="claude"))
    after = FakeEmit()
    make(mem, after).resume()
    [(only, _)] = after.sent
    assert only.facts["ok"] is True
    mem.close()


def test_progress_is_not_saved(tmp_path):
    mem = Memory(tmp_path / "t.db")
    emit = FakeEmit()
    make(mem, emit).emit(Event("setup_progress", {"expert": "claude"}, key="claude"))
    assert len(emit.sent) == 1
    after = FakeEmit()
    make(mem, after).resume()
    assert after.sent == []
    mem.close()
