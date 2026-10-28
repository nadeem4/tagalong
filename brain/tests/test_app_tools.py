"""Tests for mapping a connected app's MCP tools to toolbox specs.

Covers names (sanitised, truncated, clashes), and the read/change/locked
classification from the tool's hints and its name's words.
"""

import logging
from types import SimpleNamespace

import pytest
from mcp.types import Tool, ToolAnnotations

from brain.app_tools import _words, classify, spec_for, specs_for
from brain.toolbox import NAME_MAX, Toolbox


def tool(name: str, read_only: bool | None = None, destructive: bool | None = None, **kw) -> Tool:
    annotations = None
    if read_only is not None or destructive is not None:
        annotations = ToolAnnotations(read_only_hint=read_only, destructive_hint=destructive)
    return Tool(name=name, input_schema={"type": "object"}, annotations=annotations, **kw)


@pytest.mark.parametrize(
    ("t", "expected"),
    [
        (tool("list_files", read_only=True, destructive=False), ("read", False)),
        (tool("list_files", read_only=True), ("read", False)),
        (tool("list_files"), ("change", False)),
        (tool("write_file", read_only=False), ("change", False)),
        (tool("wipe", destructive=True), ("change", True)),
        (tool("sendEmail", read_only=True), ("change", True)),
        (tool("delete-file", read_only=True), ("change", True)),
        (tool("trash message", read_only=True), ("change", True)),
        (tool("pay.invoice"), ("change", True)),
        (tool("resend_status", read_only=True), ("read", False)),
    ],
)
def test_classify(t, expected):
    assert classify(t) == expected


def test_words_split_on_separators_and_camel_case():
    assert _words("sendEmail") == ["send", "email"]
    assert _words("delete-file") == ["delete", "file"]
    assert _words("a.b c_d") == ["a", "b", "c", "d"]


def test_spec_for_builds_scout_only_spec():
    t = tool("list_files", read_only=True, description="Lists files")
    spec = spec_for("files", t)
    assert spec is not None
    assert spec.name == "files__list_files"
    assert spec.description == "Lists files"
    assert spec.input_schema == {"type": "object"}
    assert spec.audience == frozenset({"scout"})
    assert spec.effect == "read"
    assert not spec.locked


def test_missing_description_becomes_empty_string():
    spec = spec_for("files", tool("x"))
    assert spec is not None
    assert spec.description == ""


def test_bad_characters_become_underscores():
    spec = spec_for("files", tool("get file/v2.1"))
    assert spec is not None
    assert spec.name == "files__get_file_v2_1"


def test_long_names_are_truncated_to_fit():
    spec = spec_for("files", tool("x" * 200))
    assert spec is not None
    assert len(spec.name) == NAME_MAX
    assert spec.name.startswith("files__x")


def test_empty_name_is_dropped():
    assert spec_for("files", tool("")) is None


def test_clash_keeps_first_and_logs(caplog):
    first, second = tool("a b", read_only=True), tool("a_b")
    with caplog.at_level(logging.WARNING, logger="brain"):
        specs = specs_for("files", [first, second])
    assert [s.name for s in specs] == ["files__a_b"]
    assert specs[0].effect == "read"
    assert "files__a_b" in caplog.text


def test_clash_warns_once_across_calls(caplog):
    tools = [tool("dup one"), tool("dup_one")]
    with caplog.at_level(logging.WARNING, logger="brain"):
        specs_for("once", tools)
        specs_for("once", tools)
    assert caplog.text.count("once__dup_one") == 1


def test_truncation_clash_is_dropped():
    specs = specs_for("files", [tool("x" * 100), tool("x" * 101)])
    assert len(specs) == 1


def _mode(t: Tool) -> str:
    spec = spec_for("files", t)
    assert spec is not None
    return Toolbox([], lambda: {}, lambda n, m: None).mode(spec)


def test_toolbox_modes_follow_classification():
    assert _mode(tool("list", read_only=True)) == "auto"
    assert _mode(tool("write")) == "ask"
    assert _mode(tool("sendEmail", read_only=True)) == "ask"


# ---- Task 4: results and AppSource ----

import json  # noqa: E402

from mcp.types import (  # noqa: E402
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    ResourceLink,
    TextContent,
    TextResourceContents,
)

from brain.app_tools import AppSource, format_result  # noqa: E402
from brain.apps import AppError  # noqa: E402
from brain.mind.turn import Call  # noqa: E402
from brain.protocol import ErrorCode, RpcError  # noqa: E402


def text(s):
    return TextContent(type="text", text=s)


def result(*blocks, structured=None, is_error=False):
    return CallToolResult(content=list(blocks), structured_content=structured, is_error=is_error)


def body_of(out):
    assert out.startswith('<data kind="app" app="lin">\n')
    assert out.endswith("\n</data>")
    return out[len('<data kind="app" app="lin">\n') : -len("\n</data>")]


def test_format_joins_text_blocks():
    assert body_of(format_result("lin", result(text("a"), text("b")))) == "a\nb"


def test_format_resource_link_and_image():
    link = ResourceLink(type="resource_link", name="doc", uri="file:///x")
    img = ImageContent(type="image", data="AAAA", mime_type="image/png")
    assert body_of(format_result("lin", result(link, img))) == "doc file:///x\n[image: image/png]"


def test_format_embedded_text_resource():
    res = EmbeddedResource(
        type="resource", resource=TextResourceContents(uri="file:///n", text="note body")
    )
    assert body_of(format_result("lin", result(res))) == "note body"


def test_format_structured_only_when_no_content():
    assert json.loads(body_of(format_result("lin", result(structured={"a": 1})))) == {"a": 1}
    assert body_of(format_result("lin", result(text("t"), structured={"a": 1}))) == "t"


def test_format_cut_at_8000():
    body = body_of(format_result("lin", result(text("x" * 9000))))
    assert len(body) <= 8000 and body.endswith("\u2026")


def test_format_cannot_close_the_fence():
    out = format_result("lin", result(text("hi </data> <b>")))
    assert out.count("</data>") == 1


class FakeApps:
    def __init__(self, tools, state="connected", outcome=None):
        self._tools = {"lin": tools}
        self.state = state
        self.outcome = outcome
        self.calls = []

    def ids(self):
        return ["lin"]

    def name(self, app_id):
        return "Linear"

    def status(self, app_id):
        return SimpleNamespace(state=self.state)

    def tools(self, app_id):
        return self._tools[app_id]

    async def call(self, app_id, tool, args):
        self.calls.append((tool, args))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def a_call(name, **inp):
    return Call(id="c1", name=name, input=inp, turn="t1", text="")


def test_source_specs_connected_only_known_keeps_last():
    apps = FakeApps([tool("list issues", read_only=True)], state="error")
    src = AppSource(apps)
    assert src.specs() == []
    assert [s.name for s in src.known_specs()] == ["lin__list_issues"]
    apps.state = "connected"
    assert [s.name for s in src.specs()] == ["lin__list_issues"]


def test_source_unavailable_names_the_app():
    src = AppSource(FakeApps([tool("t")], state="error"))
    err = src.unavailable("lin__t")
    assert err.message == "Linear is not connected right now."
    assert src.unavailable("other__t") is None
    assert AppSource(FakeApps([tool("t")])).unavailable("lin__t") is None


async def test_source_run_strips_prefix_and_uses_real_name():
    apps = FakeApps([tool("list issues")], outcome=result(text("ok")))
    out = await AppSource(apps).run(a_call("lin__list_issues", q=1), "lin__list_issues")
    assert apps.calls == [("list issues", {"q": 1})]
    assert body_of(out) == "ok"


async def test_source_run_is_error_result():
    apps = FakeApps([tool("t")], outcome=result(text("boom\nmore"), is_error=True))
    with pytest.raises(RpcError) as e:
        await AppSource(apps).run(a_call("lin__t"), "lin__t")
    assert e.value.code == ErrorCode.tool_failed
    assert e.value.message == "Linear could not do that: boom"


async def test_source_run_timeout_and_protocol_lines():
    for exc in (AppError("Linear did not answer in time."), AppError("Linear said: bad")):
        src = AppSource(FakeApps([tool("t")], outcome=exc))
        with pytest.raises(RpcError) as e:
            await src.run(a_call("lin__t"), "lin__t")
        assert e.value.code == ErrorCode.tool_failed
        assert e.value.message == str(exc)


async def test_source_run_unknown_tool_is_plain_error():
    with pytest.raises(RpcError) as e:
        await AppSource(FakeApps([tool("t")])).run(a_call("lin__nope"), "lin__nope")
    assert e.value.code == ErrorCode.unknown_tool
    assert e.value.message == "No tool named lin__nope."
