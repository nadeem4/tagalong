"""Checks F9: words Scout says before a tool round are not glued onto the answer after it.

A fake model scripts the steps; the "\\n\\n" delta is the only line the loop adds itself.
"""

from test_turn import go, text_step, tool_step


def _deltas(sent):
    return [p["delta"] for _, p in sent if "delta" in p]


async def test_a_break_separates_the_lead_in_from_the_answer():
    lead_in = (["I will check."], tool_step(("c1", "x"))[1])
    _, _, sent, _ = await go([lead_in, text_step("Done.")])
    assert _deltas(sent) == ["I will check.", "\n\n", "Done."]


async def test_no_extra_break_when_the_lead_in_already_ends_in_whitespace():
    lead_in = (["I will check.\n"], tool_step(("c1", "x"))[1])
    _, _, sent, _ = await go([lead_in, text_step("Done.")])
    assert _deltas(sent) == ["I will check.\n", "Done."]


async def test_no_break_when_nothing_was_said_before_the_tools():
    _, _, sent, _ = await go([tool_step(("c1", "x")), text_step("Done.")])
    assert _deltas(sent) == ["Done."]
