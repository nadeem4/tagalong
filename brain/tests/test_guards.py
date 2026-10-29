"""Checks the guard runner: ordering, verdict precedence, failure handling and the log line.

Guards are the brain's one place for refusals, so the precedence rules (block beats ask,
raise means block, rewrite feeds the next guard) must hold for both run and run_sync.
"""

import logging

from brain.guards import (
    ALLOW,
    Guard,
    Guards,
    Hook,
    ModelCallCtx,
    SaveCtx,
    ToolCallCtx,
    allow_once,
    ask,
    block,
    rewrite,
    stop,
)

MODEL = ModelCallCtx(kind="turn", turn_id=None, steps=0)


def make(*guards):
    g = Guards()
    for x in guards:
        g.add(x)
    return g


async def test_guards_run_in_registration_order():
    seen = []

    def a(ctx):
        seen.append("a")
        return ALLOW

    def b(ctx):
        seen.append("b")
        return ALLOW

    v = await make(Guard("a", Hook.model_call, a), Guard("b", Hook.model_call, b)).run(
        Hook.model_call, MODEL
    )
    assert seen == ["a", "b"] and v.kind == "allow"


async def test_first_block_short_circuits_later_guards():
    seen = []

    def later(ctx):
        seen.append("later")
        return ALLOW

    g = make(
        Guard("first", Hook.model_call, lambda c: block("no", "denied")),
        Guard("later", Hook.model_call, later),
    )
    v = await g.run(Hook.model_call, MODEL)
    assert v.kind == "block" and v.code == "denied" and v.guard == "first" and not seen


async def test_stop_short_circuits_and_keeps_code():
    g = make(Guard("s", Hook.model_call, lambda c: stop("over", "over_budget")))
    v = await g.run(Hook.model_call, MODEL)
    assert v.kind == "stop" and v.code == "over_budget"


async def test_block_beats_ask():
    g = make(
        Guard("a", Hook.tool_call, lambda c: ask("sure?")),
        Guard("b", Hook.tool_call, lambda c: block("never")),
    )
    assert (await g.run(Hook.tool_call, None)).kind == "block"


async def test_ask_when_only_asks():
    g = make(Guard("a", Hook.tool_call, lambda c: ask("sure?")))
    v = await g.run(Hook.tool_call, None)
    assert v.kind == "ask" and v.reason == "sure?"


async def test_rewrite_feeds_the_next_guard():
    seen = []

    def upper(ctx):
        return rewrite(ctx.text.upper())

    def check(ctx):
        seen.append(ctx.text)
        return ALLOW

    g = make(Guard("u", Hook.save, upper), Guard("c", Hook.save, check))
    v = await g.run(Hook.save, SaveCtx(what="chat", text="hi"))
    assert seen == ["HI"] and v.kind == "rewrite" and v.value == "HI"


async def test_allow_once_short_circuits_on_ask_hook():
    seen = []

    def later(ctx):
        seen.append(1)
        return ask("x")

    g = make(Guard("a", Hook.ask, lambda c: allow_once("fine")), Guard("b", Hook.ask, later))
    v = await g.run(Hook.ask, None)
    assert v.kind == "allow" and v.once and not seen


async def test_allow_once_counts_as_allow_elsewhere():
    seen = []

    def later(ctx):
        seen.append(1)
        return ALLOW

    g = make(
        Guard("a", Hook.tool_call, lambda c: allow_once("fine")), Guard("b", Hook.tool_call, later)
    )
    v = await g.run(Hook.tool_call, None)
    assert v.kind == "allow" and seen == [1]


async def test_raising_guard_is_block_with_code_error():
    def boom(ctx):
        raise RuntimeError("secret detail")

    async def aboom(ctx):
        raise RuntimeError("secret detail")

    for fn in (boom, aboom):
        v = await make(Guard("x", Hook.tool_call, fn)).run(Hook.tool_call, None)
        assert v.kind == "block" and v.code == "error"
        assert "secret detail" not in v.reason and v.reason


async def test_non_verdict_return_is_block_with_one_log_line(caplog):
    caplog.set_level(logging.INFO, logger="brain.guardrails")
    g = make(Guard("x", Hook.tool_call, lambda c: None))
    v = await g.run(Hook.tool_call, None)
    assert v.kind == "block" and v.code == "error"
    assert len([r for r in caplog.records if r.name == "brain.guardrails"]) == 1
    caplog.clear()
    v = g.run_sync(Hook.tool_call, None)
    assert v.kind == "block" and v.code == "error"
    assert len([r for r in caplog.records if r.name == "brain.guardrails"]) == 1


async def test_rewrite_on_ctx_without_text_is_block():
    g = make(Guard("x", Hook.model_call, lambda c: rewrite("z")))
    v = await g.run(Hook.model_call, MODEL)
    assert v.kind == "block" and v.code == "error"


async def test_raising_guard_logs_class_name_not_message(caplog):
    caplog.set_level(logging.INFO, logger="brain.guardrails")

    def boom(ctx):
        raise RuntimeError("secret detail")

    await make(Guard("x", Hook.tool_call, boom)).run(Hook.tool_call, None)
    assert "guard failed (RuntimeError)" in caplog.text
    assert "secret detail" not in caplog.text


def test_run_sync_rejects_async_guard_as_block():
    async def a(ctx):
        return ALLOW

    v = make(Guard("x", Hook.save, a)).run_sync(Hook.save, SaveCtx(what="log", text="t"))
    assert v.kind == "block" and v.code == "error"


def test_run_sync_works_for_sync_guards():
    g = make(Guard("x", Hook.save, lambda c: rewrite("z")))
    assert g.run_sync(Hook.save, SaveCtx(what="log", text="t")).value == "z"


async def test_no_guards_for_hook_is_allow():
    assert (await Guards().run(Hook.emit, None)).kind == "allow"


async def test_guard_for_other_hook_never_runs():
    def bad(ctx):
        raise AssertionError("ran")

    assert (await make(Guard("x", Hook.emit, bad)).run(Hook.save, None)).kind == "allow"


async def test_one_log_line_per_refusal(caplog):
    caplog.set_level(logging.INFO, logger="brain.guardrails")
    ctx = ModelCallCtx(kind="turn", turn_id="t1", steps=0)
    for name, fn in [
        ("b", lambda c: block("nope")),
        ("s", lambda c: stop("done", "step_cap")),
        ("a", lambda c: ask("hmm")),
    ]:
        caplog.clear()
        await make(Guard(name, Hook.model_call, fn)).run(Hook.model_call, ctx)
        kind = {"b": "block", "s": "stop", "a": "ask"}[name]
        reason = {"b": "nope", "s": "done", "a": "hmm"}[name]
        assert [r.getMessage() for r in caplog.records] == [
            f"guard={name} hook=model_call verdict={kind} reason={reason} turn=t1"
        ]
    caplog.clear()
    await make(
        Guard("ok", Hook.save, lambda c: ALLOW), Guard("rw", Hook.save, lambda c: rewrite("x"))
    ).run(Hook.save, SaveCtx(what="chat", text="t"))
    assert caplog.records == []


async def test_log_line_omits_turn_when_unknown(caplog):
    caplog.set_level(logging.INFO, logger="brain.guardrails")
    await make(Guard("b", Hook.model_call, lambda c: block("nope"))).run(Hook.model_call, MODEL)
    assert [r.getMessage() for r in caplog.records] == [
        "guard=b hook=model_call verdict=block reason=nope"
    ]


async def test_log_never_contains_tool_input(caplog):
    caplog.set_level(logging.INFO, logger="brain.guardrails")
    ctx = ToolCallCtx(
        spec=None, input={"secret": "hunter2"}, caller="scout", source_kind="user", turn_id="t1"
    )
    await make(Guard("b", Hook.tool_call, lambda c: block("not allowed"))).run(Hook.tool_call, ctx)
    assert "hunter2" not in caplog.text and caplog.records
