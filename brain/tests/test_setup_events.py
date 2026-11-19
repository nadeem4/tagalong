"""Setup events: a finished install or login is an event in the log, which keeps it until a turn
handles it, so a restart or a spent budget does not lose the news. No open item copies it.
"""

from datetime import UTC, datetime

from brain.events import Event, EventLog
from brain.masking import Masker
from brain.memory import Memory
from brain.open_items import OpenItems
from brain.setup.events import SetupEvents
from brain.tasks import Tasks

NOW = datetime(2026, 11, 11, 9, 0, 0, tzinfo=UTC)


def make(mem):
    log = EventLog(mem.db, Masker(lambda: []), lambda: NOW)
    tasks = Tasks(mem.db, lambda text: text, lambda: NOW)
    own = lambda source, title: tasks.open("own", source, title=title)  # noqa: E731
    return SetupEvents(log.post, log.finish_matching, own), log


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

    setup = SetupEvents(log.post, crash, lambda source, title: None)
    event = Event("setup_done", "setup:claude", {"expert": "claude", "ok": True})
    try:
        setup.emit(event)
    except RuntimeError:
        pass
    assert [r.id for r in log.ready()] == [event.id]  # posted before the older one is ended
    mem.close()


def test_a_setup_suggestion_is_an_own_task_done_when_told(tmp_path):
    mem = Memory(tmp_path / "t.db")
    setup, log = make(mem)
    tasks = Tasks(mem.db, lambda text: text, lambda: NOW)
    event = Event("setup_done", "setup:claude", {"expert": "claude", "ok": True})
    setup.emit(event)
    [row] = log.ready()
    own = tasks.get(row.task)
    assert (own.kind, own.state, own.source, own.title) == (
        "own", "open", "setup:claude", "claude",
    )  # fmt: skip
    log.finish([event.id], "handled")  # a turn told it
    assert tasks.settle() == [own.id] and tasks.get(own.id).state == "done"
    mem.close()


def test_a_setup_event_for_a_persons_request_keeps_their_task(tmp_path):
    mem = Memory(tmp_path / "t.db")
    setup, log = make(mem)
    mine = Tasks(mem.db, lambda text: text, lambda: NOW).open("do", "desktop")
    setup.emit(Event("setup_done", "setup:claude", {"expert": "claude"}, task=mine))
    [row] = log.ready()
    assert row.task == mine
    assert mem.db.execute("SELECT COUNT(*) FROM tasks WHERE kind='own'").fetchone()[0] == 0
    mem.close()
