"""Checks which experts count as tested: the three whose strip lists came from the 20a spike."""

from brain.setup.env import is_tested


def test_claude_codex_and_gemini_are_tested_and_others_are_not():
    assert all(is_tested(i) for i in ("claude-acp", "codex-acp", "gemini"))
    assert not is_tested("goose") and not is_tested("custom")
