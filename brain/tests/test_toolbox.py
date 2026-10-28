"""Tests for the Toolbox: audience filtering, the 64-char cap and the gate checks in run."""

import asyncio
import json
import logging
from types import SimpleNamespace

import pytest

from brain.asks import Asks
from brain.bodies import Bodies
from brain.mind.turn import Call
from brain.protocol import Body, ErrorCode, RpcError, Tool
from brain.toolbox import BodySource, BrainSource, ToolSpec
from brain.toolbox import Toolbox as RealToolbox


def Toolbox(sources, stored=None, asks=None):
    """A toolbox whose stored modes are a plain dict, as the tests need no database."""
    stored = {} if stored is None else stored
    return RealToolbox(sources, lambda: stored, stored.__setitem__, asks)


def spec(name, audience=("scout",)):
    return ToolSpec(name, f"{name} tool", {"type": "object"}, frozenset(audience))


def call(name):
    return Call(id="c1", name=name, input={}, turn="t1", text="")


class FakeSource:
    def __init__(self, specs, offline=()):
        self._specs = specs
        self.offline = set(offline)
        self.ran = []

    def specs(self):
        return [s for s in self._specs if s.name not in self.offline]

    def known_specs(self):
        return list(self._specs)

    async def run(self, call, tool):
        self.ran.append(tool)
        return f"ran {tool}"

    def unavailable(self, name):
        if name in self.offline:
            return RpcError(ErrorCode.body_offline, f"{name} is offline.")
        return None


def test_model_tools_lists_scout_audience_only():
    box = Toolbox([FakeSource([spec("a"), spec("h", audience={"home"})])])
    assert [t["name"] for t in box.model_tools()] == ["a"]
    assert set(box.model_tools()[0]) == {"name", "description", "input_schema"}


def test_model_tools_brain_first_then_sorted_per_source():
    brain = BrainSource([(spec("zz"), None), (spec("aa"), None)])
    box = Toolbox([brain, FakeSource([spec("y"), spec("b")])])
    assert [t["name"] for t in box.model_tools()] == ["aa", "zz", "b", "y"]


def test_model_tools_rebuilt_each_call():
    source = FakeSource([spec("a")])
    box = Toolbox([source])
    assert len(box.model_tools()) == 1
    source._specs.append(spec("b"))
    assert [t["name"] for t in box.model_tools()] == ["a", "b"]


def test_name_over_64_chars_is_dropped_and_logged(caplog):
    box = Toolbox([FakeSource([spec("x" * 65)])])
    with caplog.at_level(logging.WARNING):
        assert box.model_tools() == []
    assert "too long" in caplog.text


async def test_unknown_name_is_unknown_tool():
    box = Toolbox([FakeSource([spec("a")])])
    with pytest.raises(RpcError) as e:
        await box.run(call("nope"))
    assert e.value.code == ErrorCode.unknown_tool


async def test_home_only_tool_refused_for_scout():
    source = FakeSource([spec("h", audience={"home"})])
    box = Toolbox([source])
    with pytest.raises(RpcError) as e:
        await box.run(call("h"))
    assert e.value.code == ErrorCode.unknown_tool
    assert source.ran == []


async def test_home_caller_may_run_home_tool():
    box = Toolbox([FakeSource([spec("h", audience={"home"})])])
    assert await box.run(call("h"), caller="home") == "ran h"


async def test_source_unavailable_is_reported():
    box = Toolbox([FakeSource([spec("a")], offline={"a"})])
    with pytest.raises(RpcError) as e:
        await box.run(call("a"))
    assert e.value.code == ErrorCode.body_offline


async def test_brain_source_runs_handler_with_input():
    async def handler(args):
        return f"got {args}"

    box = Toolbox([BrainSource([(spec("a"), handler)])])
    c = Call(id="c1", name="a", input={"k": 1}, turn="t1", text="")
    assert await box.run(c) == "got {'k': 1}"


class AutoPeer:
    """A body that answers every use request with `output` (or an error frame)."""

    def __init__(self, bodies, body_id, output):
        self.bodies, self.body_id, self.output = bodies, body_id, output
        self.used = []

    def send(self, frame):
        msg = json.loads(frame)
        self.used.append(msg["params"])
        self.bodies.resolve(
            self.body_id, self, {"id": msg["id"], "result": {"output": self.output}}
        )

    def close(self):
        pass


def connect(bodies, body_id, tools=("see_screen",), output=()):
    peer = AutoPeer(bodies, body_id, list(output))
    decl = [Tool(name=n, description=f"{n} d", input_schema={"type": "object"}) for n in tools]
    bodies.connect(Body(id=body_id, kind="desktop", name=body_id), decl, peer, None)
    return peer


def body_box(bodies):
    return Toolbox([BodySource(bodies)])


def test_specs_prefix_and_list_only_online_bodies():
    bodies = Bodies()
    connect(bodies, "desktop")
    connect(bodies, "extension")
    bodies.disconnect("extension", bodies._online["extension"].peer)
    assert [s.name for s in BodySource(bodies).specs()] == ["desktop__see_screen"]
    assert [t["name"] for t in body_box(bodies).model_tools()] == ["desktop__see_screen"]


async def test_run_sends_plain_name_and_converts_text_and_image():
    bodies = Bodies()
    out = [
        {"type": "text", "text": "hi"},
        {"type": "image", "mime": "image/png", "data": "AAAA"},
    ]
    peer = connect(bodies, "desktop", output=out)
    result = await body_box(bodies).run(
        Call(id="c9", name="desktop__see_screen", input={"x": 1}, turn="t", text="")
    )
    assert peer.used == [{"call": "c9", "tool": "see_screen", "input": {"x": 1}}]
    assert result == [
        {"type": "text", "text": "hi"},
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}},
    ]


async def test_offline_body_tool_is_body_offline():
    bodies = Bodies()
    peer = connect(bodies, "desktop")
    bodies.disconnect("desktop", peer)
    with pytest.raises(RpcError) as e:
        await body_box(bodies).run(call("desktop__x"))
    assert e.value.code == ErrorCode.body_offline
    assert "desktop is not connected right now." in e.value.message


async def test_oversized_part_is_over_limit():
    bodies = Bodies()
    connect(
        bodies, "desktop", output=[{"type": "image", "mime": "image/png", "data": "A" * 7_000_000}]
    )
    with pytest.raises(RpcError) as e:
        await body_box(bodies).run(call("desktop__see_screen"))
    assert e.value.code == ErrorCode.over_limit


async def test_oversized_total_is_over_limit():
    bodies = Bodies()
    big = {"type": "image", "mime": "image/png", "data": "A" * 6_000_000}  # 4.5 MB each
    connect(bodies, "desktop", output=[big] * 5)
    with pytest.raises(RpcError) as e:
        await body_box(bodies).run(call("desktop__see_screen"))
    assert e.value.code == ErrorCode.over_limit


async def test_malformed_output_is_tool_failed():
    bodies = Bodies()
    connect(bodies, "desktop", output=[{"type": "video"}])
    with pytest.raises(RpcError) as e:
        await body_box(bodies).run(call("desktop__see_screen"))
    assert e.value.code == ErrorCode.tool_failed
    assert e.value.message == "body sent a bad result"


def test_body_going_offline_mid_turn_drops_its_tools_from_next_list():
    bodies = Bodies()
    peer = connect(bodies, "desktop")
    box = body_box(bodies)
    assert len(box.model_tools()) == 1
    bodies.disconnect("desktop", peer)
    assert box.model_tools() == []


def mode_spec(name="a", **kw):
    return ToolSpec(name, "d", {"type": "object"}, **kw)


def test_mode_defaults():
    box = Toolbox([])
    assert box.mode(mode_spec(effect="read")) == "auto"
    assert box.mode(mode_spec(effect="change")) == "ask"
    assert box.mode(mode_spec()) == "ask"
    assert box.mode(mode_spec(effect="change", default_mode="auto")) == "auto"
    stored = {"a": "ask"}
    assert Toolbox([], stored).mode(mode_spec(effect="read")) == "ask"
    stored = {"a": "auto"}
    assert Toolbox([], stored).mode(mode_spec(effect="change", default_mode="ask")) == "auto"
    assert Toolbox([], stored).mode(mode_spec(locked=True)) == "ask"


def test_body_tool_without_effect_asks():
    bodies = Bodies()
    connect(bodies, "desktop")
    box = body_box(bodies)
    (s,) = BodySource(bodies).specs()
    assert s.effect == "change" and not s.locked
    assert box.mode(s) == "ask"


def test_body_tool_effect_read_is_auto():
    bodies = Bodies()
    decl = [Tool(name="look", description="d", input_schema={"type": "object"}, effect="read")]
    bodies.connect(
        Body(id="desktop", kind="desktop", name="d"), decl, AutoPeer(bodies, "desktop", []), None
    )
    (s,) = BodySource(bodies).specs()
    assert body_box(bodies).mode(s) == "auto"


def test_body_tool_confirm_true_is_locked():
    bodies = Bodies()
    decl = [Tool(name="rm", description="d", input_schema={"type": "object"}, confirm=True)]
    bodies.connect(
        Body(id="desktop", kind="desktop", name="d"), decl, AutoPeer(bodies, "desktop", []), None
    )
    (s,) = BodySource(bodies).specs()
    assert s.locked
    assert Toolbox([BodySource(bodies)], {"desktop__rm": "auto"}).mode(s) == "ask"


def test_set_mode_saves_and_changes_mode():
    stored = {}
    box = Toolbox([FakeSource([spec("a")])], stored)
    box.set_mode("a", "auto")
    assert stored == {"a": "auto"}
    assert box.mode(box.sources[0].specs()[0]) == "auto"


def test_set_mode_refuses_auto_on_locked():
    locked = ToolSpec("a", "d", {"type": "object"}, locked=True)
    stored = {}
    box = Toolbox([FakeSource([locked])], stored)
    with pytest.raises(RpcError) as e:
        box.set_mode("a", "auto")
    assert e.value.code == ErrorCode.invalid_params
    assert stored == {}
    box.set_mode("a", "ask")  # tightening a locked tool is fine


def test_self_asking_tool_is_auto_even_when_locked_or_stored_ask():
    spec = mode_spec(locked=True, self_asks=True)
    assert Toolbox([], {"a": "ask"}).mode(spec) == "auto"


def test_set_mode_refuses_any_change_on_self_asking_tool():
    stored = {}
    box = Toolbox([FakeSource([mode_spec(self_asks=True)])], stored)
    for mode in ("ask", "auto"):
        with pytest.raises(RpcError) as e:
            box.set_mode("a", mode)
        assert e.value.code == ErrorCode.invalid_params
        assert str(e.value) == "a asks for itself."
    assert stored == {}


def test_set_mode_unknown_tool():
    with pytest.raises(RpcError) as e:
        Toolbox([FakeSource([spec("a")])]).set_mode("nope", "auto")
    assert e.value.code == ErrorCode.unknown_tool


def test_set_mode_bad_mode():
    with pytest.raises(RpcError) as e:
        Toolbox([FakeSource([spec("a")])]).set_mode("a", "maybe")
    assert e.value.code == ErrorCode.invalid_params


# --- gate step 3: ask before an ask-mode tool runs ---------------------------


class AskBodies:
    """Just enough Bodies for Asks: who is online, and the frames sent."""

    def __init__(self, online=("desktop",)):
        self.online = list(online)
        self.sent = []

    def online_ids(self):
        return self.online

    def notify(self, method, params):
        self.sent.append(params)


def opened_asks(bodies):
    return [p for p in bodies.sent if p["state"] == "open"]


async def until(check):
    for _ in range(50):
        if check():
            return
        await asyncio.sleep(0)
    raise AssertionError("condition never became true")


def gated(tool_effect="change", locked=False, online=("desktop",), stored=None, self_asks=False):
    bodies = AskBodies(online)
    source = FakeSource(
        [
            ToolSpec(
                "t",
                "t tool",
                {"type": "object"},
                effect=tool_effect,
                locked=locked,
                self_asks=self_asks,
            )
        ]
    )
    stored = {} if stored is None else stored
    return Toolbox([source], stored, Asks(bodies)), source, bodies, stored


def call_with_text(name, call_id="c1", text="Doing it."):
    return Call(id=call_id, name=name, input={}, turn="t1", text=text)


async def test_auto_tool_runs_without_an_ask():
    box, source, bodies, _ = gated(tool_effect="read")
    assert await box.run(call("t")) == "ran t"
    assert bodies.sent == []


async def test_ask_mode_tool_opens_an_ask_and_runs_on_allow():
    box, source, bodies, _ = gated()
    task = asyncio.create_task(box.run(call_with_text("t")))
    await until(lambda: opened_asks(bodies))
    ask = opened_asks(bodies)[0]
    assert ask["text"] == "Doing it." and ask["tool"] == "t"
    assert source.ran == []  # nothing ran while the ask is open
    box._asks.answer(ask["id"], "allow", "desktop")
    assert await task == "ran t"


async def test_deny_gives_denied_and_the_tool_never_runs():
    box, source, bodies, _ = gated()
    task = asyncio.create_task(box.run(call("t")))
    await until(lambda: opened_asks(bodies))
    box._asks.answer(opened_asks(bodies)[0]["id"], "deny", "desktop")
    with pytest.raises(RpcError) as err:
        await task
    assert err.value.code == ErrorCode.denied
    assert str(err.value) == "The user said no to t."
    assert source.ran == []


async def test_always_saves_auto_runs_and_next_call_asks_nothing():
    box, source, bodies, stored = gated()
    task = asyncio.create_task(box.run(call("t")))
    await until(lambda: opened_asks(bodies))
    box._asks.answer(opened_asks(bodies)[0]["id"], "always", "desktop")
    assert await task == "ran t"
    assert stored == {"t": "auto"}
    assert await box.run(call("t")) == "ran t"
    assert len(opened_asks(bodies)) == 1


async def test_locked_tool_never_saves_auto_and_cannot_be_answered_always():
    box, source, bodies, stored = gated(locked=True)
    task = asyncio.create_task(box.run(call("t")))
    await until(lambda: opened_asks(bodies))
    ask = opened_asks(bodies)[0]
    assert ask["options"] == ["allow", "deny"]
    with pytest.raises(RpcError) as err:
        box._asks.answer(ask["id"], "always", "desktop")
    assert err.value.code == ErrorCode.invalid_params
    box._asks.answer(ask["id"], "allow", "desktop")
    assert await task == "ran t"
    assert stored == {}


async def test_self_asking_tool_opens_no_gate_ask():
    box, source, bodies, _ = gated(locked=True, self_asks=True)
    assert await box.run(call("t")) == "ran t"
    assert bodies.sent == []


async def test_two_calls_in_one_step_open_independent_asks_with_shared_text():
    box, source, bodies, _ = gated()
    first = asyncio.create_task(box.run(call_with_text("t", "c1", "Both now.")))
    second = asyncio.create_task(box.run(call_with_text("t", "c2", "Both now.")))
    await until(lambda: len(opened_asks(bodies)) == 2)
    a, b = opened_asks(bodies)
    assert a["id"] != b["id"] and a["text"] == b["text"] == "Both now."
    box._asks.answer(a["id"], "allow", "desktop")
    box._asks.answer(b["id"], "deny", "desktop")
    assert await first == "ran t"
    with pytest.raises(RpcError):
        await second


async def test_home_caller_skips_the_ask():
    spec_home = ToolSpec("h", "h", {"type": "object"}, frozenset({"home", "scout"}))
    bodies = AskBodies()
    box = Toolbox([FakeSource([spec_home])], asks=Asks(bodies))
    assert await box.run(call("h"), caller="home") == "ran h"
    assert bodies.sent == []


async def test_other_caller_in_audience_is_still_asked():
    spec_x = ToolSpec("x", "x", {"type": "object"}, frozenset({"scout", "expert"}))
    bodies = AskBodies()
    box = Toolbox([FakeSource([spec_x])], asks=Asks(bodies))
    task = asyncio.create_task(box.run(call("x"), caller="expert"))
    await until(lambda: opened_asks(bodies))
    box._asks.answer(opened_asks(bodies)[0]["id"], "allow", "desktop")
    assert await task == "ran x"


async def test_nobody_online_says_nobody_was_there():
    box, source, bodies, _ = gated(online=())
    with pytest.raises(RpcError) as err:
        await box.run(call("t"))
    assert err.value.code == ErrorCode.denied
    assert str(err.value) == "Nobody was there to ask, so t was not run."
    assert source.ran == []


async def test_turn_cancel_mid_ask_closes_it_cancelled_and_leaves_nothing():
    box, source, bodies, _ = gated()
    task = asyncio.create_task(box.run(call("t")))
    await until(lambda: opened_asks(bodies))
    ask = opened_asks(bodies)[0]
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert bodies.sent[-1] == {"id": ask["id"], "state": "closed", "reason": "cancelled"}
    assert box._asks.open_asks() == []
    assert source.ran == []


async def test_without_asks_the_gate_step_is_skipped():
    box = Toolbox([FakeSource([spec("t")])])
    assert await box.run(call("t")) == "ran t"


def test_known_specs_keep_offline_body_tools():
    bodies = Bodies()
    connect(bodies, "desktop")
    box = Toolbox([BrainSource([(spec("a"), None)]), BodySource(bodies)])
    bodies.disconnect("desktop", bodies._online["desktop"].peer)
    assert [s.name for s in box.known_specs()] == ["a", "desktop__see_screen"]
    assert box.sources[1].specs() == []


def test_home_tools_are_home_audience_contract_records():
    h = ToolSpec("h", "h d", {"type": "object"}, frozenset({"home"}), effect="read")
    box = Toolbox([BrainSource([(spec("a"), None), (h, None)])])
    [record] = box.home_tools()
    assert record.model_dump(exclude_none=True) == {
        "name": "h",
        "description": "h d",
        "input_schema": {"type": "object"},
        "effect": "read",
    }


# ---- Task 4: connected app tools through the toolbox ----


class _AppsStub:
    def __init__(self, state="connected"):
        self.state = state

    def ids(self):
        return ["lin"]

    def name(self, app_id):
        return "Linear"

    def status(self, app_id):
        return SimpleNamespace(state=self.state)

    def tools(self, app_id):
        from mcp.types import Tool, ToolAnnotations

        schema = {"type": "object"}
        return [
            Tool(name="get", input_schema=schema, annotations=ToolAnnotations(read_only_hint=True)),
            Tool(name="update", input_schema=schema),
            Tool(name="delete_issue", input_schema=schema),
            Tool(name="x" * 80, input_schema=schema),
        ]

    async def call(self, app_id, tool, args):
        from mcp.types import CallToolResult, TextContent

        return CallToolResult(content=[TextContent(type="text", text=f"did {tool}")])


def app_box(state="connected", stored=None):
    from brain.app_tools import AppSource

    return Toolbox([AppSource(_AppsStub(state))], stored)


def test_app_tools_listed_and_long_names_cut():
    names = [t["name"] for t in app_box().model_tools()]
    assert len(names) == 4  # the 80-char tool is cut to fit, never over 64
    assert all(len(n) <= 64 for n in names)
    assert {"lin__delete_issue", "lin__get", "lin__update"} <= set(names)


def test_app_tool_default_modes_and_locked():
    box = app_box()
    by_name = {s.name: s for s in box.sources[0].specs()}
    assert box.mode(by_name["lin__get"]) == "auto"
    assert box.mode(by_name["lin__update"]) == "ask"
    assert box.mode(by_name["lin__delete_issue"]) == "ask"
    with pytest.raises(RpcError) as e:
        box.set_mode("lin__delete_issue", "auto")
    assert e.value.code == ErrorCode.invalid_params
    box.set_mode("lin__get", "ask")  # modes reuse the permissions store, no new storage


async def test_app_tool_runs_through_the_toolbox():
    out = await app_box().run(call("lin__get"))
    assert "did get" in out


async def test_offline_app_raises_the_plain_error():
    with pytest.raises(RpcError) as e:
        await app_box("error").run(call("lin__get"))
    assert e.value.message == "Linear is not connected right now."
