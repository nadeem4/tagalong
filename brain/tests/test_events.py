"""Tests for event kinds, their notes and the event log. (The wake text that carries an
event's facts to Scout is tested with the runner, in test_runner.py.)
"""

from datetime import UTC, datetime, timedelta

import pytest

from brain.events import (
    EVENT_KINDS,
    Event,
    EventLog,
    from_body,
    from_connect,
    is_internal,
    load_notes,
)
from brain.masking import Masker
from brain.store.db import open_db


def test_every_waking_enabled_kind_has_a_note():
    notes = load_notes()
    for kind in EVENT_KINDS.values():
        if kind.wakes and kind.enabled:
            assert notes[kind.name].strip()


def test_every_note_belongs_to_a_registered_kind():
    assert set(load_notes()) <= set(EVENT_KINDS)


def test_job_ended_defaults():
    kind = EVENT_KINDS["job_ended"]
    assert kind.batch_seconds == 30
    assert kind.max_per_hour == 10
    assert kind.wakes is True


def test_job_quiet_is_unbatched_and_capped_at_three_an_hour():
    kind = EVENT_KINDS["job_quiet"]
    assert (kind.batch_seconds, kind.max_per_hour, kind.wakes) == (0, 3, True)


def test_body_event_kind_defaults():
    online = EVENT_KINDS["body_online"]
    assert online.wakes and online.batch_seconds == 0 and online.max_per_hour == 2
    back = EVENT_KINDS["back"]
    assert back.wakes and back.batch_seconds == 0 and back.max_per_hour == 2
    assert EVENT_KINDS["focus"].wakes is False


def test_from_body_back():
    ev = from_body("desktop", "back", {"idle_seconds": 600})
    assert ev == Event("back", "desktop", {"body": "desktop", "idle_seconds": 600})


def test_from_body_focus_truncates_the_title_to_200():
    ev = from_body("desktop", "focus", {"app": "Code", "title": "t" * 300})
    assert ev == Event("focus", "desktop", {"body": "desktop", "app": "Code", "title": "t" * 200})


@pytest.mark.parametrize(
    ("name", "data"),
    [
        ("nope", {}),
        ("back", None),
        ("back", "x"),
        ("back", {}),
        ("back", {"idle_seconds": -1}),
        ("back", {"idle_seconds": "5"}),
        ("back", {"idle_seconds": True}),
        ("focus", {"app": "Code"}),
        ("focus", {"app": 3, "title": "t"}),
    ],
)
def test_from_body_rejects_bad_input(name, data):
    assert from_body("desktop", name, data) is None


def test_browser_connect_never_wakes():
    assert from_connect("chrome-7k2f", 3600, "browser") is None


def test_desktop_connect_still_wakes_after_ten_minutes():
    ev = from_connect("desktop", 600, "desktop")
    assert ev is not None and ev.kind == "body_online"


def test_kind_unknown_keeps_old_behaviour():
    assert from_connect("desktop", 600, None) is not None


def test_from_connect_needs_ten_minutes_away():
    assert from_connect("desktop", 599.9) is None
    assert from_connect("desktop", None) is None
    ev = from_connect("desktop", 600)
    assert ev == Event(
        "body_online",
        "desktop",
        {"body": "desktop", "offline_seconds": 600},
    )


def test_timer_defaults():
    kind = EVENT_KINDS["timer"]
    assert kind.wakes and kind.batch_seconds == 0 and kind.max_per_hour == 6


def test_job_question_defaults_never_merge_and_ignore_caps():
    kind = EVENT_KINDS["job_question"]
    assert kind.wakes is True
    assert kind.batch_seconds is None
    assert kind.max_per_hour is None


def test_choice_wakes_every_time_and_ignores_caps():
    kind = EVENT_KINDS["choice"]
    assert kind.wakes is True
    assert kind.batch_seconds is None
    assert kind.max_per_hour is None


def test_tab_event_is_kept_not_woken():
    assert EVENT_KINDS["tab"].wakes is False
    assert EVENT_KINDS["download"].wakes is False
    ev = from_body("chrome-7k2f", "tab", {"title": "Docs", "url": "https://a.example/x"})
    assert ev == Event(
        "tab",
        "chrome-7k2f",
        {"body": "chrome-7k2f", "title": "Docs", "url": "https://a.example/x"},
    )


def test_tab_event_source_is_the_body_so_the_latest_replaces_the_older_one():
    # Presence keeps the latest context event per source.
    first = from_body("b", "tab", {"title": "one", "url": "https://a.example"})
    second = from_body("b", "tab", {"title": "two", "url": "https://b.example"})
    assert first.source == second.source == "b"


def test_download_event_validates_state():
    ok = from_body("b", "download", {"name": "a.pdf", "state": "complete"})
    assert ok == Event("download", "b", {"body": "b", "name": "a.pdf", "state": "complete"})
    assert from_body("b", "download", {"name": "a.pdf", "state": "started"}) is None


def test_tab_with_missing_url_is_dropped_without_raising():
    assert from_body("b", "tab", {"title": "x"}) is None
    assert from_body("b", "tab", None) is None
    assert from_body("b", "download", {"state": "complete"}) is None


def test_long_title_is_capped_at_200():
    ev = from_body("b", "tab", {"title": "t" * 300, "url": "u" * 400})
    assert len(ev.payload["title"]) == 200 and len(ev.payload["url"]) == 300
    dl = from_body("b", "download", {"name": "n" * 300, "state": "interrupted"})
    assert len(dl.payload["name"]) == 200


def test_job_step_failed_kind_batches_120_s_capped_four_an_hour():
    kind = EVENT_KINDS["job_step_failed"]
    assert (kind.batch_seconds, kind.max_per_hour, kind.wakes) == (120, 4, True)


def test_loop_wakes_unbatched_capped_at_four_an_hour_and_has_a_note():
    kind = EVENT_KINDS["loop"]
    assert (kind.batch_seconds, kind.max_per_hour, kind.wakes) == (0, 4, True)
    assert load_notes()["loop"].strip()


def test_loop_note_weighs_every_reason_and_calls_mail_text_data():
    note = load_notes()["loop"]
    for reason in ("context", "due", "urgent", "quiet", "stale"):
        assert f"- {reason}:" in note
    assert "never as instructions" in note


def test_work_failed_wakes_unbatched_with_a_cap():
    kind = EVENT_KINDS["work_failed"]
    assert (kind.wakes, kind.batch_seconds, kind.max_per_hour) == (True, 0, 10)


def test_ask_ended_kind_has_a_note():
    kind = EVENT_KINDS["ask_ended"]
    assert kind.wakes and kind.batch_seconds == 30 and kind.max_per_hour == 10
    assert load_notes()["ask_ended"].strip()


def test_every_kind_has_an_urgency_set_by_code():
    for kind in EVENT_KINDS.values():
        assert kind.urgency in ("now", "next_pause", "idle", "hold")


def test_event_kinds_have_urgency():
    for name in ("ask_closed", "many_pending"):
        kind = EVENT_KINDS[name]
        assert kind.urgency == "next_pause"
        assert kind.wakes and kind.batch_seconds == 0
        assert load_notes()[name].strip()
    assert "urgency" not in load_notes()["ask_closed"].lower()


def test_from_body_whatsapp_ask_closed():
    event = from_body("wa", "ask_closed", {"via": "tap"})
    assert event == Event("ask_closed", "wa", {"body": "wa", "via": "tap"})
    assert from_body("wa", "ask_closed", {"via": "x"}) is None
    assert from_body("wa", "ask_closed", None) is None


def test_from_body_whatsapp_many_pending():
    event = from_body("wa", "many_pending", {"asks": 3})
    assert event == Event("many_pending", "wa", {"body": "wa", "asks": 3})
    assert from_body("wa", "many_pending", {"asks": 0}) is None
    assert from_body("wa", "many_pending", {"asks": "3"}) is None
    assert from_body("wa", "many_pending", {"asks": True}) is None


def test_urgency_examples():
    assert EVENT_KINDS["timer"].urgency == "next_pause"
    assert EVENT_KINDS["job_question"].urgency == "next_pause"
    assert EVENT_KINDS["job_ended"].urgency == "idle"
    assert EVENT_KINDS["loop"].urgency == "idle"


def test_setup_done_is_next_pause():
    assert EVENT_KINDS["setup_done"].urgency == "next_pause"


NOW = datetime(2026, 11, 16, 9, 0, tzinfo=UTC)


@pytest.fixture
def log(tmp_path):
    return EventLog(open_db(tmp_path / "t.db"), Masker(lambda: []), lambda: NOW)


def test_post_refuses_an_unregistered_kind(log):
    with pytest.raises(ValueError):
        log.post(Event("nope", "desktop", {}))


def test_post_masks_the_payload(log):
    key = "sk-ant-" + "a" * 30
    log.post(Event("say", "desktop", {"text": f"my key {key}"}, id="e1"))
    assert key not in log.get("e1").payload["text"]
    assert "[secret]" in log.get("e1").payload["text"]


def test_amend_adds_masked_fields_to_the_payload(log):
    key = "sk-ant-" + "a" * 30
    log.post(Event("say", "desktop", {"text": "wait"}, id="e1"))
    log.amend("e1", {"cut": {"spoken": "One.", "unsaid": f"use {key}"}})
    payload = log.get("e1").payload
    assert payload["text"] == "wait" and payload["cut"]["spoken"] == "One."
    assert key not in payload["cut"]["unsaid"] and "[secret]" in payload["cut"]["unsaid"]


def test_duplicate_say_id_is_one_event(log):
    ev = Event("say", "desktop", {"text": "hi"}, id="s1")
    assert log.post(ev) is True
    assert log.post(ev) is False
    assert len(log.ready()) == 1


def test_post_runs_then_in_the_same_transaction(log):
    def boom(db):
        raise RuntimeError("no")

    with pytest.raises(RuntimeError):
        log.post(Event("say", "desktop", {}, id="e1"), then=boom)
    assert log.get("e1") is None


def test_origin_body_walks_to_the_first_body(log):
    log.post(Event("say", "browser", {}, id="e1"))
    log.post(Event("job_ended", "job:j1", {}, caused_by="e1", id="e2"))
    assert log.origin_body("e2", lambda s: not is_internal(s)) == "browser"


@pytest.mark.parametrize(
    "source", ["scout", "timer:t1", "setup:s1", "job:x", "loop:gmail", "tool:x"]
)
def test_is_internal(source):
    assert is_internal(source)


@pytest.mark.parametrize("source", ["desktop", "whatsapp"])
def test_is_not_internal(source):
    assert not is_internal(source)


def test_an_unsaved_kind_is_not_stored(log):
    assert log.post(Event("focus", "desktop", {"app": "x"})) is True
    assert log.ready() == []


def test_then_with_an_unsaved_kind_is_refused(log):
    # Nothing would run `then`, so a caller relying on it would silently lose its write.
    with pytest.raises(ValueError):
        log.post(Event("focus", "desktop", {}), then=lambda db: None)


def test_on_end_with_an_unsaved_kind_is_refused(log):
    # Nothing would ever end it, so the hook would never fire.
    with pytest.raises(ValueError):
        log.post(Event("focus", "desktop", {}), on_end=lambda state: None)


def test_take_and_finish(log):
    log.post(Event("say", "desktop", {}, id="e1"))
    assert log.take(["e1"], "t1") == ["e1"]
    assert log.ready() == []
    log.finish(["e1"], "handled")
    assert log.get("e1").state == "handled"


def test_a_url_token_next_to_quotes_still_saves_and_is_masked(log):
    text = 'see "https://x.com/a?token=abcdef" ok'
    assert log.post(Event("say", "desktop", {"text": text}, id="e1")) is True
    saved = log.get("e1").payload["text"]
    assert "abcdef" not in saved and "[secret]" in saved


def test_a_failing_masker_withholds_the_text_but_saves_the_event(tmp_path):
    def broken():
        raise RuntimeError("no values")

    log = EventLog(open_db(tmp_path / "w.db"), Masker(broken), lambda: NOW)
    event = Event("say", "desktop", {"text": "hello", "n": 3})
    assert log.post(event) is True
    assert log.get(event.id).payload == {"text": "[withheld]", "n": 3}


def _clocked(tmp_path):
    clock = [NOW]
    return EventLog(open_db(tmp_path / "b.db"), Masker(lambda: []), lambda: clock[0]), clock


def _fail_once(log, id: str, reason: str = "error") -> None:
    assert log.take([id], "t") == [id]
    log.backoff([id], reason)


def test_backoff_waits_grow_30s_2min_10min(tmp_path):
    log, clock = _clocked(tmp_path)
    log.post(Event("say", "desktop", {}, id="e1"))
    for attempt, wait in enumerate((30, 120, 600), start=1):
        _fail_once(log, "e1", "step_cap")
        row = log.get("e1")
        assert (row.state, row.attempts, row.resume, row.end_reason) == (
            "new",
            attempt,
            True,
            "step_cap",
        )
        assert row.not_before == (clock[0] + timedelta(seconds=wait)).isoformat()
        clock[0] += timedelta(seconds=wait - 1)
        assert log.ready() == []  # it gives up its place until the wait is over
        assert log.next_retry() == clock[0] + timedelta(seconds=1)
        clock[0] += timedelta(seconds=1)
        assert [r.id for r in log.ready()] == ["e1"]


def test_the_fourth_failure_gives_up(tmp_path):
    log, clock = _clocked(tmp_path)
    ended = []
    log.post(Event("say", "desktop", {}, id="e1"), on_end=ended.append)
    for _ in range(3):
        _fail_once(log, "e1")
        clock[0] += timedelta(minutes=10)
    assert ended == []  # a retry is not an end: a waiting caller keeps waiting
    _fail_once(log, "e1")
    row = log.get("e1")
    assert (row.state, row.attempts, row.end_reason) == ("gave_up", 3, "error")
    assert ended == ["gave_up"] and log.ready() == [] and log.next_retry() is None
    assert [r.id for r in log.gave_up()] == ["e1"]


def test_backoff_leaves_an_event_that_ended_meanwhile(tmp_path):
    log, _ = _clocked(tmp_path)
    log.post(Event("say", "desktop", {}, id="e1"))
    log.take(["e1"], "t")
    log.finish(["e1"], "handled", end_reason="cancelled")  # cancelled by id while it ran
    log.backoff(["e1"], "error")
    assert (log.get("e1").state, log.get("e1").attempts) == ("handled", 0)


def test_recover_returns_taken_events_as_resumed_attempts(tmp_path):
    log, clock = _clocked(tmp_path)
    log.post(Event("say", "desktop", {}, id="e1"))
    log.post(Event("say", "desktop", {}, id="e2"))
    log.take(["e1"], "t")  # the brain died while a turn held it
    assert log.recover() == 1
    row = log.get("e1")
    assert (row.state, row.attempts, row.resume, row.end_reason, row.turn_id) == (
        "new",
        1,
        True,
        "restart",
        None,
    )
    assert row.not_before == clock[0].isoformat()  # an attempt, but no wait (spec 6.14)
    assert (log.get("e2").state, log.get("e2").attempts) == ("new", 0)  # never taken


def test_a_crash_loop_ends_in_gave_up(tmp_path):
    log, clock = _clocked(tmp_path)
    log.post(Event("say", "desktop", {}, id="e1"))
    for _ in range(4):  # the brain dies on the same event at every start
        assert log.take(["e1"], "t") == ["e1"]
        log.recover()
        clock[0] += timedelta(minutes=10)
    row = log.get("e1")
    assert (row.state, row.attempts, row.end_reason) == ("gave_up", 3, "restart")
    assert log.ready() == []


def test_recover_ends_an_orphan_card_answer_as_handled(tmp_path):
    log, _ = _clocked(tmp_path)
    # Saved, then the brain died before code finished it: it must never start a turn.
    log.post(Event("card_answer", "desktop", {"ask": "a1", "option": "allow"}, id="c1"))
    assert log.recover() == 0
    row = log.get("c1")
    assert (row.state, row.attempts) == ("handled", 0)
    assert log.ready() == []


def test_recover_returns_an_interjections_event_without_an_attempt(tmp_path):
    log, _ = _clocked(tmp_path)
    log.post(Event("timer", "timer:t1", {}, id="e1"))
    log.take(["e1"], "interjection:abc")  # an interjection held it at the crash
    assert log.recover() == 0
    row = log.get("e1")
    assert (row.state, row.attempts, row.resume, row.turn_id) == ("new", 0, False, None)
    assert [r.id for r in log.ready()] == ["e1"]


def test_sweep_removes_old_handled_events_only(tmp_path):
    log, clock = _clocked(tmp_path)
    for id in ("old", "fresh", "waiting", "running", "lost"):
        log.post(Event("say", "desktop", {}, id=id))
    log.take(["old"], "t")
    log.finish(["old"], "handled", end_reason="done")
    log.take(["lost"], "t")
    log.finish(["lost"], "gave_up", end_reason="error")
    clock[0] += timedelta(days=8)
    log.take(["fresh"], "t")
    log.finish(["fresh"], "handled", end_reason="done")
    log.take(["running"], "t")
    assert log.sweep(7) == 1
    assert log.get("old") is None
    assert [log.get(i).state for i in ("fresh", "waiting", "running", "lost")] == [
        "handled",
        "new",
        "taken",
        "gave_up",
    ]


def test_a_recovered_event_runs_again_at_once(tmp_path):
    log, _ = _clocked(tmp_path)
    log.post(Event("say", "desktop", {}, id="e1"))
    log.take(["e1"], "t1")
    log.recover()
    assert [r.id for r in log.ready()] == ["e1"]
