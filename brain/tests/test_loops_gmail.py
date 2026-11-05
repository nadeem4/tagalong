"""Tests for the Gmail source: the adapter against the fake MCP server over real Apps, and the
service reading a fake mailbox end to end (3 unanswered, 1 answered, 1 bulk gives 3 loops)."""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from test_apps import Rig, stdio_row, until

from brain.apps import AppError
from brain.guardrails import Budget
from brain.loops.reader import HaikuReader
from brain.loops.service import LoopService
from brain.loops.sources.gmail import GmailSource
from brain.loops.store import LoopStore
from brain.mind.turn import Final

NOW = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)


def msg(mid, sender, hours_ago, labels, body="Can you send it?", headers=None):
    return {
        "id": mid,
        "from": sender,
        "subject": f"subject {mid}",
        "date": (NOW - timedelta(hours=hours_ago)).isoformat(),
        "body": body,
        "labels": labels,
        "headers": headers or {},
    }


class Spy:
    """Wraps Apps.call to record which tools the loops code reaches for."""

    def __init__(self, apps):
        self._apps = apps
        self.tools = []

    async def call(self, app_id, tool, args, timeout=60):
        self.tools.append(tool)
        return await self._apps.call(app_id, tool, args, timeout)


@pytest.fixture
async def make():
    rigs = []

    def build(rows, **kw):
        rig = Rig(rows, **kw)
        rigs.append(rig)
        return rig

    yield build
    for rig in rigs:
        await rig.apps.shutdown()


@pytest.fixture
def gmail(make, tmp_path):
    async def build(threads):
        path = tmp_path / "mail.json"
        path.write_text(json.dumps({"threads": threads}), encoding="utf-8")
        rig = make([stdio_row("gmail", env={"FAKE_MAIL_FILE": str(path)})])
        await rig.apps.start()
        await rig.up("gmail")
        return rig, Spy(rig.apps)

    return build


THREADS = [
    {"id": "t1", "messages": [msg("m1", "Priya <p@x.com>", 30, ["INBOX"])]},
    {
        "id": "t2",  # answered: the person's own message is last
        "messages": [
            msg("m2", "Sam <s@x.com>", 40, ["INBOX"]),
            msg("m3", "me@x.com", 20, ["SENT"]),
        ],
    },
    {"id": "t3", "messages": [msg("m4", "Lee <l@x.com>", 5, ["INBOX"])]},
    {"id": "t4", "messages": [msg("m5", "me@x.com", 3, ["SENT"])]},
]


async def test_matches_needs_the_read_and_draft_tools(gmail):
    rig, _ = await gmail(THREADS)
    assert GmailSource.matches({t.name for t in rig.apps.tools("gmail")})
    assert not GmailSource.matches({"echo", "read_note"})


async def test_new_items_after_a_time_carry_their_fields(gmail):
    _, spy = await gmail(THREADS)
    items = await GmailSource("gmail", spy.call).new_items(NOW - timedelta(hours=35))
    assert sorted(i.thread for i in items) == ["t1", "t3"]  # t2's inbound is older than 35 h
    first = next(i for i in items if i.thread == "t1")
    assert first.sender == "Priya <p@x.com>" and first.subject == "subject m1"
    assert first.app == "gmail" and not first.sent and first.date == NOW - timedelta(hours=30)


async def test_unanswered_only_skips_a_thread_whose_last_message_is_mine(gmail):
    _, spy = await gmail(THREADS)
    items = await GmailSource("gmail", spy.call).new_items(
        NOW - timedelta(days=14), unanswered_only=True
    )
    assert sorted(i.thread for i in items) == ["t1", "t3"]


async def test_sent_items_are_the_persons_own(gmail):
    _, spy = await gmail(THREADS)
    items = await GmailSource("gmail", spy.call).sent_items(NOW - timedelta(days=14))
    assert sorted(i.thread for i in items) == ["t2", "t4"]
    assert all(i.sent for i in items)


async def test_missing_fields_are_tolerated(gmail):
    bare = {"id": "m", "date": NOW.isoformat(), "labels": ["INBOX"]}
    _, spy = await gmail([{"id": "t9", "messages": [bare]}])
    items = await GmailSource("gmail", spy.call).new_items(NOW - timedelta(days=1))
    assert len(items) == 1 and items[0].subject == "" and items[0].body == ""


async def test_draft_reply_uses_only_the_draft_tool(gmail):
    _, spy = await gmail(THREADS)
    await GmailSource("gmail", spy.call).draft_reply("t1", "Thanks, on it.")
    assert spy.tools == ["create_draft"]


async def test_the_adapter_refuses_a_tool_outside_its_set(gmail):
    _, spy = await gmail(THREADS)
    with pytest.raises(AppError):
        await GmailSource("gmail", spy.call)._call("send_message", {})
    assert spy.tools == []


# --- the service over the fake mailbox ---


class CountingModel:
    model_id = "claude-haiku-5-5"
    ready = True

    def __init__(self):
        self.calls = 0

    async def stream(self, system, messages, tools):
        self.calls += 1
        block = {
            "type": "tool_use",
            "id": "x",
            "name": "loop_change",
            "input": {"kind": "new", "title": f"loop {self.calls}", "asks": "reply"},
        }
        yield Final([block], "tool_use", SimpleNamespace(input_tokens=10, output_tokens=5))


async def test_three_unanswered_one_answered_one_bulk_yield_three_loops(gmail, tmp_path):
    bulk = msg("m6", "News <n@x.com>", 2, ["INBOX"], headers={"List-Unsubscribe": "<x>"})
    threads = [
        *THREADS,
        {"id": "t5", "messages": [bulk]},
        {"id": "t6", "messages": [msg("m7", "Kim <k@x.com>", 1, ["INBOX"])]},
    ]
    rig, spy = await gmail(threads)
    model = CountingModel()
    reader = HaikuReader(model, Budget(tmp_path / "b.json", 1.0))
    store = LoopStore(rig.memory.db, lambda: NOW)
    svc = LoopService(store, lambda e: None, lambda: NOW, reader, poll_s=3600)
    svc.enable("gmail", GmailSource("gmail", spy.call))
    await until(lambda: store.cursor("gmail") is not None)
    svc.disable("gmail")
    assert len(store.list()) == 3  # t1, t3 and t6; t2 answered, t4 mine, t5 bulk
    assert model.calls == 3  # the bulk mail never reached the model
    assert set(spy.tools) <= {"search_threads", "get_thread", "create_draft"}
