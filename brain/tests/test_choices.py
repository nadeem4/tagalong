"""Choices: Scout's non-blocking question. The tool returns the ask id at once and the answer
arrives later as a `choice` event. Asks run on a fake Bodies; emit is a recording fake.
"""

import asyncio
import json
from datetime import UTC, datetime

import pytest
from job_rows import fresh_work

from brain.asks import Asks
from brain.choices import Choices
from brain.open_items import OpenItems
from brain.store.memory import MemoryRefused
from brain.tools import choice_tools


class FakeBodies:
    def __init__(self, online=("desktop",)):
        self.online = list(online)
        self.sent: list[dict] = []

    def display_ids(self):
        return self.online

    def notify(self, method, params):
        self.sent.append(params)

    def opened(self):
        return [p for p in self.sent if p["state"] == "open"]


async def settle():
    for _ in range(10):
        await asyncio.sleep(0)


def rig(online=("desktop",), timeout=600.0):
    bodies = FakeBodies(online)
    events = []
    work = fresh_work()
    choices = Choices(
        Asks(bodies, work),
        events.append,
        OpenItems(work.db, lambda: datetime.now(UTC)),
        timeout,
    )
    return bodies, events, choices


async def test_choose_returns_the_ask_id_without_waiting():
    bodies, events, choices = rig()
    ask_id = choices.ask("Which?", ["a", "b"], None, True)
    await settle()
    assert [p["id"] for p in bodies.opened()] == [ask_id]
    assert events == []


async def test_the_ask_names_the_choose_tool_so_bodies_can_tell_it_from_an_expert():
    bodies, _, choices = rig()
    choices.ask("Which?", ["a"], None, True)
    await settle()
    assert bodies.opened()[0]["tool"] == "choose"


async def test_an_answer_emits_a_choice_event_with_option_and_text():
    bodies, events, choices = rig()
    asks = choices._asks
    ask_id = choices.ask("Which?", ["a", "b"], "a", False)
    await settle()
    asks.answer(ask_id, "b", "desktop")
    await settle()
    (event,) = events
    assert event.kind == "choice" and event.key == ask_id
    assert event.facts == {"ask": ask_id, "question": "Which?", "option": "b", "text": ""}


async def test_typed_text_answer_is_carried_as_text():
    _, events, choices = rig()
    ask_id = choices.ask("Which?", ["a"], None, True)
    await settle()
    choices._asks.answer(ask_id, "other", "desktop", text="my own")
    await settle()
    # The body did not pick an option, so none is reported; the text is the answer.
    assert events[0].facts["option"] == ""
    assert events[0].facts["text"] == "my own"


async def test_empty_options_need_free_text():
    bodies, _, choices = rig()
    with pytest.raises(MemoryRefused):
        choices.ask("Which?", [], None, False)
    choices.ask("Which?", [], None, True)  # a typed answer is the whole question
    await settle()
    assert bodies.opened()[0]["free_text"] is True


async def test_choice_timeout_expires_item_not_silent_drop():
    bodies, events, choices = rig(timeout=0.01)
    ask_id = choices.ask("Which?", ["a"], None, True)
    await asyncio.sleep(0.05)
    item = choices._items.get(ask_id)
    assert (item.state, item.reason) == ("expired", "no_answer")
    (event,) = events  # Scout hears that nobody answered
    assert event.kind == "choice" and event.facts["expired"] == "yes"
    assert event.facts["option"] == "" and event.facts["question"] == "Which?"
    assert choices._tasks == set()
    assert bodies.sent[-1]["reason"] == "timeout"


async def test_a_choice_timeout_leaves_other_kinds_of_open_items_alone():
    _, _, choices = rig(timeout=0.01)
    items = choices._items
    other_ask = items.open("ask", "desktop", ttl_s=0)  # already past its deadline
    offer = items.open("offer", "brain", ttl_s=0)
    choices.ask("Which?", ["a"], None, True)
    await asyncio.sleep(0.05)
    assert items.get(other_ask.id).state == "open"
    assert items.get(offer.id).state == "open"


async def test_an_answered_choice_closes_its_item():
    _, _, choices = rig()
    ask_id = choices.ask("Which?", ["a", "b"], None, False)
    await settle()
    assert choices._items.get(ask_id).state == "open"
    choices._asks.answer(ask_id, "b", "desktop")
    await settle()
    item = choices._items.get(ask_id)
    assert (item.state, item.answer) == ("answered", "b")


async def test_a_late_answer_is_not_found():
    from brain.protocol import ErrorCode, RpcError

    _, _, choices = rig(timeout=0.01)
    ask_id = choices.ask("Which?", ["a"], None, True)
    await asyncio.sleep(0.05)
    with pytest.raises(RpcError) as err:
        choices._asks.answer(ask_id, "a", "desktop")
    assert err.value.code == ErrorCode.not_found


async def test_nobody_online_refuses_and_emits_nothing():
    _, events, choices = rig(online=())
    with pytest.raises(MemoryRefused):
        choices.ask("Which?", ["a"], None, True)
    await settle()
    assert events == []


async def test_choose_tool_returns_asked_id_json():
    bodies, _, choices = rig()
    handlers = {s.name: (s, h) for s, h in choice_tools(choices)}
    spec, handler = handlers["choose"]
    assert spec.effect == "read" and spec.default_mode == "auto"
    out = json.loads(await handler({"question": "Which?", "options": ["a", "b"]}))
    await settle()
    assert out == {"asked": bodies.opened()[0]["id"]}
    assert bodies.opened()[0]["free_text"] is True  # free_text defaults to true


async def test_choose_tool_passes_recommended_and_rejects_a_bad_one():
    bodies, _, choices = rig()
    handler = {s.name: h for s, h in choice_tools(choices)}["choose"]
    await handler({"question": "Which?", "options": ["a", "b"], "recommended": "b"})
    await settle()
    assert bodies.opened()[0]["recommended"] == "b"
    with pytest.raises(MemoryRefused):
        await handler({"question": "Which?", "options": ["a"], "recommended": "z"})


async def test_choose_tool_needs_a_question_and_a_list_of_at_most_six():
    _, _, choices = rig()
    handler = {s.name: h for s, h in choice_tools(choices)}["choose"]
    with pytest.raises(MemoryRefused):
        await handler({"options": ["a"]})
    with pytest.raises(MemoryRefused):
        await handler({"question": "Q", "options": list("abcdefg")})
