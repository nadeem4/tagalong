"""Tests for JobActivity: ACP updates become masked, capped, persisted activity entries."""

from datetime import UTC, datetime, timedelta

import acp
import pytest
from acp import schema

from brain import job_activity
from brain.guards import Guards
from brain.job_activity import JobActivity
from brain.masking import Masker, mask_json, mask_secrets
from brain.memory import ActivityEntry, Memory

SECRET = "fake-token-12345678"


class Rig:
    def __init__(self, tmp_path, mask=None) -> None:
        self.memory = Memory(tmp_path / "t.db")
        self.changes = 0
        self.log = JobActivity(
            "j",
            self.memory,
            mask or (lambda t: t.replace("SECRETVALUE1", "[secret]")),
            lambda: datetime(2026, 1, 1, tzinfo=UTC),
            on_change=self._changed,
        )

    def _changed(self) -> None:
        self.changes += 1

    def rows(self):
        return sorted(self.memory.activity_after("j", 0, 10_000), key=lambda e: e.seq)


@pytest.fixture
def rig(tmp_path):
    r = Rig(tmp_path)
    yield r
    r.memory.close()


def start(id, title="Run", kind="execute", **kw):
    return acp.start_tool_call(id, title, kind=kind, status="in_progress", **kw)


def progress(id, status="completed", text=None, **kw):
    content = [acp.tool_content(acp.text_block(text))] if text is not None else None
    return acp.update_tool_call(id, status=status, content=content, **kw)


def test_command_start_then_finish_updates_one_entry_in_place(rig):
    rig.log.on_update(start("t1", raw_input={"command": "npm init -y"}))
    [cmd] = rig.rows()
    assert (cmd.kind, cmd.status, cmd.text, cmd.step) == ("command", "running", "npm init -y", "t1")
    rig.log.on_update(progress("t1", "completed", "ok"))
    cmd2, out = rig.rows()
    assert (cmd2.seq, cmd2.status, cmd2.rev > cmd.rev) == (cmd.seq, "done", True)
    assert (out.kind, out.text, out.step) == ("output", "ok", "t1")


def test_output_is_one_entry_per_step_replaced_in_place(rig):
    rig.log.on_update(start("t1", raw_input={"command": "ls"}))
    rig.log.on_update(progress("t1", "in_progress", "a"))
    rig.log.on_update(progress("t1", "completed", "ab"))
    assert [e.text for e in rig.rows() if e.kind == "output"] == ["ab"]


def test_failed_status_is_kept(rig):
    rig.log.on_update(start("t1", raw_input={"command": "false"}))
    rig.log.on_update(progress("t1", "failed"))
    assert rig.rows()[0].status == "failed"


def test_edit_read_search_other_kinds(rig):
    loc = [schema.ToolCallLocation(path="src/a.ts")]
    rig.log.on_update(start("e", "Edit a", kind="edit", locations=loc))
    rig.log.on_update(start("r", "Read b", kind="read"))
    rig.log.on_update(start("s", "Grep c", kind="search"))
    rig.log.on_update(start("o", "Fetch d", kind="fetch"))
    got = [(e.kind, e.text) for e in rig.rows()]
    assert got == [
        ("edit", "edited src/a.ts"),
        ("read", "Read b"),
        ("search", "Grep c"),
        ("other", "Fetch d"),
    ]


def test_unknown_kind_and_missing_raw_input_do_not_crash(rig):
    rig.log.on_update(start("t1", "Thinking hard", kind="think"))
    rig.log.on_update(start("t2", "Run it", kind="execute"))
    assert [(e.kind, e.text) for e in rig.rows()] == [
        ("other", "Thinking hard"),
        ("command", "Run it"),
    ]


def test_progress_for_unknown_step_creates_it(rig):
    rig.log.on_update(progress("late", "completed", "out", title="Run x", kind="execute"))
    assert [(e.kind, e.status) for e in rig.rows()] == [("command", "done"), ("output", None)]


def test_say_one_entry_per_message_id_and_capped(rig):
    chunk = schema.AgentMessageChunk(
        session_update="agent_message_chunk", content=acp.text_block("Hel"), message_id="m1"
    )
    rig.log.on_update(chunk)
    rig.log.on_update(chunk.model_copy(update={"content": acp.text_block("lo")}))
    rig.log.on_update(chunk.model_copy(update={"message_id": "m2"}))
    assert [(e.kind, e.text) for e in rig.rows()] == [("say", "Hello"), ("say", "Hel")]
    big = chunk.model_copy(update={"message_id": "m3", "content": acp.text_block("x" * 20_000)})
    rig.log.on_update(big)
    assert len(rig.rows()[-1].text) == job_activity.SAY_CAP


def test_plan_replaced_in_place(rig):
    one = acp.update_plan([acp.plan_entry("a"), acp.plan_entry("b")])
    two = acp.update_plan([acp.plan_entry("a", status="completed"), acp.plan_entry("b")])
    rig.log.on_update(one)
    rig.log.on_update(two)
    [plan] = rig.rows()
    assert (plan.kind, plan.text) == ("plan", "[x] a\n[ ] b")


def test_end_entries(tmp_path):
    for state, reason, text in [
        ("done", "end_turn", "# done"),
        ("error", "boom", "# error: boom"),
        ("stopped", "stopped", "# stopped"),
    ]:
        r = Rig(tmp_path / state)
        r.log.end(state, reason)
        [end] = r.rows()
        assert (end.kind, end.text) == ("end", text)
        assert r.changes == 1
        r.memory.close()


def test_secret_in_output_is_masked_in_the_stored_row(rig):
    rig.log.on_update(start("t1", raw_input={"command": "echo SECRETVALUE1"}))
    rig.log.on_update(progress("t1", "completed", "key=SECRETVALUE1"))
    assert [e.text for e in rig.rows()] == ["echo [secret]", "key=[secret]"]


def test_real_masker_hides_a_secret_in_a_message(tmp_path):
    guards = Guards()
    guards.add(mask_secrets(Masker(lambda: [SECRET])))
    r = Rig(tmp_path, mask=lambda t: mask_json(guards, "job_activity", t))
    r.log.on_update(acp.update_agent_message_text(f"use {SECRET} now"))
    assert r.rows()[0].text == "use [secret] now"
    r.memory.close()


def test_output_over_cap_keeps_the_tail_behind_a_marker(rig):
    rig.log.on_update(start("t1", raw_input={"command": "cat big"}))
    rig.log.on_update(progress("t1", "completed", "é" * 200_000))
    text = rig.rows()[-1].text
    head, body = text.split("\n", 1)
    assert head == "[earlier output cut]"
    assert len(body.encode()) <= job_activity.OUTPUT_CAP
    assert set(body) == {"é"}


def test_job_caps_drop_oldest_output_first(rig, monkeypatch):
    monkeypatch.setattr(job_activity, "ENTRY_CAP", 5)
    monkeypatch.setattr(job_activity, "JOB_BYTES_CAP", 2000)
    for n in range(6):
        rig.log.on_update(start(f"t{n}", raw_input={"command": f"c{n}"}))
        rig.log.on_update(progress(f"t{n}", "completed", "o" * 600))
    rows = rig.rows()
    assert rows[0].text == "[older steps dropped]" and rows[0].seq == 0
    assert len(rows) - 1 <= 5
    assert sum(len(e.text.encode()) for e in rows) <= 2000 + 100


def test_on_change_called_once_per_update(rig):
    rig.log.on_update(start("t1", raw_input={"command": "ls"}))
    rig.log.on_update(progress("t1", "completed", "x"))  # writes two rows, one change
    assert rig.changes == 2
    rig.log.on_update(
        schema.UserMessageChunk(session_update="user_message_chunk", content=acp.text_block("hi"))
    )
    assert rig.changes == 2


def test_running_step_is_the_latest_running_command(rig):
    assert rig.log.running_step() is None
    rig.log.on_update(start("t1", raw_input={"command": "ls"}))
    assert rig.log.running_step().text == "ls"
    rig.log.on_update(progress("t1", "completed"))
    assert rig.log.running_step() is None


def test_running_step_counts_a_pending_tool_call(rig):
    rig.log.on_update(start("t1", raw_input={"command": "ls"}))
    rig.log.on_update(
        acp.start_tool_call(
            "t2", "Run", kind="execute", status="pending", raw_input={"command": "pwd"}
        )
    )
    assert rig.log.running_step().text == "pwd"  # the latest of running and pending
    rig.log.on_update(progress("t1", "completed"))
    rig.log.on_update(progress("t2", "completed"))
    assert rig.log.running_step() is None


def test_idless_messages_around_a_tool_call_are_separate_says(rig):
    def chunk(t):
        return schema.AgentMessageChunk(
            session_update="agent_message_chunk", content=acp.text_block(t)
        )

    rig.log.on_update(chunk("before "))
    rig.log.on_update(chunk("more"))
    rig.log.on_update(start("t1", raw_input={"command": "ls"}))
    rig.log.on_update(chunk("after"))
    assert [(e.kind, e.text) for e in rig.rows()] == [
        ("say", "before more"),
        ("command", "ls"),
        ("say", "after"),
    ]


def test_latest_plan_survives_trim_after_an_in_place_update(rig, monkeypatch):
    monkeypatch.setattr(job_activity, "ENTRY_CAP", 3)
    rig.log.on_update(acp.update_plan([acp.plan_entry("a")]))
    for n in range(3):
        rig.log.on_update(start(f"r{n}", kind="read", title=f"r{n}"))
    rig.log.on_update(acp.update_plan([acp.plan_entry("a", status="completed")]))
    assert [e.text for e in rig.rows() if e.kind == "plan"] == ["[x] a"]


def test_end_marks_open_steps_failed_when_stopped_or_errored(tmp_path):
    for state, failed in [("stopped", True), ("error", True), ("done", False)]:
        r = Rig(tmp_path / state)
        r.log.on_update(start("t1", raw_input={"command": "ls"}))
        r.log.on_update(start("t2", raw_input={"command": "pwd"}))
        r.log.on_update(progress("t2", "completed"))
        r.log.end(state, "why")
        rows = r.rows()
        assert [e.status for e in rows if e.kind == "command"] == [
            "failed" if failed else "running",
            "done",
        ]
        assert rows[-1].kind == "end"
        r.memory.close()


def meta_update(id, **meta):
    u = acp.update_tool_call(id)
    u.field_meta = meta
    return u


def out(id, data, delta=False, tid=None):
    key = "terminal_output_delta" if delta else "terminal_output"
    return meta_update(id, **{key: {"terminal_id": tid or id, "data": data}})


def exited(id, code, signal=None, tid=None):
    exit_meta = {"terminal_id": tid or id, "exit_code": code, "signal": signal}
    return meta_update(id, terminal_exit=exit_meta)


def outputs(rig):
    return [e for e in rig.rows() if e.kind == "output"]


def test_terminal_output_replaces_the_step_output(rig):
    rig.log.on_update(start("t1", raw_input={"command": "ls"}))
    rig.log.on_update(meta_update("t1", terminal_info={"terminal_id": "t1"}))
    rig.log.on_update(out("t1", "a"))
    rig.log.on_update(out("t1", "b"))
    assert [e.text for e in outputs(rig)] == ["b"]


def test_terminal_id_equals_tool_call_id_maps_output_to_the_command_step(rig):
    rig.log.on_update(start("t1", raw_input={"command": "ls"}))
    rig.log.on_update(out("t1", "x"))
    assert [e.step for e in outputs(rig)] == ["t1"]


def test_terminal_delta_appends_in_order(rig):
    rig.log.on_update(start("t1"))
    rig.log.on_update(out("t1", "he", delta=True))
    first = outputs(rig)[0].rev
    rig.log.on_update(out("t1", "llo", delta=True))
    [entry] = outputs(rig)
    assert (entry.text, entry.rev > first) == ("hello", True)


def test_secret_split_across_deltas_is_masked(tmp_path):
    r = Rig(tmp_path, mask=Masker(lambda: []).mask)
    r.log.on_update(start("t1"))
    r.log.on_update(out("t1", "key sk-ant-api03-AAAAAAAAAA", delta=True))
    r.log.on_update(out("t1", "AAAAAAAAAAAAAA done", delta=True))
    [entry] = outputs(r)
    assert "[secret]" in entry.text and "sk-ant" not in entry.text
    r.memory.close()


def test_exit_zero_marks_done_and_sets_exit(rig):
    rig.log.on_update(start("t1"))
    rig.log.on_update(exited("t1", 0))
    [cmd] = rig.rows()
    assert (cmd.status, cmd.exit) == ("done", 0)


def test_exit_two_marks_failed_and_a_later_completed_keeps_it(rig):
    rig.log.on_update(start("t1"))
    rig.log.on_update(exited("t1", 2))
    rig.log.on_update(progress("t1", "completed"))
    [cmd] = rig.rows()
    assert (cmd.status, cmd.exit) == ("failed", 2)


def test_signal_exit_marks_failed_without_exit_number(rig):
    rig.log.on_update(start("t1", raw_input={"command": "sleep 9"}))
    rig.log.on_update(exited("t1", None, signal="SIGKILL"))
    [cmd] = rig.rows()
    assert (cmd.status, cmd.exit, cmd.text) == ("failed", None, "sleep 9")


def test_exit_before_output_and_unknown_terminal_id_are_tolerated(rig):
    rig.log.on_update(start("t1"))
    rig.log.on_update(exited("t1", 1))
    rig.log.on_update(out("t1", "late"))
    rig.log.on_update(exited("t1", 1, tid="nope"))
    rig.log.on_update(out("t1", "ghost", tid="nostep"))  # unknown terminal id: no extra step
    assert [e.kind for e in rig.rows()] == ["command", "output"]
    assert rig.rows()[0].exit == 1


def test_delta_output_stays_within_the_cap(rig):
    rig.log.on_update(start("t1"))
    for _ in range(200):
        rig.log.on_update(out("t1", "x" * 1024, delta=True))
    [entry] = outputs(rig)
    assert entry.text.startswith(job_activity.CUT_MARKER)
    assert len(entry.text) <= job_activity.OUTPUT_CAP + len(job_activity.CUT_MARKER) + 1


def _real_rig(tmp_path):
    return Rig(tmp_path, mask=Masker(lambda: []).mask)


KEY = "sk-ant-api03-" + "B" * 40


def test_cut_never_leaves_part_of_a_secret_on_replace(tmp_path):
    rig = _real_rig(tmp_path)
    rig.log.on_update(start("t1"))
    rig.log.on_update(out("t1", "y" * 100 + KEY + "x" * (job_activity.OUTPUT_CAP - 30)))
    [entry] = outputs(rig)
    assert "BBBB" not in entry.text


def test_cut_never_leaves_part_of_a_secret_on_delta(tmp_path):
    rig = _real_rig(tmp_path)
    rig.log.on_update(start("t1"))
    rig.log.on_update(out("t1", "y" * 100 + KEY, delta=True))
    # the head is trimmed at index 130, inside the key
    keep = job_activity.OUTPUT_CAP + job_activity.CARRY
    rig.log.on_update(out("t1", "x" * (keep + 130 - 100 - len(KEY)), delta=True))
    [entry] = outputs(rig)
    assert "BBBB" not in entry.text
    assert entry.text.startswith(job_activity.CUT_MARKER)


def test_raw_output_is_released_after_exit(rig):
    rig.log.on_update(start("t1"))
    rig.log.on_update(out("t1", "hi", delta=True))
    rig.log.on_update(exited("t1", 0))
    assert rig.log._raw == {}


def test_without_meta_a_command_still_completes(rig):
    rig.log.on_update(start("t1"))
    rig.log.on_update(progress("t1", "completed", "ok"))
    [cmd, _out] = rig.rows()
    assert (cmd.status, cmd.exit) == ("done", None)


def test_console_fence_is_stripped_without_the_opt_in(rig):
    rig.log.on_update(start("t1"))
    rig.log.on_update(progress("t1", "completed", "```console\nok\n```"))
    assert [e.text for e in outputs(rig)] == ["ok"]


def test_heartbeats_are_ignored(rig):
    rig.log.on_update(start("t1"))
    before = rig.memory.last_rev("j")
    rig.log.on_update(progress("t1", "in_progress"))
    assert rig.memory.last_rev("j") == before


# --- summary and one-line form (JM2) ---

NOW = datetime(2026, 1, 1, 1, 0, tzinfo=UTC)


def seed(memory, rows):
    """rows: (kind, text, status, step, exit, minutes_ago); seq and rev run in order."""
    for i, (kind, text, status, step, code, ago) in enumerate(rows, 1):
        at = (NOW - timedelta(minutes=ago)).isoformat()
        memory.save_activity("j", ActivityEntry(i, i, at, kind, text, status, step, code))


def cmd(text, step, code=0, status="done", ago=10):
    return ("command", text, status, step, code, ago)


def outrow(text, step):
    return ("output", text, None, step, None, 1)


def test_summary_counts_steps_and_failed_steps(rig):
    seed(
        rig.memory,
        [cmd("a", "1"), cmd("b", "2"), cmd("c", "3", 1, "failed"), cmd("d", "4"), cmd("e", "5")],
    )
    assert "steps: 5, failed: 1" in job_activity.activity_summary(rig.memory, "j", NOW)


def test_summary_lists_a_failed_command_with_exit_and_last_three_output_lines(rig):
    seed(rig.memory, [cmd("npm test", "1", 1, "failed"), outrow("l1\nl2\nl3\nl4\nl5", "1")])
    text = job_activity.activity_summary(rig.memory, "j", NOW)
    assert "failed: npm test (exit 1)" in text
    assert "l3" in text and "l4" in text and "l5" in text
    assert "l2" not in text


def test_summary_lists_the_last_five_commands_with_exit_codes_oldest_first(rig):
    seed(rig.memory, [cmd(f"c{i}", str(i), i % 2) for i in range(1, 8)])
    text = job_activity.activity_summary(rig.memory, "j", NOW)
    recent = text[text.index("recent:") :]
    assert "c1 " not in recent and "c2 " not in recent
    assert recent.index("c3 (exit 1)") < recent.index("c4 (exit 0)") < recent.index("c7 (exit 1)")


def test_summary_names_the_running_step_and_how_long(rig):
    seed(rig.memory, [cmd("npm install", "1", None, "running", 34)])
    text = job_activity.activity_summary(rig.memory, "j", NOW)
    assert "running: npm install, 34 min" in text


def test_summary_for_a_job_with_no_entries_is_one_short_line(rig):
    text = job_activity.activity_summary(rig.memory, "j", NOW)
    assert "\n" not in text and "no activity" in text


def test_summary_is_cut_to_the_cap_on_a_character_boundary(rig):
    seed(rig.memory, [cmd("é" * 10_000, "1", 1, "failed"), outrow("ü" * 10_000, "1")])
    text = job_activity.activity_summary(rig.memory, "j", NOW)
    assert 0 < len(text) <= job_activity.SUMMARY_CAP
    text.encode()  # a clean string: no half character


def test_a_command_with_nonzero_exit_counts_as_failed_even_if_status_is_done(rig):
    seed(rig.memory, [cmd("make", "1", 2, "done")])
    text = job_activity.activity_summary(rig.memory, "j", NOW)
    assert "failed: 1" in text and "failed: make (exit 2)" in text


def test_activity_line_is_one_line_within_line_cap(rig):
    seed(rig.memory, [cmd("x" * 500, "1", 1, "failed"), outrow("a\nb", "1")])
    line = job_activity.activity_line(rig.memory, "j", NOW)
    assert line and "\n" not in line and len(line) <= job_activity.LINE_CAP


def test_activity_line_is_empty_without_entries(rig):
    assert job_activity.activity_line(rig.memory, "j", NOW) == ""


# --- on_failed ---


class FailRig(Rig):
    def __init__(self, tmp_path) -> None:
        super().__init__(tmp_path)
        self.failed: list = []
        self.log = JobActivity(
            "j",
            self.memory,
            lambda t: t,
            lambda: datetime(2026, 1, 1, tzinfo=UTC),
            on_change=self._changed,
            on_failed=self.failed.append,
        )


@pytest.fixture
def frig(tmp_path):
    r = FailRig(tmp_path)
    yield r
    r.memory.close()


def test_on_failed_fires_once_when_a_step_turns_failed(frig):
    frig.log.on_update(start("t1", raw_input={"command": "false"}))
    frig.log.on_update(progress("t1", "failed", "boom"))
    [entry] = frig.failed
    assert entry.text == "false" and entry.status == "failed"


def test_on_failed_does_not_fire_for_a_done_step_with_exit_zero(frig):
    frig.log.on_update(start("t1", raw_input={"command": "ls"}))
    frig.log.on_update(progress("t1", "completed", "ok"))
    frig.log.on_update(exited("t1", 0))
    assert frig.failed == []


def test_on_failed_fires_for_nonzero_exit(frig):
    frig.log.on_update(start("t1", raw_input={"command": "make"}))
    frig.log.on_update(exited("t1", 2))
    [entry] = frig.failed
    assert entry.exit == 2


def test_on_failed_fires_once_per_step_id_across_later_updates(frig):
    frig.log.on_update(start("t1", raw_input={"command": "false"}))
    frig.log.on_update(progress("t1", "failed", "a"))
    frig.log.on_update(progress("t1", "failed", "ab"))
    frig.log.on_update(progress("t1", "completed", "abc"))
    assert len(frig.failed) == 1


def test_on_failed_sees_the_output_written_in_the_same_update(frig):
    frig.log.on_update(start("t1", raw_input={"command": "false"}))
    seen = []
    frig.log._on_failed = lambda e: seen.append(frig.rows()[-1].text)
    frig.log.on_update(progress("t1", "failed", "boom"))
    assert seen == ["boom"]


def test_stopping_a_job_does_not_report_its_open_steps_as_failures(frig):
    frig.log.on_update(start("t1", raw_input={"command": "sleep 9"}))
    frig.log.end("stopped", "")
    assert frig.failed == []
