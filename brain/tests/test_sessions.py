"""Checks Session: one running turn, says that join it, cancel, and the always-sent ended.

A fake model stands in for the API; an Event step makes it wait so tests can act mid-turn.
"""

import asyncio
import datetime
import re
from types import SimpleNamespace

import pytest

from brain.bodies import Bodies
from brain.memory import Memory
from brain.mind.resume import rebuild_history
from brain.mind.turn import Final
from brain.protocol import Body, SayParams, Tool
from brain.sessions import Session
from brain.toolbox import BrainSource, ToolSpec


class Gate:
    model_id = "claude-sonnet-5-5"

    def __init__(self, steps):
        self.steps = list(steps)
        self.seen = []
        self.systems = []
        self.tools = []

    async def stream(self, system, messages, tools):
        self.seen.append(list(messages))
        self.systems.append(system)
        self.tools.append(tools)
        step = self.steps.pop(0)
        if isinstance(step, asyncio.Event):
            await step.wait()
            step = self.steps.pop(0)
        if isinstance(step, Final):  # a scripted tool_use step
            yield step
            return
        yield step
        yield Final([{"type": "text", "text": step}], "end_turn", SimpleNamespace())


class Open:
    def allows(self):
        return True

    def spend(self, usage, model):
        pass


def make(model, memory=None):
    sent = []
    bodies = Bodies()
    bodies.notify = lambda m, p: sent.append((m, p))
    now = lambda: datetime.datetime(2026, 1, 1, 9, 0)  # noqa: E731
    return Session(model, Open(), bodies, 10, memory or Memory(":memory:"), now=now), sent


def say(text):
    return SayParams(text=text)


def states(sent):
    return [p["state"] for m, p in sent if m == "turn"]


async def finish(session):
    await session._task


async def test_say_starts_turn():
    session, sent = make(Gate(["hi"]))
    result = session.say("desktop", say("hello"))
    assert result.joined is False
    assert re.fullmatch(r"[0-9a-f]{32}", result.turn)
    await finish(session)
    assert sent[0] == ("turn", {"turn": result.turn, "body": "desktop", "state": "started"})
    assert sent[-1] == (
        "turn",
        {"turn": result.turn, "body": "desktop", "state": "ended", "reason": "done"},
    )
    assert session.history[0] == {"role": "user", "content": [{"type": "text", "text": "hello"}]}


async def test_second_say_joins_running_turn():
    gate = asyncio.Event()
    model = Gate([gate, "one", "two"])
    session, sent = make(model)
    first = session.say("desktop", say("a"))
    second = session.say("extension", say("b"))
    assert second.joined is True and second.turn == first.turn
    gate.set()
    await finish(session)
    last_user = model.seen[-1][-1]
    assert last_user["role"] == "user"
    assert {"type": "text", "text": "b"} in last_user["content"]
    assert states(sent) == ["started", "ended"]


async def test_leftover_inbox_kept_in_history():
    session, sent = make(Gate([asyncio.Event(), "x"]))
    result = session.say("desktop", say("a"))
    await asyncio.sleep(0)
    session.say("desktop", say("late"))
    session.cancel(result.turn)  # stops the turn before it can drain the inbox
    await finish(session)
    assert session.history[-1]["content"][-1] == {"type": "text", "text": "late"}
    assert session.say("desktop", say("next")).joined is False


async def test_leftover_says_come_before_a_newer_say():
    model = Gate(["one", "two"])
    session, sent = make(model)
    session.say("desktop", say("a"))
    await finish(session)
    session._inbox.append([{"type": "text", "text": "old"}])  # joined, but the loop had ended
    # the finished task's done-callback has not run yet when the new say lands
    session._task = asyncio.get_running_loop().create_future()
    session._task.set_result("done")
    session.say("desktop", say("new"))
    await finish(session)
    texts = [b["text"] for b in model.seen[-1][-1]["content"]]
    assert texts == ["old", "new"]
    assert session._inbox == []


async def test_cancel_running_turn():
    session, sent = make(Gate([asyncio.Event(), "never"]))
    result = session.say("desktop", say("a"))
    await asyncio.sleep(0)
    session.cancel(result.turn)
    await finish(session)
    assert sent[-1][1]["state"] == "ended" and sent[-1][1]["reason"] == "cancelled"


async def test_cancel_unknown_is_noop():
    session, sent = make(Gate(["hi"]))
    session.say("desktop", say("a"))
    session.cancel("nope")
    await finish(session)
    assert sent[-1][1]["reason"] == "done"


async def test_new_say_after_end_starts_new_turn():
    session, sent = make(Gate(["one", "two"]))
    first = session.say("desktop", say("a"))
    await finish(session)
    second = session.say("desktop", say("b"))
    await finish(session)
    assert second.joined is False and second.turn != first.turn
    assert states(sent) == ["started", "ended", "started", "ended"]


async def test_empty_say_raises():
    session, _ = make(Gate([]))
    with pytest.raises(ValueError):
        session.say("desktop", SayParams(text=None, parts=[]))


async def test_say_after_task_finished_but_before_callback_starts_new_turn():
    session, sent = make(Gate(["one", "two"]))
    first = session.say("desktop", say("a"))
    await asyncio.wait({session._task})  # done; the done-callback may not have run yet
    second = session.say("desktop", say("b"))
    assert second.joined is False and second.turn != first.turn
    await finish(session)
    assert states(sent).count("ended") == 2


async def test_leftover_inbox_merges_into_last_user_message():
    session, _ = make(Gate([asyncio.Event(), "x"]))
    result = session.say("desktop", say("a"))
    await asyncio.sleep(0)
    session.say("desktop", say("late"))
    session.cancel(result.turn)
    await finish(session)
    assert [m["role"] for m in session.history] == ["user"]
    assert session.history[0]["content"] == [
        {"type": "text", "text": "a"},
        {"type": "text", "text": "late"},
    ]


async def test_cancel_right_after_say():
    session, sent = make(Gate(["never"]))
    result = session.say("desktop", say("a"))
    session.cancel(result.turn)
    await finish_quietly(session)
    assert states(sent) == ["started", "ended"]
    assert sent[-1][1]["reason"] == "cancelled"
    assert session.say("desktop", say("b")).joined is False


async def finish_quietly(session):
    task = session._task
    await asyncio.wait({task})
    await asyncio.sleep(0)  # let the done-callback run


def remember_call(text):
    block = {
        "type": "tool_use",
        "id": "t1",
        "name": "remember",
        "input": {"kind": "instruction", "text": text},
    }
    return Final([block], "tool_use", SimpleNamespace())


async def test_turn_sends_memory_tools():
    model = Gate(["hi"])
    session, _ = make(model)
    session.say("desktop", say("hello"))
    await finish(session)
    assert [t["name"] for t in model.tools[0]] == ["forget", "recall", "remember"]  # sorted


async def test_what_you_know_in_system_prompt():
    memory = Memory(":memory:")
    memory.remember("instruction", "answer in French")
    model = Gate(["hi"])
    session, _ = make(model, memory)
    session.say("desktop", say("hello"))
    await finish(session)
    assert "What you know" in model.systems[0] and "answer in French" in model.systems[0]


async def test_know_read_once_per_turn():
    memory = Memory(":memory:")
    model = Gate([remember_call("be brief"), "ok", "again"])
    session, _ = make(model, memory)
    session.say("desktop", say("hello"))
    await finish(session)
    assert model.systems[0] == model.systems[1]
    assert "be brief" not in model.systems[0]
    session.say("desktop", say("next"))
    await finish(session)
    assert "be brief" in model.systems[2]


async def test_remember_tool_round_trip():
    memory = Memory(":memory:")
    model = Gate([remember_call("be brief"), "ok"])
    session, _ = make(model, memory)
    session.say("desktop", say("hello"))
    await finish(session)
    assert [i.text for i in memory.always_loaded()["instruction"]] == ["be brief"]
    result = session.history[2]["content"][0]
    assert result["type"] == "tool_result" and "is_error" not in result


async def test_joined_say_does_not_refresh_know():
    memory = Memory(":memory:")
    gate = asyncio.Event()
    model = Gate([gate, remember_call("be brief"), "ok"])
    session, _ = make(model, memory)
    session.say("desktop", say("a"))
    memory.remember("instruction", "added mid-turn")
    session.say("desktop", say("b"))
    gate.set()
    await finish(session)
    assert model.systems[0] == model.systems[1]
    assert "added mid-turn" not in model.systems[0]


# --- saved chat: save at turn end, resume on start, summaries from compaction ---


def file_memory(tmp_path):
    return Memory(tmp_path / "t.db")


async def test_turn_end_saves_new_messages(tmp_path):
    memory = file_memory(tmp_path)
    session, _ = make(Gate(["one", "two"]), memory)
    session.say("desktop", say("a"))
    await finish_quietly(session)
    assert [m["role"] for m in memory.load_messages()] == ["user", "assistant"]
    session.say("desktop", say("b"))
    await finish_quietly(session)
    assert [m["role"] for m in memory.load_messages()] == ["user", "assistant"] * 2


async def test_cancelled_turn_is_saved_valid(tmp_path):
    memory = file_memory(tmp_path)
    call = Final(
        [{"type": "tool_use", "id": "t1", "name": "recall", "input": {"query": "x"}}],
        "tool_use",
        SimpleNamespace(),
    )
    running = asyncio.Event()

    async def blocked(args):
        running.set()
        await asyncio.Event().wait()

    session, _ = make(Gate([call, "never"]), memory)
    stuck = ToolSpec("recall", "blocks", {"type": "object"}, effect="read")
    session.toolbox.sources[:] = [BrainSource([(stuck, blocked)])]
    result = session.say("desktop", say("a"))
    await running.wait()  # the cancel lands while the tool is running
    session.cancel(result.turn)
    await finish_quietly(session)
    rows = memory.load_messages()
    assert rows == session.history
    assert rows[-1]["content"][0]["type"] == "tool_result"
    assert rows[-1]["content"][0]["content"] == "cancelled"


async def test_late_says_are_saved(tmp_path):
    memory = file_memory(tmp_path)
    session, _ = make(Gate([asyncio.Event(), "x"]), memory)
    result = session.say("desktop", say("a"))
    await asyncio.sleep(0)
    session.say("desktop", say("late"))
    session.cancel(result.turn)
    await finish_quietly(session)
    saved = memory.load_messages()
    assert saved[-1]["content"][-1] == {"type": "text", "text": "late"}


async def test_resume_after_restart(tmp_path):
    first, _ = make(Gate(["one"]), file_memory(tmp_path))
    first.say("desktop", say("a"))
    await finish_quietly(first)
    model = Gate(["two"])
    second, _ = make(model, file_memory(tmp_path))
    assert second.history == first.history
    second.say("desktop", say("b"))
    await finish_quietly(second)
    assert model.seen[0][0] == first.history[0]
    assert len(model.seen[0]) == 3


def compaction_final():
    return Final(
        [{"type": "compaction", "content": "We planned Lisbon"}, {"type": "text", "text": "ok"}],
        "end_turn",
        SimpleNamespace(),
    )


async def test_compaction_block_becomes_summary_item_and_replays(tmp_path):
    memory = file_memory(tmp_path)
    session, _ = make(Gate([compaction_final()]), memory)
    session.say("desktop", say("trip"))
    await finish_quietly(session)
    assert [h.kind for h in memory.search("lisbon", kind="summary")] == ["summary"]
    model = Gate(["next"])
    second, _ = make(model, file_memory(tmp_path))
    assert second.history[0]["content"] == [{"type": "text", "text": "trip"}]
    second.say("desktop", say("more"))
    await finish_quietly(second)
    sent = model.seen[0][1]["content"]
    assert sent[0] == {"type": "compaction", "content": "We planned Lisbon"}


async def test_same_compaction_not_summarised_twice_after_restart(tmp_path):
    memory = file_memory(tmp_path)
    session, _ = make(Gate([compaction_final()]), memory)
    session.say("desktop", say("trip"))
    await finish_quietly(session)
    second, _ = make(Gate(["next"]), file_memory(tmp_path))
    second.say("desktop", say("more"))
    await finish_quietly(second)
    assert len(memory.search("lisbon", kind="summary")) == 1


async def test_persist_failure_does_not_block_ended(tmp_path, caplog):
    memory = file_memory(tmp_path)
    real = memory.save_messages

    def boom(messages):
        raise RuntimeError("disk full")

    memory.save_messages = boom
    session, sent = make(Gate(["one", "two"]), memory)
    session.say("desktop", say("a"))
    await finish_quietly(session)
    assert states(sent) == ["started", "ended"]
    assert "could not save the chat" in caplog.text
    memory.save_messages = real
    session.say("desktop", say("b"))
    await finish_quietly(session)
    assert len(memory.load_messages()) == 4


async def test_cancelled_result_added_on_resume_is_stored(tmp_path):
    memory = file_memory(tmp_path)
    memory.save_messages(
        [
            {"role": "user", "content": [{"type": "text", "text": "a"}]},
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": "t1", "name": "recall", "input": {}}],
            },
        ]
    )
    session, _ = make(Gate(["one"]), memory)
    session.say("desktop", say("b"))
    await finish_quietly(session)
    rebuilt = rebuild_history(file_memory(tmp_path).load_messages())
    for i, m in enumerate(rebuilt):
        if m["role"] == "assistant" and isinstance(m["content"], list):
            ids = [b["id"] for b in m["content"] if b.get("type") == "tool_use"]
            assert not ids or i + 1 < len(rebuilt)
            answered = [b.get("tool_use_id") for b in rebuilt[i + 1]["content"]] if ids else []
            assert all(x in answered for x in ids)
    stored = memory.load_messages()
    assert stored[2]["content"][0]["tool_use_id"] == "t1"


async def test_no_merge_into_saved_message(tmp_path):
    memory = file_memory(tmp_path)
    memory.save_messages([{"role": "user", "content": [{"type": "text", "text": "old"}]}])
    session, _ = make(Gate(["one"]), memory)
    assert len(session.history) == 1
    session.say("desktop", say("new"))
    assert [m["role"] for m in session.history] == ["user", "user"]
    assert session.history[0]["content"] == [{"type": "text", "text": "old"}]
    await finish_quietly(session)


async def test_body_tools_offered_then_gone_after_disconnect():
    class Peer:
        def send(self, frame):
            pass

    peer = Peer()

    class Leaving(Gate):
        async def stream(self, system, messages, tools):
            async for item in super().stream(system, messages, tools):
                if len(self.tools) == 1:  # the body leaves during step 1
                    session._bodies.disconnect("desktop", peer)
                yield item

    model = Leaving([remember_call("x"), "done"])
    session, _ = make(model)
    tool = Tool(name="see_screen", description="d", input_schema={"type": "object"})
    body = Body(id="desktop", kind="desktop", name="Desktop")
    session._bodies.connect(body, [tool], peer, None)
    session.say("desktop", say("hi"))
    await finish_quietly(session)
    first = [t["name"] for t in model.tools[0]]
    second = [t["name"] for t in model.tools[1]]
    assert first == ["forget", "recall", "remember", "desktop__see_screen"]
    assert second == ["forget", "recall", "remember"]


async def test_session_answer_passes_text_to_the_ask():
    session, _ = make(Gate([]))
    session._bodies.online_ids = lambda: ["desktop"]
    task = asyncio.create_task(session._asks.open(text="Which?", options=["a"], free_text=True))
    await asyncio.sleep(0)
    ask_id = session.open_asks()[0]["id"]
    session.answer(ask_id, "typed", "desktop", text="my words")
    answer = await task
    assert (answer.option, answer.text) == ("typed", "my words")
