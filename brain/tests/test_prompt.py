"""Tests for Scout's system prompt and the conversion of a body's say into content blocks."""

import base64
import json
from datetime import datetime
from importlib.resources import files

import pytest

from brain.mind.prompt import system_prompt, user_content
from brain.protocol import Body, SayParams

NOW = datetime(2026, 10, 25, 15, 24, 59)


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def say(**kw) -> SayParams:
    return SayParams.model_validate(kw)


def test_soul_ships_as_package_data_and_has_no_scripted_lines():
    soul = files("brain.mind").joinpath("soul.md").read_text(encoding="utf-8")
    assert soul.startswith("You are Scout")
    assert len(soul.splitlines()) < 40
    assert "silence" in soul.lower() or "nothing useful" in soul.lower()


def test_system_prompt_sections_in_order():
    bodies = [
        Body(id="ext", kind="extension", name="Chrome"),
        Body(id="desk", kind="desktop", name="Windows PC"),
    ]
    sections = system_prompt(NOW, bodies).split("\n\n")
    assert sections[0].startswith("You are Scout")
    assert "Now: Sunday 25 October 2026, 15:24" in sections
    assert sections[-1].splitlines()[-2:] == [
        "- desk (desktop): Windows PC",
        "- ext (extension): Chrome",
    ]


def test_system_prompt_with_no_bodies():
    assert "no body is connected" in system_prompt(NOW, []).lower()


def test_system_prompt_stable_within_a_minute():
    assert system_prompt(NOW, []) == system_prompt(NOW.replace(second=1), [])


def test_text_only():
    assert user_content(say(text="hi")) == [{"type": "text", "text": "hi"}]


def test_text_then_parts_then_context():
    png, pdf = b64(b"png"), b64(b"%PDF")
    blocks = user_content(
        say(
            text="look",
            parts=[
                {"type": "image", "mime": "image/png", "data": png},
                {"type": "file", "mime": "application/pdf", "name": "a.pdf", "data": pdf},
            ],
            context={"window": "VS Code"},
        )
    )
    assert blocks == [
        {"type": "text", "text": "look"},
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": png}},
        {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": pdf},
        },
        {
            "type": "text",
            "text": "Context from the body (as sent):\n" + json.dumps({"window": "VS Code"}),
        },
    ]


def test_text_part_becomes_text_block():
    assert user_content(say(parts=[{"type": "text", "text": "more"}])) == [
        {"type": "text", "text": "more"}
    ]


def test_text_file_is_decoded_with_replacement():
    data = b64("héllo".encode() + b"\xff")
    blocks = user_content(
        say(parts=[{"type": "file", "mime": "text/plain", "name": "n.txt", "data": data}])
    )
    assert blocks == [{"type": "text", "text": "File n.txt:\nhéllo\ufffd"}]


def test_unnamed_text_file():
    blocks = user_content(say(parts=[{"type": "file", "mime": "text/csv", "data": b64(b"a,b")}]))
    assert blocks[0]["text"] == "File unnamed:\na,b"


def test_other_file_is_noted_not_read():
    blocks = user_content(
        say(parts=[{"type": "file", "mime": "application/zip", "name": "x.zip", "data": b64(b"z")}])
    )
    assert blocks == [
        {"type": "text", "text": "File x.zip (application/zip) attached; it cannot be read here."}
    ]


def test_empty_say_raises():
    with pytest.raises(ValueError):
        user_content(say(text="", parts=[]))
