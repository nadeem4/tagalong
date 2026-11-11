"""Checks that saved messages are rebuilt into a valid Anthropic history on resume.

A broken history (orphan tool_result, unanswered tool_use) makes the API reject every later
turn, so the trimming rules must always cut on whole turns.
"""

from brain.masking import WITHHELD
from brain.mind.resume import RESUME_MAX_MESSAGES, rebuild_history


def rebuild(messages):
    return rebuild_history(messages)[0]


def test_orphaned_server_result_blocks_are_dropped_on_resume():
    poisoned = {
        "role": "assistant",
        "content": [
            {"type": "text", "text": "Found it."},
            {
                "type": "code_execution_tool_result",
                "tool_use_id": "srvtoolu_01",
                "content": {"type": "code_execution_result", "stdout": "", "return_code": 0},
            },
            {"type": "tool_search_tool_result", "tool_use_id": "srvtoolu_02", "content": {}},
        ],
    }
    history = rebuild([u("q"), poisoned, u("next")])
    assert history[1]["content"] == [{"type": "text", "text": "Found it."}]


def test_an_assistant_message_emptied_by_stripping_keeps_alternation_valid():
    only = {
        "role": "assistant",
        "content": [{"type": "code_execution_tool_result", "tool_use_id": "s", "content": {}}],
    }
    history = rebuild([u("q0"), a("r0"), u("q"), only, u("next")])
    assert [m["role"] for m in history] == ["user", "assistant", "user"]
    assert WITHHELD not in str(history)  # the silent reply goes with the message it answered


def test_resume_strips_citations_and_mcp_tool_use_like_the_save_path():
    cited = {
        "type": "text",
        "text": "From X.",
        "citations": [{"type": "web_search_result_location", "url": "https://x.example"}],
    }
    mcp = {"type": "mcp_tool_use", "id": "m1", "name": "n", "server_name": "s", "input": {}}
    history = rebuild([u("q"), {"role": "assistant", "content": [cited, mcp]}, u("n")])
    assert history[1]["content"] == [{"type": "text", "text": "From X."}]


def u(text):
    return {"role": "user", "content": text}


def a(text):
    return {"role": "assistant", "content": [{"type": "text", "text": text}]}


def _think(text):
    return {"type": "thinking", "thinking": text, "signature": "s"}


def test_resume_keeps_no_thinking_anywhere_so_the_dropped_run_is_a_prefix():
    messages = [
        u("q1"),
        {
            "role": "assistant",
            "content": [
                _think("a"),
                {"type": "redacted_thinking", "data": "x"},
                {"type": "text", "text": "r1"},
            ],
        },
        u("q2"),
        {"role": "assistant", "content": [_think("b")]},
        u("q3"),
        {"role": "assistant", "content": [_think("c"), {"type": "text", "text": "r3"}]},
    ]
    history = rebuild(messages)
    assert "thinking" not in str(history)
    assert history[1]["content"] == [{"type": "text", "text": "r1"}]
    assert WITHHELD not in str(history)
    assert [m["role"] for m in history] == ["user", "assistant", "user", "assistant"]
    assert history[3]["content"] == [{"type": "text", "text": "r3"}]


def test_resume_leaves_a_history_without_thinking_as_it_was():
    messages = [u("q"), a("r")]
    history = rebuild(messages)
    assert history[0] is messages[0] and history[1] is messages[1]


def test_resume_adds_no_message_when_the_last_reply_only_lost_its_thinking():
    messages = [u("q"), {"role": "assistant", "content": [_think("a"), a("r")["content"][0]]}]
    history = rebuild(messages)
    assert len(history) == len(messages)
    assert history[-1]["role"] == "assistant"


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
    assert rebuild([]) == []


def test_short_history_unchanged():
    msgs = [u("hi"), call("1"), result("1"), a("done")]
    assert rebuild(msgs) == msgs


def test_starts_at_turn_start_of_latest_compaction():
    msgs = [u("1"), compaction("old"), u("2"), a("x"), u("3"), compaction("new"), u("4")]
    out = rebuild(msgs)
    assert out == msgs[4:]
    assert out[0]["role"] == "user" and is_turn_start(out[0])


def test_compaction_mid_turn_starts_at_that_turn_start():
    msgs = [u("old"), a("x"), u("go"), call("1"), result("1"), compaction(), a("end")]
    assert rebuild(msgs) == msgs[2:]


def test_cap_trims_front_to_whole_turns():
    msgs = []
    for i in range(60):
        msgs += [u(f"q{i}"), a(f"a{i}")]
    assert len(msgs) == 120
    out = rebuild(msgs)
    assert len(out) <= RESUME_MAX_MESSAGES
    assert is_turn_start(out[0])
    assert_valid(out)


def test_cap_skips_mid_turn_cut_points():
    msgs = [u("q")]
    for i in range(30):
        msgs += [call(str(i)), result(str(i))]
    msgs += [a("end"), u("q2"), a("a2")]
    out = rebuild(msgs)
    assert out == msgs[-2:]


def test_cap_with_one_huge_turn_keeps_the_whole_turn():
    msgs = [u("q")]
    for i in range(29):
        msgs += [call(str(i)), result(str(i))]
    msgs.append(a("end"))
    assert len(msgs) == 60
    out = rebuild(msgs)
    assert out == msgs
    assert out[0] == u("q")


def test_failed_compaction_block_is_not_a_cut_point():
    failed = {"role": "assistant", "content": [{"type": "compaction", "content": None}]}
    msgs = [u("one"), a("x"), u("two"), failed, a("y")]
    assert rebuild(msgs) == msgs


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
    out = rebuild(msgs)
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
    assert rebuild(msgs) == msgs


def test_does_not_mutate_input():
    msgs = [u("go"), call("1")]
    rebuild(msgs)
    assert len(msgs) == 2


def test_every_tool_use_has_its_result():
    cases = [
        [u("go"), call("1")],
        [u("go"), call("1"), result("1"), call("2")],
        [u("x"), compaction(), u("go"), call("1")],
        [u("q"), a("a")] * 40 + [u("go"), call("1")],
    ]
    for msgs in cases:
        assert_valid(rebuild(msgs))


def test_resume_heals_a_saved_reply_whose_thinking_lost_its_search_blocks():
    saved = {
        "role": "assistant",
        "content": [
            {"type": "thinking", "thinking": "a", "signature": "s1"},
            {"type": "thinking", "thinking": "b", "signature": "s2"},
            {"type": "text", "text": "Found."},
        ],
    }
    old = [{"role": "user", "content": "look"}, saved]
    # a row saved before the fix has thinking and no server blocks left, so it cannot be told
    # from a clean one; only rows that still hold server blocks are healed
    with_search = {
        "role": "assistant",
        "content": [
            saved["content"][0],
            {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {}},
            {"type": "web_search_tool_result", "tool_use_id": "srvtoolu_1", "content": []},
            saved["content"][1],
            saved["content"][2],
        ],
    }
    history = rebuild([old[0], with_search])
    assert history[-1]["content"] == [{"type": "text", "text": "Found."}]
