"""Tests for the permission wording table: every tool Scout can use has plain words, in the
groups and order of the wording page, and an unknown tool falls back to its own description."""

from unittest.mock import MagicMock

import pytest

from brain.bodies import Bodies
from brain.memory import Memory
from brain.sessions import Session
from brain.setup.tools import setup_tools
from brain.tool_words import GROUPS, WORDS, fallback, words_for

BODY_TOOLS = [
    "list_windows",
    "read_window_text",
    "look_at_window",
    "open_url",
    "list_files",
    "read_file",
    "move_file",
    "rename_file",
    "delete_file",
    "write_file",
    "install_ocr_language",
    "tabs",
    "page_parts",
    "browser_search",
    "tab_actions",
]


class _Model:
    model_id = "claude-sonnet-5-5"


class _Budget:
    def allows(self):
        return True

    def spend(self, usage, model):
        pass


def _scout_tool_names() -> set[str]:
    """Scout's built-in tools as main.py builds them, with fakes for what the builders only close
    over (nothing here is called)."""
    from brain.loops.tools import loop_tools
    from brain.setup.apps import app_setup_tools
    from brain.setup.expert_tools import expert_setup_tools, login_tools

    fake = MagicMock()
    extra = (
        setup_tools(MagicMock(), fake, fake)
        + expert_setup_tools(MagicMock(), *[fake] * 9)[0]
        + app_setup_tools(MagicMock(), *[fake] * 10, {}, fake, fake)[0]
        + login_tools(MagicMock(), fake)
        + loop_tools(fake)
    )
    session = Session(_Model(), _Budget(), Bodies(), 10, Memory(":memory:"), extra_tools=extra)
    return {
        s.name
        for s in session.toolbox.known_specs()
        if "scout" in s.audience and "__" not in s.name
    }


def test_every_builtin_scout_tool_has_words():
    names = _scout_tool_names()
    assert "remember" in names and "loops_open" in names  # the build really covered the tools
    assert names - set(WORDS) == set()


def test_body_tools_have_words():
    assert set(BODY_TOOLS) <= set(WORDS)


def test_groups_order_and_titles():
    assert [(g.id, g.title) for g in GROUPS] == [
        ("memory", "Memory"),
        ("timers", "Timers and watches"),
        ("jobs", "Jobs and experts"),
        ("talking", "Talking with you"),
        ("held", "Held items"),
        ("setup", "Setting things up"),
        ("web", "The web"),
        ("computer", "This computer"),
        ("browser", "Your browser"),
    ]
    assert {w.group for w in WORDS.values()} == {g.id for g in GROUPS}


def test_there_are_54_tools():
    assert len(WORDS) == 54


def test_words_match_the_wording_page_spot_checks():
    assert WORDS["delete_file"].line == "Sends a file to the Recycle Bin."
    assert WORDS["delete_file"].title == "Delete files"
    assert WORDS["web_search"].group == "web"
    assert WORDS["tabs"].group == "browser"
    assert WORDS["list_windows"].group == "computer"


def test_words_for_unknown_is_none():
    assert words_for("nothing_like_it", "x") is None
    assert words_for("remember", "ignored") is WORDS["remember"]


@pytest.mark.parametrize(
    ("description", "expected"),
    [
        (
            "Send mail. Needs a signed-in account. Never sends twice.",
            ("Send mail.", "Needs a signed-in account. Never sends twice."),
        ),
        ("Only one sentence", ("Only one sentence", "")),
    ],
)
def test_fallback_splits_first_sentence(description, expected):
    title, line, info = fallback("send_mail", description)
    assert (title, (line, info)) == ("send_mail", expected)
