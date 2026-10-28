"""Tests for mapping a connected app's MCP tools to toolbox specs.

Covers names (sanitised, truncated, clashes), and the read/change/locked
classification from the tool's hints and its name's words.
"""

import logging

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
