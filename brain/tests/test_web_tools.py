"""Checks Scout's web search and fetch: typed declarations, the Off state, the budget fee and
the turn loop. Fakes only: the server tools run on Anthropic's side, so no call is ever made.
"""

import datetime
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from brain.builtin_guards import spend_guards
from brain.guardrails import WEB_SEARCH_USD, Budget
from brain.mind.turn import Call, Final, run_turn
from brain.protocol import RpcError
from brain.toolbox import Toolbox
from brain.web_tools import WebSource, without_server_blocks

DAY = datetime.date(2026, 11, 3)
MODEL = "claude-sonnet-5-5"


def usage(searches=None):
    server = None if searches is None else SimpleNamespace(web_search_requests=searches)
    return SimpleNamespace(
        input_tokens=0,
        output_tokens=0,
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
        server_tool_use=server,
    )


def budget(tmp_path, limit=5.0):
    return Budget(tmp_path / "b.json", limit, today=lambda: DAY)


def test_each_search_adds_one_fee(tmp_path):
    b = budget(tmp_path)
    b.spend(usage(3), MODEL)
    assert round(b.spent, 6) == round(3 * WEB_SEARCH_USD, 6)


def test_the_fee_is_one_cent_a_search():
    assert WEB_SEARCH_USD == 0.01  # 10 USD per 1,000 searches


def test_missing_server_tool_use_adds_nothing(tmp_path):
    b = budget(tmp_path)
    b.spend(usage(None), MODEL)
    b.spend(SimpleNamespace(), MODEL)  # no attributes at all
    b.spend(SimpleNamespace(server_tool_use=SimpleNamespace()), MODEL)
    assert b.spent == 0


def test_a_dict_shaped_server_tool_use_is_tolerated(tmp_path):
    b = budget(tmp_path)
    b.spend(SimpleNamespace(server_tool_use={"web_search_requests": 2}), MODEL)
    assert round(b.spent, 6) == round(2 * WEB_SEARCH_USD, 6)


def toolbox(stored=None):
    stored = {} if stored is None else stored
    return Toolbox([WebSource()], lambda: stored, stored.__setitem__)


def test_model_tools_carry_the_typed_declarations_with_caps():
    tools = {t["name"]: t for t in toolbox().model_tools()}
    assert tools["web_search"]["type"] == "web_search_20260209"
    assert tools["web_fetch"]["type"] == "web_fetch_20260209"
    for t in tools.values():
        assert 1 <= t["max_uses"] <= 10
        assert "input_schema" not in t  # a server tool has no client schema


def test_both_are_auto_by_default_and_known_to_home():
    box = toolbox()
    assert {s.name: box.mode(s) for s in box.known_specs()} == {
        "web_search": "auto",
        "web_fetch": "auto",
    }


def test_ask_is_refused_for_a_server_tool_but_off_and_auto_work():
    box = toolbox()
    for name in ("web_search", "web_fetch"):
        with pytest.raises(RpcError):
            box.set_mode(name, "ask")
        box.set_mode(name, "off")
        box.set_mode(name, "auto")


def test_off_hides_the_tool_from_the_model():
    assert [t["name"] for t in toolbox({"web_search": "off"}).model_tools()] == ["web_fetch"]


async def test_a_server_tool_never_runs_client_side():
    with pytest.raises(RpcError):
        await toolbox().run(Call("c1", "web_search", {}, "t1", ""))


SERVER_BLOCKS = [
    {"type": "text", "text": "Looking that up."},
    {"type": "server_tool_use", "id": "s1", "name": "web_search", "input": {"query": "q"}},
    {
        "type": "web_search_tool_result",
        "tool_use_id": "s1",
        "content": [{"type": "web_search_result", "url": "https://x.example", "title": "X"}],
    },
]


class ServerModel:
    model_id = MODEL

    def __init__(self):
        self.seen = []
        self.steps = [
            Final(list(SERVER_BLOCKS), "pause_turn", usage(2)),
            Final([{"type": "text", "text": "Here you go."}], "end_turn", usage(1)),
        ]

    async def stream(self, system, messages, tools):
        self.seen.append(json.dumps(messages))
        yield self.steps.pop(0)


def drive(model, history, b, guards=None):
    return run_turn(
        turn_id="t1",
        body_id=None,
        model=model,
        system=lambda: "s",
        history=history,
        tools=lambda: [],
        run_tool=None,
        inbox=[],
        notify=lambda *a: None,
        budget=b,
        step_cap=10,
        guards=guards,
    )


async def test_pause_turn_keeps_server_blocks_and_counts_each_message_once(tmp_path):
    b = budget(tmp_path)
    history = [{"role": "user", "content": "find x"}]
    model = ServerModel()
    assert await drive(model, history, b) == "done"
    assert history[1]["content"] == SERVER_BLOCKS  # replayed whole while the turn is live
    assert "web_search_tool_result" in model.seen[1]
    assert round(b.spent, 6) == round(3 * WEB_SEARCH_USD, 6)  # 2 + 1, once per message


async def test_searches_that_spend_the_day_stop_the_next_turn_with_the_budget_reason(tmp_path):
    b = budget(tmp_path, limit=0.02)
    b.spend(usage(2), MODEL)
    assert not b.allows()
    history = [{"role": "user", "content": "more"}]
    model = ServerModel()
    reason = await drive(model, history, b, spend_guards(b, 10))
    assert reason == "over_budget"
    assert len(history) == 1 and len(model.seen) == 0  # the model was never called


def test_nothing_about_web_or_budget_in_the_prompt_text_pushes_an_expert():
    mind = Path(__file__).parent.parent / "src" / "brain" / "mind"
    seen = 0
    for name in ("soul.md", "events.md"):
        for line in (mind / name).read_text(encoding="utf-8").splitlines():
            low = line.lower()
            if any(w in low for w in ("web_search", "web_fetch", "budget")):
                seen += 1
                assert "expert" not in low, line
    assert seen  # the soul does say that search exists and how a budget stop is told


def test_server_blocks_and_citations_are_dropped_from_a_saved_message():
    cited = {"type": "text", "text": "From X.", "citations": [{"url": "https://x.example"}]}
    message = {"role": "assistant", "content": [*SERVER_BLOCKS, cited]}
    out = without_server_blocks(message)
    assert out["content"] == [SERVER_BLOCKS[0], {"type": "text", "text": "From X."}]
    assert message["content"][-1] is cited  # the live history is not touched


DYNAMIC_BLOCKS = [
    {"type": "text", "text": "Checked."},
    {
        "type": "code_execution_tool_result",
        "tool_use_id": "srvtoolu_01",
        "content": {"type": "code_execution_result", "stdout": "", "return_code": 0},
    },
    {
        "type": "tool_search_tool_result",
        "tool_use_id": "srvtoolu_02",
        "content": {"type": "tool_search_tool_search_result", "tool_references": []},
    },
]


def test_any_server_result_block_is_dropped_by_its_shape_not_a_list():
    out = without_server_blocks({"role": "assistant", "content": DYNAMIC_BLOCKS})
    assert out["content"] == [DYNAMIC_BLOCKS[0]]
    mine = {"type": "tool_result", "tool_use_id": "toolu_1", "content": "ok"}
    kept = without_server_blocks({"role": "assistant", "content": [mine]})
    assert kept["content"] == [mine]  # the brain's own results are not server blocks


def test_mcp_tool_use_is_a_server_block_but_client_tool_use_is_not():
    mcp = {"type": "mcp_tool_use", "id": "m1", "name": "n", "server_name": "s", "input": {}}
    mine = {"type": "tool_use", "id": "toolu_1", "name": "n", "input": {}}
    out = without_server_blocks({"role": "assistant", "content": [mcp, mine]})
    assert out["content"] == [mine]


def test_a_message_of_only_server_blocks_is_left_for_the_caller_to_fill():
    only = {"role": "assistant", "content": SERVER_BLOCKS[1:]}
    assert without_server_blocks(only)["content"] == []
    user = {"role": "user", "content": "hi"}
    assert without_server_blocks(user) is user
