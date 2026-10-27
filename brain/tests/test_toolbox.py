"""Tests for the Toolbox: audience filtering, the 64-char cap and the gate checks in run."""

import logging

import pytest

from brain.mind.turn import Call
from brain.protocol import ErrorCode, RpcError
from brain.toolbox import BrainSource, Toolbox, ToolSpec


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
