"""An app's calls go where its placement says (this brain, or a node's pipe) and always through
the permission engine, with the rule keyed by app and tool. Fake MCP server, fake node.
"""

import asyncio
import json
import sys
from datetime import UTC, datetime
from functools import partial

import pytest
from ask_log import approvals_on

from brain.app_tools import AppSource, app_home_tools
from brain.apps import AppRow, Apps, TokenFile
from brain.bodies import Bodies
from brain.memory import Memory
from brain.mind.turn import Call
from brain.node_needs import NodeNeeds
from brain.permission import Engine, Person, StandingRule, stored_auto_rules
from brain.placements import Placement, Placements
from brain.protocol import ErrorCode, RpcError
from brain.store import rules
from brain.toolbox import Toolbox
from tests.fake_node import FAKE, FakeNode

ROW = AppRow("fake", "Fake", "stdio", {"command": sys.executable, "args": [FAKE]}, "none", True)


class FakeAsks:
    def __init__(self) -> None:
        self.asked: list[str] = []

    def anyone_online(self) -> bool:
        return True

    async def permission(self, call, spec_name, locked, **ids):
        self.asked.append(spec_name)
        return "allow"


class Rig:
    def __init__(self, tmp_path, placement: Placement | None) -> None:
        self.memory = Memory(tmp_path / "t.db")
        self.memory.add_app(ROW)
        self.bodies = Bodies()
        self.node = FakeNode(self.bodies, tmp_path)
        self.placements = Placements(self.memory.db)
        if placement is not None:
            self.placements.set("app", "fake", placement)
        self.apps = Apps(
            self.memory,
            lambda *_: None,
            {},
            placements=self.placements,
            bodies=self.bodies,
            needs=NodeNeeds(self.bodies),
        )
        self.where_asked: list[tuple[str, str]] = []
        self.pick_body = True

        async def ask_where(app_id: str, body_id: str) -> bool:
            self.where_asked.append((app_id, body_id))
            return self.pick_body

        self.asks = FakeAsks()
        modes = partial(rules.permission_modes, self.memory.db)
        approvals = approvals_on(
            self.memory, lambda m, p: None, lambda: datetime(2026, 1, 1, tzinfo=UTC)
        )
        self.toolbox = Toolbox(
            [AppSource(self.apps, ask_where)],
            modes,
            partial(rules.set_permission_mode, self.memory.db),
            self.asks,
            Engine(
                [StandingRule(stored_auto_rules(modes)), Person()], approvals, None, lambda n: None
            ),
        )

    async def start(self, node_online: bool = True) -> None:
        if node_online:
            self.node.connect()
        await self.apps.start()
        await self.apps.wait_settled("fake", 30)

    async def call(self, turn: str = "t1") -> str:
        out = await self.toolbox.run(Call("c1", "fake__echo", {"text": "hi"}, turn, ""))
        assert isinstance(out, str)
        return out

    async def close(self) -> None:
        await self.apps.shutdown()
        await self.node.aclose()
        self.memory.close()


@pytest.fixture
async def make(tmp_path):
    rigs: list[Rig] = []

    async def build(placement, node_online=True):
        rig = Rig(tmp_path, placement)
        rigs.append(rig)
        await rig.start(node_online)
        return rig

    yield build
    for rig in rigs:
        await rig.close()


@pytest.mark.parametrize("placement", [None, Placement("body", "pc")])
async def test_the_same_rule_asks_wherever_the_app_runs(make, placement):
    rig = await make(placement)
    assert "hi" in await rig.call()
    assert rig.asks.asked == ["fake__echo"]
    assert bool(rig.node.opened) == (placement is not None)
    rules.set_permission_mode(rig.memory.db, "fake__echo", "auto")
    await rig.call()
    assert rig.asks.asked == ["fake__echo"]


async def test_ask_me_asks_once_per_turn_not_per_call(make):
    rig = await make(Placement("both", "pc", "ask"))
    rules.set_permission_mode(rig.memory.db, "fake__echo", "auto")
    await rig.call("t1")
    await rig.call("t1")
    assert rig.where_asked == [("fake", "pc")]
    assert rig.node.opened  # the person picked the node
    await rig.call("t2")
    assert len(rig.where_asked) == 2


async def test_ask_me_is_the_brain_for_a_call_with_no_turn(make):
    rig = await make(Placement("both", "pc", "ask"))
    rules.set_permission_mode(rig.memory.db, "fake__echo", "auto")
    assert "hi" in await rig.call(turn="")
    assert rig.where_asked == []
    assert not rig.node.opened


async def test_an_app_placed_on_a_node_that_is_offline_says_so_plainly(make):
    rig = await make(Placement("body", "pc"), node_online=False)
    with pytest.raises(RpcError) as err:
        await rig.toolbox.run(Call("c1", "fake__echo", {"text": "hi"}, "t1", ""))
    assert err.value.code == ErrorCode.body_offline
    assert "not connected right now" in err.value.message


async def test_an_app_waiting_on_an_offline_node_names_it_in_its_listing(make, tmp_path):
    rig = await make(Placement("body", "pc"), node_online=False)
    assert rig.apps.status("fake").waiting_on == "pc"
    rig.node.connect()
    rig.bodies.disconnect("pc", rig.node)
    home = app_home_tools(rig.apps, rig.memory, TokenFile(tmp_path), lambda *_: None, rig.bodies)
    row = json.loads(await {s.name: h for s, h in home}["list_apps"]({}))["apps"][0]
    assert (row["waiting_on"], row["waiting_on_name"]) == ("pc", "Laptop")


async def test_prefer_body_falls_back_to_the_brain_when_the_node_is_offline(make):
    rig = await make(Placement("both", "pc", "body"), node_online=False)
    assert "hi" in await rig.call()
    assert not rig.node.opened


async def test_a_body_only_app_works_once_its_node_connects(make):
    rig = await make(Placement("body", "pc"), node_online=False)
    rig.node.connect()
    rig.apps.body_changed("pc")
    async with asyncio.timeout(30):
        while rig.apps.status("fake").state != "connected":
            await asyncio.sleep(0.05)
    assert "hi" in await rig.call()
    assert rig.node.opened


async def test_calls_in_one_turn_start_the_app_once(make):
    rig = await make(Placement("both", "pc", "ask"))
    rules.set_permission_mode(rig.memory.db, "fake__echo", "auto")
    calls = [Call(f"c{n}", "fake__echo", {"text": "hi"}, "t1", "") for n in range(3)]
    results = await asyncio.gather(*(rig.toolbox.run(call) for call in calls))
    assert all("hi" in result for result in results)
    assert len(rig.node.opened) == 1
