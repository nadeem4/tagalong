"""Checks Holds: an expert's permission request or question held on a card, with no timeout.

Fake bodies record the frames (each validated against the contract). The card's answer reaches
the hold through `Asks.answer`, the way a body's answer does, and Holds takes it by its kind.
"""

import asyncio
from datetime import UTC, datetime

import pytest

from brain.asks import AskExpired, Asks
from brain.holds import Holds
from brain.memory import Memory
from brain.mind.turn import Call
from brain.open_items import OpenItems
from brain.protocol import AskParams, ErrorCode, RpcError
from brain.store.work import WorkStore
from brain.tasks import Tasks

NOW = datetime(2026, 11, 18, 9, 0, tzinfo=UTC)


class FakeBodies:
    def __init__(self, online=("desktop",)) -> None:
        self.online = list(online)
        self.sent: list[tuple[str, dict]] = []

    def display_ids(self) -> list[str]:
        return self.online

    def notify(self, method: str, params: dict) -> None:
        AskParams.model_validate({**params, "seq": 1})
        self.sent.append((method, params))


class Rig:
    def __init__(self, online=("desktop",)) -> None:
        self.memory = Memory(":memory:")
        self.bodies = FakeBodies(online)
        self.work = WorkStore(self.memory.db, lambda: NOW)
        self.items = OpenItems(self.memory.db, lambda: NOW)
        self.tasks = Tasks(self.memory.db, lambda text: text, lambda: NOW, items=self.items)
        self.asks = Asks(self.bodies, self.work)
        self.holds = Holds(self.asks, self.work, self.items, self.tasks)
        self.saved: list[tuple] = []  # what the session saves as a card_answer event
        self.asks.on_item_answer = lambda *a: self.saved.append(a)

    def job(self, id="j1", task_id=None) -> str:
        self.work.create("goal", "a job", id=id, state="active", task_id=task_id)
        return id

    def task(self, kind="do", id="k1") -> str:
        self.tasks.open(kind, "desktop", id=id, title="Fix the build")
        return id

    def cards(self) -> list[dict]:
        return [p for _, p in self.bodies.sent if p["state"] == "open"]

    def last(self) -> dict:
        return self.bodies.sent[-1][1]

    async def card(self, n: int = 1) -> dict:
        for _ in range(50):
            if len(self.cards()) >= n:
                return self.cards()[n - 1]
            await asyncio.sleep(0)
        raise AssertionError("no card was shown")

    def ask(self, **kw) -> "asyncio.Task":
        kw.setdefault("text", "Which?")
        kw.setdefault("options", ["A", "B"])
        kw.setdefault("kind", "question")
        return asyncio.ensure_future(self.holds.ask(**kw))


def call(text: str = "Opening it.") -> Call:
    return Call(id="c1", name="desktop__x", input={"a": 1}, turn="", text=text)


async def test_a_held_question_waits_until_the_card_is_answered():
    rig = Rig()
    waiting = rig.ask(job_id=rig.job(), free_text=True)
    card = await rig.card()
    assert not waiting.done()
    assert card["free_text"] is True and card["options"] == ["A", "B"]
    rig.asks.answer(card["id"], "A", "desktop")
    assert await waiting == ("A", None)
    assert rig.saved == [(card["id"], "A", "desktop")]  # the card_answer event is saved


async def test_a_typed_answer_comes_back_with_its_text():
    rig = Rig()
    waiting = rig.ask(job_id=rig.job(), free_text=True)
    card = await rig.card()
    rig.asks.answer(card["id"], "", "desktop", "teal")
    assert await waiting == ("", "teal")


async def test_the_ask_is_an_expert_ask_item_and_a_work_row_until_answered():
    rig = Rig()
    waiting = rig.ask(job_id=rig.job(), ask_id="a1", tool="claude_code:ls")
    await rig.card()
    item = rig.items.get("a1")
    assert (item.kind, item.state, item.live_only, item.job_id) == (
        "expert_ask",
        "open",
        True,
        "j1",
    )
    assert rig.work.get("a1").state == "active" and rig.work.get("a1").parent_id == "j1"
    rig.asks.answer("a1", "A", "desktop")
    await waiting
    assert rig.items.get("a1").state == "done"
    row = rig.work.get("a1")
    assert (row.state, row.end_reason) == ("done", "answered")
    assert rig.work.events("a1")[-1].data["option"] == "A"


async def test_an_item_belongs_to_the_task_of_its_job():
    rig = Rig()
    rig.ask(job_id=rig.job(task_id=rig.task()), ask_id="a1")
    await rig.card()
    assert rig.items.get("a1").task_id == "k1"


async def test_a_confirm_card_for_an_experts_tool_call_returns_allow_always_or_deny():
    rig = Rig()
    waiting = asyncio.ensure_future(rig.holds.permission(call(), "desktop__x", False))
    card = await rig.card()
    assert card == {
        "id": card["id"],
        "state": "open",
        "text": "Opening it.",
        "options": ["allow", "always", "deny"],
        "confirm": True,
        "tool": "desktop__x",
        "input": {"a": 1},
    }
    rig.asks.answer(card["id"], "always", "desktop")
    assert await waiting == "always"


async def test_a_locked_tool_offers_two_options():
    rig = Rig()
    waiting = asyncio.ensure_future(rig.holds.permission(call(), "desktop__x", True))
    card = await rig.card()
    assert card["options"] == ["allow", "deny"]
    rig.asks.answer(card["id"], "deny", "desktop")
    assert await waiting == "deny"


async def test_a_second_answer_is_not_found_and_an_unoffered_option_is_refused():
    rig = Rig()
    waiting = asyncio.ensure_future(rig.holds.permission(call(), "desktop__x", True))
    card = await rig.card()
    with pytest.raises(RpcError) as bad:
        rig.asks.answer(card["id"], "always", "desktop")
    assert bad.value.code == ErrorCode.invalid_params
    rig.asks.answer(card["id"], "allow", "desktop")
    with pytest.raises(RpcError) as late:
        rig.asks.answer(card["id"], "deny", "extension")
    assert late.value.code == ErrorCode.not_found
    assert await waiting == "allow"


async def test_a_card_with_nobody_online_stays_open_for_a_body_that_joins():
    rig = Rig(online=())
    rig.ask(job_id=rig.job())
    await asyncio.sleep(0)
    assert rig.holds.anyone_online() is False
    assert len(rig.asks.open_asks()) == 1


async def test_a_cancelled_wait_closes_the_card_and_the_item():
    rig = Rig()
    waiting = rig.ask(job_id=rig.job(), ask_id="a1")
    card = await rig.card()
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert rig.last() == {"id": card["id"], "state": "closed", "reason": "cancelled"}
    assert rig.asks.open_asks() == []
    assert rig.items.get("a1").state == "expired"
    assert (rig.work.get("a1").state, rig.work.get("a1").end_reason) == ("expired", "ask cancelled")
    with pytest.raises(RpcError):
        rig.asks.answer("a1", "A", "desktop")


async def test_a_job_that_ends_releases_the_wait_with_why():
    rig = Rig()
    waiting = rig.ask(job_id=rig.job(), ask_id="a1")
    await rig.card()
    rig.work.close_goal("j1", "done", "finished")
    with pytest.raises(AskExpired) as err:
        await waiting
    assert err.value.reason == "job ended: closed by Scout"
    assert rig.asks.open_asks() == []
    assert rig.last() == {"id": "a1", "state": "closed", "reason": "timeout"}


async def test_cancelling_a_part_cancels_only_its_held_cards():
    rig = Rig()
    job = rig.job()
    one = rig.ask(job_id=job, part="p1", ask_id="a1")
    two = rig.ask(job_id=job, part="p2", ask_id="a2")
    await rig.card(2)
    rig.holds.cancel_part(job, "p1")
    with pytest.raises(RpcError) as err:
        await one
    assert err.value.code == ErrorCode.cancelled
    assert [a["id"] for a in rig.asks.open_asks()] == ["a2"]
    assert not two.done()
    two.cancel()


async def test_a_card_of_a_task_adds_not_now_and_stop_the_task():
    rig = Rig()
    rig.ask(job_id=rig.job(task_id=rig.task()), ask_id="a1")
    card = await rig.card()
    assert card["options"] == ["A", "B", "not_now", "stop_task"]
    assert card["task"] == {"id": "k1", "title": "Fix the build"}
    assert card["check_back_by"] == "scout" and card["check_back_at"]


async def test_a_card_with_no_task_or_an_ask_task_shows_no_task_options():
    rig = Rig()
    rig.ask(job_id=rig.job("j1"), ask_id="a1")
    rig.ask(job_id=rig.job("j2", task_id=rig.task("ask", "k2")), ask_id="a2")
    one, two = await rig.card(1), await rig.card(2)
    assert one["options"] == two["options"] == ["A", "B"]
    assert "task" not in one and "task" not in two


async def test_not_now_moves_the_check_back_and_keeps_the_wait():
    rig = Rig()
    waiting = rig.ask(job_id=rig.job(task_id=rig.task()), ask_id="a1")
    await rig.card()
    rig.asks.answer("a1", "not_now", "desktop", None, "2026-11-18T15:30:00+00:00")
    item = rig.items.get("a1")
    assert (item.state, item.check_back_by) == ("open", "person")
    assert item.check_back_at == datetime(2026, 11, 18, 15, 30, tzinfo=UTC)
    assert rig.last()["check_back_at"] == "2026-11-18T15:30:00+00:00"
    assert not waiting.done() and rig.asks.is_open("a1")
    rig.asks.answer("a1", "A", "desktop")  # still answerable later
    assert await waiting == ("A", None)


async def test_stop_the_task_ends_it_and_cancels_every_card_it_holds():
    rig = Rig()
    job = rig.job(task_id=rig.task())
    one = rig.ask(job_id=job, ask_id="a1", part="p1")
    two = rig.ask(job_id=job, ask_id="a2", part="p2")
    await rig.card(2)
    rig.asks.answer("a1", "stop_task", "desktop")
    for waiting in (one, two):
        with pytest.raises(RpcError) as err:
            await waiting
        assert err.value.code == ErrorCode.cancelled
    assert rig.tasks.get("k1").state == "stopped"
    assert rig.asks.open_asks() == []


async def test_a_stopped_task_opens_no_new_card():
    rig = Rig()
    job = rig.job(task_id=rig.task())
    rig.tasks.stop("k1", "desktop")
    with pytest.raises(RpcError) as err:
        await rig.holds.ask(kind="question", text="Which?", options=["A"], job_id=job)
    assert err.value.code == ErrorCode.cancelled
    assert rig.cards() == [] and rig.asks.open_asks() == []


async def test_a_toolbox_card_owns_no_part_so_cancelling_p1_leaves_it():
    rig = Rig()
    job = rig.job()
    waiting = asyncio.ensure_future(
        rig.holds.permission(call(), "desktop__x", False, parent_id=job)
    )
    other = rig.ask(job_id=job, part="p1", ask_id="a1")
    await rig.card(2)
    rig.holds.cancel_part(job, "p1")
    with pytest.raises(RpcError):
        await other
    assert not waiting.done()
    waiting.cancel()


async def test_close_cancels_a_held_card_and_only_tells_bodies_of_another():
    rig = Rig()
    waiting = rig.ask(job_id=rig.job(), ask_id="a1")
    await rig.card()
    rig.holds.close(["a1", "gone"])
    with pytest.raises(RpcError) as err:
        await waiting
    assert err.value.code == ErrorCode.cancelled
    assert rig.asks.open_asks() == []
    assert {"id": "gone", "state": "closed", "reason": "timeout"} in [p for _, p in rig.bodies.sent]


async def test_a_card_scout_granted_closes_as_answered_by_scout():
    rig = Rig()
    waiting = rig.ask(job_id=rig.job(task_id=rig.task()), ask_id="a1")
    await rig.card()
    rig.items.answer("a1", "allow", "scout")
    rig.items.finish("a1", "approved")
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert rig.last() == {
        "id": "a1", "state": "closed", "reason": "answered", "option": "allow", "by": "scout",
    }  # fmt: skip
