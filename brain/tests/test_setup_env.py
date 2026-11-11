"""Checks which experts count as tested: the two whose strip lists came from the 20a spike."""

from brain.setup.env import is_tested


def test_claude_and_codex_are_tested_and_others_are_not():
    assert all(is_tested(i) for i in ("claude-acp", "codex-acp"))
    assert not is_tested("goose") and not is_tested("gemini") and not is_tested("custom")
