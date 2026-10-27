"""Checks that saved messages are rebuilt into a valid Anthropic history on resume.

A broken history (orphan tool_result, unanswered tool_use) makes the API reject every later
turn, so the trimming rules must always cut on whole turns.
"""

from brain.mind.resume import RESUME_MAX_MESSAGES, rebuild_history


def u(text):
    return {"role": "user", "content": text}


def a(text):
    return {"role": "assistant", "content": [{"type": "text", "text": text}]}


def call(id):
    return {
        "role": "assistant",
        "content": [{"type": "tool_use", "id": id, "name": "t", "input": {}}],
    }


def result(id):
    return {
        "role": "user",
        "content": [{"type": "tool_result", "tool_use_id": id, "content": "ok"}],
    }


def compaction(text="summary"):
    return {"role": "assistant", "content": [{"type": "compaction", "content": text}]}


def is_turn_start(m):
    if m["role"] != "user":
        return False
    c = m["content"]
    return isinstance(c, str) or not any(b.get("type") == "tool_result" for b in c)


def blocks(m, kind):
    c = m["content"]
    return [b for b in c if b.get("type") == kind] if isinstance(c, list) else []


def assert_valid(history):
    for i, m in enumerate(history):
        uses = blocks(m, "tool_use")
        if uses:
            assert i + 1 < len(history)
            answered = {b["tool_use_id"] for b in blocks(history[i + 1], "tool_result")}
            assert {b["id"] for b in uses} <= answered
        if blocks(m, "tool_result"):
            assert i > 0 and blocks(history[i - 1], "tool_use")


def test_empty_history_stays_empty():
    assert rebuild_history([]) == []


def test_short_history_unchanged():
    msgs = [u("hi"), call("1"), result("1"), a("done")]
    assert rebuild_history(msgs) == msgs


def test_starts_at_turn_start_of_latest_compaction():
    msgs = [u("1"), compaction("old"), u("2"), a("x"), u("3"), compaction("new"), u("4")]
    out = rebuild_history(msgs)
    assert out == msgs[4:]
    assert out[0]["role"] == "user" and is_turn_start(out[0])


def test_compaction_mid_turn_starts_at_that_turn_start():
    msgs = [u("old"), a("x"), u("go"), call("1"), result("1"), compaction(), a("end")]
    assert rebuild_history(msgs) == msgs[2:]


def test_cap_trims_front_to_whole_turns():
    msgs = []
    for i in range(60):
        msgs += [u(f"q{i}"), a(f"a{i}")]
    assert len(msgs) == 120
    out = rebuild_history(msgs)
    assert len(out) <= RESUME_MAX_MESSAGES
    assert is_turn_start(out[0])
    assert_valid(out)


def test_cap_skips_mid_turn_cut_points():
    msgs = [u("q")]
    for i in range(30):
        msgs += [call(str(i)), result(str(i))]
    msgs += [a("end"), u("q2"), a("a2")]
    out = rebuild_history(msgs)
    assert out == msgs[-2:]


def test_cap_with_one_huge_turn_returns_empty():
    msgs = [u("q")]
    for i in range(29):
        msgs += [call(str(i)), result(str(i))]
    msgs.append(a("end"))
    assert len(msgs) == 60
    assert rebuild_history(msgs) == []


def test_dangling_tool_use_is_closed():
    msgs = [
        u("go"),
        {
            "role": "assistant",
            "content": [
                {"type": "tool_use", "id": "1", "name": "t", "input": {}},
                {"type": "tool_use", "id": "2", "name": "t", "input": {}},
            ],
        },
    ]
    out = rebuild_history(msgs)
    assert out[:2] == msgs
    assert out[2] == {
        "role": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": i, "content": "cancelled", "is_error": True}
            for i in ("1", "2")
        ],
    }
    assert_valid(out)


def test_final_lone_user_message_is_kept():
    msgs = [u("a"), a("b"), u("c")]
    assert rebuild_history(msgs) == msgs


def test_does_not_mutate_input():
    msgs = [u("go"), call("1")]
    rebuild_history(msgs)
    assert len(msgs) == 2


def test_every_tool_use_has_its_result():
    cases = [
        [u("go"), call("1")],
        [u("go"), call("1"), result("1"), call("2")],
        [u("x"), compaction(), u("go"), call("1")],
        [u("q"), a("a")] * 40 + [u("go"), call("1")],
    ]
    for msgs in cases:
        assert_valid(rebuild_history(msgs))
