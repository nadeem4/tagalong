"""Setup events: a finished install or login is an event in the log, which keeps it until a turn
handles it, so a restart or a spent budget does not lose the news. No open item copies it.
"""

from datetime import UTC, datetime

from brain.events import Event, EventLog
from brain.masking import Masker
from brain.memory import Memory
from brain.open_items import OpenItems
from brain.setup.events import SetupEvents

NOW = datetime(2026, 11, 11, 9, 0, 0, tzinfo=UTC)


def make(mem):
    log = EventLog(mem.db, Masker(lambda: []), lambda: NOW)
    return SetupEvents(log.post, log.finish_matching), log


def test_setup_news_is_an_event_not_an_open_item(tmp_path):
    mem = Memory(tmp_path / "t.db")
    setup, log = make(mem)
    event = Event("setup_done", "setup:claude", {"expert": "claude", "ok": True})
    setup.emit(event)
    [row] = log.ready()
    assert (row.id, row.kind, row.source) == (event.id, "setup_done", "setup:claude")
    assert OpenItems(mem.db, lambda: NOW).list_open() == []
    mem.close()


def test_a_newer_event_from_the_same_source_replaces_the_waiting_one(tmp_path):
    mem = Memory(tmp_path / "t.db")
    setup, log = make(mem)
    setup.emit(Event("setup_login", "setup:claude", {"expert": "claude", "ok": False}))
    setup.emit(Event("setup_login", "setup:claude", {"expert": "claude", "ok": True}))
    [only] = log.ready()
    assert only.payload["ok"] is True
    mem.close()


def test_progress_is_not_saved(tmp_path):
    mem = Memory(tmp_path / "t.db")
    setup, log = make(mem)
    setup.emit(Event("setup_progress", "setup:claude", {"expert": "claude"}))
    assert log.ready() == []
    mem.close()


def test_a_crash_while_ending_the_older_event_loses_no_news(tmp_path):
    mem = Memory(tmp_path / "t.db")
    log = EventLog(mem.db, Masker(lambda: []), lambda: NOW)

    def crash(kind, source, **_):
        raise RuntimeError("killed")

    setup = SetupEvents(log.post, crash)
    event = Event("setup_done", "setup:claude", {"expert": "claude", "ok": True})
    try:
        setup.emit(event)
    except RuntimeError:
        pass
    assert [r.id for r in log.ready()] == [event.id]  # posted before the older one is ended
    mem.close()
