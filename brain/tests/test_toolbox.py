"""Tests for the Toolbox: audience filtering, the 64-char cap and the gate checks in run."""

import json
import logging

import pytest

from brain.bodies import Bodies
from brain.mind.turn import Call
from brain.protocol import Body, ErrorCode, RpcError, Tool
from brain.toolbox import BodySource, BrainSource, ToolSpec
from brain.toolbox import Toolbox as RealToolbox


def Toolbox(sources, stored=None):
    """A toolbox whose stored modes are a plain dict, as the tests need no database."""
    stored = {} if stored is None else stored
    return RealToolbox(sources, lambda: stored, stored.__setitem__)


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


def test_set_mode_unknown_tool():
    with pytest.raises(RpcError) as e:
        Toolbox([FakeSource([spec("a")])]).set_mode("nope", "auto")
    assert e.value.code == ErrorCode.unknown_tool


def test_set_mode_bad_mode():
    with pytest.raises(RpcError) as e:
        Toolbox([FakeSource([spec("a")])]).set_mode("a", "maybe")
    assert e.value.code == ErrorCode.invalid_params
