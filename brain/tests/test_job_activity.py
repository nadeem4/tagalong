"""Tests for JobActivity: ACP updates become masked, capped, persisted activity entries."""

from datetime import UTC, datetime

import acp
import pytest
from acp import schema

from brain import job_activity
from brain.guards import Guards
from brain.job_activity import JobActivity
from brain.masking import Masker, mask_json, mask_secrets
from brain.memory import Memory

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
