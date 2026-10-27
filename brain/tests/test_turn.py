"""Checks the thinking loop with a scripted fake model: streaming, tools, queued says, ends.

No network: each fake step is a list of text deltas plus a Final. The history rules matter most
(append-only, never a dangling tool_use), so cancellation paths assert on the exact messages.
"""

import asyncio
import datetime
from types import SimpleNamespace

from brain.guardrails import Budget
from brain.mind.turn import AnthropicModel, Call, Final, _request, run_turn


def text_step(text="hi", stop="end_turn", deltas=None):
    content = [{"type": "text", "text": text}]
    return (deltas if deltas is not None else [text]), Final(content, stop, SimpleNamespace())


def tool_step(*calls, stop="tool_use", text=None, tool_input=None):
    content = [{"type": "text", "text": text}] if text else []
    content += [
        {"type": "tool_use", "id": i, "name": n, "input": tool_input or {}} for i, n in calls
    ]
    return [], Final(content, stop, SimpleNamespace())


class FakeModel:
    model_id = "claude-sonnet-5-5"

    def __init__(self, steps):
        self.steps = list(steps)
        self.calls = 0
        self.tools_seen = []

    async def stream(self, system, messages, tools):
        self.calls += 1
        self.tools_seen.append(tools)
        step = self.steps.pop(0)
        if isinstance(step, Exception):
            raise step
        deltas, final = step
        for d in deltas:
            yield d
        if final is not None:
            yield final


class Spend:
    def __init__(self, allows=True):
        self._allows = allows
        self.spent = []

    def allows(self):
        return self._allows

    def spend(self, usage, model):
        self.spent.append(model)


async def ok_tool(call):
    return [{"type": "text", "text": f"ran {call.name}"}]


def start(
    model, history, sent, *, run_tool=ok_tool, tools=None, inbox=None, budget=None, step_cap=10
):
    return run_turn(
        turn_id="t1",
        body_id="desktop",
        model=model,
        system=lambda: "sys",
        history=history,
        tools=tools or (lambda: []),
        run_tool=run_tool,
        inbox=inbox if inbox is not None else [],
        notify=lambda m, p: sent.append((m, p)),
        budget=budget or Spend(),
        step_cap=step_cap,
    )


async def go(steps, **kw):
    sent = []
    history = [{"role": "user", "content": "go"}]
    model = FakeModel(steps)
    reason = await start(model, history, sent, **kw)
    return reason, history, sent, model


async def test_plain_answer_streams_and_finishes():
    reason, history, sent, _ = await go([text_step("hello", deltas=["hel", "lo"])])
    assert reason == "done"
    assert sent == [
        ("reply", {"turn": "t1", "body": "desktop", "delta": "hel"}),
        ("reply", {"turn": "t1", "body": "desktop", "delta": "lo"}),
        ("reply", {"turn": "t1", "body": "desktop", "done": True}),
    ]
    assert history[1:] == [{"role": "assistant", "content": [{"type": "text", "text": "hello"}]}]


async def test_tools_run_concurrently_and_results_are_one_message():
    a, b = asyncio.Event(), asyncio.Event()

    async def tool(call):
        mine, other = (a, b) if call.name == "one" else (b, a)
        mine.set()
        await asyncio.wait_for(other.wait(), 1)  # only finishes if both run at once
        return [{"type": "text", "text": call.name}]

    reason, history, sent, _ = await go(
        [tool_step(("c1", "one"), ("c2", "two")), text_step("ok")], run_tool=tool
    )
    assert reason == "done"
    assert history[2] == {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": "c1",
                "content": [{"type": "text", "text": "one"}],
            },
            {
                "type": "tool_result",
                "tool_use_id": "c2",
                "content": [{"type": "text", "text": "two"}],
            },
        ],
    }
    tools = [p for m, p in sent if m == "tool"]
    assert {"turn": "t1", "call": "c1", "name": "one", "state": "started"} in tools
    assert {"turn": "t1", "call": "c2", "name": "two", "state": "ended", "ok": True} in tools
    assert history[3]["role"] == "assistant"


async def test_raising_tool_gives_error_result():
    async def boom(call):
        raise RuntimeError("nope")

    reason, history, sent, _ = await go([tool_step(("c1", "x")), text_step("ok")], run_tool=boom)
    assert reason == "done"
    assert history[2]["content"] == [
        {
            "type": "tool_result",
            "tool_use_id": "c1",
            "content": [{"type": "text", "text": "nope"}],
            "is_error": True,
        }
    ]
    ended = {"turn": "t1", "call": "c1", "name": "x", "state": "ended", "ok": False}
    assert ("tool", ended) in sent


async def test_say_queued_during_tools_follows_results():
    inbox = []

    async def tool(call):
        inbox.append([{"type": "text", "text": "also this"}])
        return []

    _, history, _, _ = await go(
        [tool_step(("c1", "x")), text_step("ok")], run_tool=tool, inbox=inbox
    )
    assert history[2]["content"][0]["type"] == "tool_result"
    assert history[2]["content"][-1] == {"type": "text", "text": "also this"}
    assert inbox == []


async def test_say_queued_after_end_turn_runs_another_step():
    inbox = [[{"type": "text", "text": "wait"}]]
    reason, history, sent, model = await go([text_step("a"), text_step("b")], inbox=inbox)
    assert reason == "done"
    assert model.calls == 2
    assert history[2] == {"role": "user", "content": [{"type": "text", "text": "wait"}]}
    assert [p for _, p in sent if p.get("done")] == [
        {"turn": "t1", "body": "desktop", "done": True}
    ]


async def test_pause_turn_continues_without_user_message():
    reason, history, _, model = await go([text_step("a", stop="pause_turn"), text_step("b")])
    assert reason == "done"
    assert model.calls == 2
    assert [m["role"] for m in history] == ["user", "assistant", "assistant"]


async def test_refusal_is_error():
    reason, _, sent, _ = await go([text_step("no", stop="refusal")])
    assert reason == "error"
    assert len(dones(sent)) == 1  # a delta went out, so the reply is closed


async def test_model_exception_is_error_and_appends_nothing():
    reason, history, _, _ = await go([RuntimeError("down")])
    assert reason == "error"
    assert len(history) == 1


async def test_step_cap():
    steps = [tool_step(("c1", "x")), tool_step(("c2", "x")), text_step("never")]
    reason, _, _, model = await go(steps, step_cap=2)
    assert reason == "step_cap"
    assert model.calls == 2


async def test_over_budget_makes_no_call():
    reason, history, _, model = await go([text_step()], budget=Spend(allows=False))
    assert reason == "over_budget"
    assert model.calls == 0
    assert len(history) == 1


async def test_budget_spent_each_step_with_model_id():
    budget = Spend()
    await go([tool_step(("c1", "x")), text_step()], budget=budget)
    assert budget.spent == ["claude-sonnet-5-5"] * 2


async def test_real_budget_works(tmp_path):
    budget = Budget(tmp_path / "b.json", 5.0, today=lambda: datetime.date(2026, 10, 25))
    reason, *_ = await go([text_step()], budget=budget)
    assert reason == "done"


async def test_cancel_while_streaming_appends_nothing():
    started = asyncio.Event()

    class Slow(FakeModel):
        async def stream(self, system, messages, tools):
            started.set()
            await asyncio.sleep(10)
            yield "never"

    history = [{"role": "user", "content": "go"}]
    sent = []
    task = asyncio.create_task(start(Slow([]), history, sent))
    await started.wait()
    task.cancel()
    assert await task == "cancelled"
    assert len(history) == 1
    assert not any(p.get("done") for _, p in sent)


async def test_cancel_while_tools_run_closes_history():
    started = asyncio.Event()
    cancelled = []

    async def hang(call):
        started.set()
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.append(call.name)
            raise

    history = [{"role": "user", "content": "go"}]
    sent = []
    model = FakeModel([tool_step(("c1", "x"), ("c2", "y"))])
    task = asyncio.create_task(start(model, history, sent, run_tool=hang))
    await started.wait()
    task.cancel()
    assert await task == "cancelled"
    assert history[-1] == {
        "role": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": i, "content": "cancelled", "is_error": True}
            for i in ("c1", "c2")
        ],
    }
    ended = [p for m, p in sent if m == "tool" and p["state"] == "ended"]
    assert sorted(p["call"] for p in ended) == ["c1", "c2"]
    assert all(p["ok"] is False for p in ended)
    assert sorted(cancelled) == ["x", "y"]


def test_request_has_the_constants():
    kw = _request("m", "sys", [{"role": "user", "content": "x"}], [])
    assert kw["thinking"] == {"type": "adaptive"}
    assert kw["output_config"] == {"effort": "medium"}
    assert kw["max_tokens"] == 64000
    assert kw["betas"] == ["compact-2026-01-12", "server-side-fallback-2026-07-01"]
    assert kw["context_management"] == {"edits": [{"type": "compact_20260112"}]}
    assert kw["fallbacks"] == "default"
    assert "tools" not in kw
    assert not {"temperature", "top_p", "top_k"} & kw.keys()
    assert _request("m", "s", [], [{"name": "t"}])["tools"] == [{"name": "t"}]


def test_anthropic_model_constructs():
    assert AnthropicModel(object(), "claude-sonnet-5-5").model_id == "claude-sonnet-5-5"


def dones(sent):
    return [p for _, p in sent if p.get("done")]


async def test_silent_turn_sends_no_done():
    reason, _, sent, _ = await go([text_step("x", deltas=[])])
    assert reason == "done"
    assert sent == []


async def test_done_sent_once_after_deltas_on_step_cap():
    steps = [(["hi"], tool_step(("c1", "x"))[1]), text_step("never")]
    reason, _, sent, _ = await go(steps, step_cap=1)
    assert reason == "step_cap"
    assert len(dones(sent)) == 1


async def test_done_sent_once_after_deltas_on_error():
    class Breaks(FakeModel):
        async def stream(self, system, messages, tools):
            yield "partial"
            raise RuntimeError("down")

    sent = []
    history = [{"role": "user", "content": "go"}]
    assert await start(Breaks([]), history, sent) == "error"
    assert len(dones(sent)) == 1
    assert len(history) == 1


async def test_done_sent_once_after_deltas_on_cancel():
    started = asyncio.Event()

    class Slow(FakeModel):
        async def stream(self, system, messages, tools):
            yield "partial"
            started.set()
            await asyncio.sleep(10)

    sent = []
    task = asyncio.create_task(start(Slow([]), [{"role": "user", "content": "go"}], sent))
    await started.wait()
    task.cancel()
    assert await task == "cancelled"
    assert len(dones(sent)) == 1


async def test_max_tokens_with_tool_use_is_closed():
    step = tool_step(("c1", "x"), stop="max_tokens")
    reason, history, _, model = await go([step])
    assert reason == "done"
    assert model.calls == 1
    assert history[-1]["content"] == [
        {"type": "tool_result", "tool_use_id": "c1", "content": "cancelled", "is_error": True}
    ]


async def test_stream_without_final_is_error():
    reason, history, _, _ = await go([(["hi"], None)])
    assert reason == "error"
    assert len(history) == 1


async def test_tool_use_stop_without_blocks_is_end_turn():
    reason, history, _, model = await go([text_step("a", stop="tool_use")])
    assert reason == "done"
    assert model.calls == 1
    assert len(history) == 2


async def test_final_model_prices_the_answering_model():
    budget = Spend()
    final = Final(
        [{"type": "text", "text": "hi"}], "end_turn", SimpleNamespace(), "claude-haiku-5-5"
    )
    await go([(["hi"], final)], budget=budget)
    assert budget.spent == ["claude-haiku-5-5"]


async def test_unexpected_exception_closes_history_and_sends_done():
    class Boom(Spend):
        def spend(self, usage, model):
            raise OSError("disk full")

    steps = [(["partial"], tool_step(("c1", "x"))[1])]
    reason, history, sent, _ = await go(steps, budget=Boom())
    assert reason == "error"
    assert history[-1]["content"][0]["type"] == "tool_result"
    assert history[-1]["content"][0]["tool_use_id"] == "c1"
    assert len(dones(sent)) == 1


async def test_tools_are_asked_for_at_every_step():
    lists = iter([[{"name": "a"}], [{"name": "a"}, {"name": "b"}]])
    _, _, _, model = await go([tool_step(("c1", "a")), text_step()], tools=lambda: next(lists))
    assert [t["name"] for t in model.tools_seen[0]] == ["a"]
    assert [t["name"] for t in model.tools_seen[1]] == ["a", "b"]


async def test_run_tool_gets_a_call_with_turn_and_step_text():
    seen = []

    async def tool(call):
        seen.append(call)
        return "ok"

    step = tool_step(("c1", "x"), text="Looking now.", tool_input={"q": 1})
    await go([step, text_step()], run_tool=tool)
    assert seen == [Call("c1", "x", {"q": 1}, "t1", "Looking now.")]


async def test_tool_result_blocks_pass_through():
    async def tool(call):
        return [{"type": "text", "text": "hi"}]

    _, history, _, _ = await go([tool_step(("c1", "x")), text_step()], run_tool=tool)
    assert history[2]["content"][0]["content"] == [{"type": "text", "text": "hi"}]
