"""Tests for Scout's system prompt and the conversion of a body's say into content blocks."""

import base64
import json
from datetime import datetime
from importlib.resources import files

import pytest

from brain.memory import Item
from brain.mind.prompt import render_know, system_prompt, user_content
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


def item(id, kind, text, cadence=None):
    return Item(id, kind, text, cadence, "2026-10-25T00:00:00", "2026-10-25T00:00:00")


def test_render_know_groups_with_ids():
    out = render_know(
        {
            "instruction": [item(1, "instruction", "Reply in French")],
            "about_you": [item(2, "about_you", "Works nights")],
            "tracking": [item(3, "tracking", "Watch the build", "daily")],
        }
    )
    assert out == (
        "Instructions from the owner:\n- [1] Reply in French\n\n"
        "About the owner:\n- [2] Works nights\n\n"
        "Things to keep an eye on:\n- [3] (daily) Watch the build"
    )


def test_render_know_empty_is_blank():
    assert render_know({}) == ""
    assert render_know({"instruction": []}) == ""


def test_system_prompt_places_know_between_soul_and_now():
    know = render_know({"instruction": [item(1, "instruction", "Be brief")]})
    sections = system_prompt(NOW, [], know).split("\n\n")
    assert sections[0].startswith("You are Scout")
    assert sections[-3] == "What you know:\nInstructions from the owner:\n- [1] Be brief"
    assert sections[-2].startswith("Now: ")


def test_system_prompt_without_know_unchanged():
    assert "What you know" not in system_prompt(NOW, [])


def test_soul_has_memory_rules():
    soul = files("brain.mind").joinpath("soul.md").read_text(encoding="utf-8").lower()
    assert "instruction" in soul and "tracking" in soul
    assert "replaces" in soul and "recall" in soul


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


def test_undecodable_text_file_falls_back_to_note():
    blocks = user_content(
        say(parts=[{"type": "file", "mime": "text/plain", "name": "n.txt", "data": "!!not b64"}])
    )
    assert blocks == [
        {"type": "text", "text": "File n.txt (text/plain) attached; it cannot be read here."}
    ]


def test_empty_text_part_is_skipped():
    blocks = user_content(say(parts=[{"type": "text", "text": ""}, {"type": "text", "text": "x"}]))
    assert blocks == [{"type": "text", "text": "x"}]


def test_unsupported_image_mime_becomes_note():
    blocks = user_content(say(parts=[{"type": "image", "mime": "image/bmp", "data": b64(b"b")}]))
    assert blocks == [
        {"type": "text", "text": "File unnamed (image/bmp) attached; it cannot be read here."}
    ]


def test_context_keeps_non_ascii_readable():
    blocks = user_content(say(text="hi", context={"window": "café"}))
    assert "café" in blocks[-1]["text"]


def test_soul_tells_scout_its_words_before_a_change_are_the_approval_text():
    assert "words you write just before" in system_prompt(NOW, [])


def test_soul_says_job_notes_are_events_not_requests():
    assert "job note" in system_prompt(NOW, []).lower()
