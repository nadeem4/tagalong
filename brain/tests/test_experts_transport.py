"""An expert on a node: a command the node does not list is refused with the line to approve it."""

import asyncio
import sys

import pytest

from brain.bodies import Bodies
from brain.experts import ExpertError, ExpertHosts, _quoted
from brain.node_needs import NodeNeeds
from brain.placements import Placements
from brain.protocol import NodeAnsweredParams, PipeSpec
from brain.setup.store import InstalledExpert
from brain.store.db import open_db
from tests.fake_node import FakeNode


async def test_a_command_the_node_does_not_list_says_what_to_approve(tmp_path):
    bodies = Bodies()
    node = FakeNode(bodies, tmp_path)
    node.allowlist.allow(PipeSpec(command=sys.executable, args=[]))
    node.connect()
    hosts = ExpertHosts(
        bodies=bodies,
        placements=Placements(open_db(tmp_path / "t.db")),
        needs=NodeNeeds(bodies),
    )
    other = InstalledExpert(
        "other", "Other", "1", [sys.executable, "my agent.py"], "registry", True
    )

    async def nothing(*_args):
        return None

    expert_run = hosts(
        other,
        host="pc",
        on_permission=nothing,
        on_question=nothing,
        on_progress=nothing,
        on_end=nothing,
    )
    with pytest.raises(ExpertError) as err:
        await expert_run.start(tmp_path)
    assert str(err.value) == (
        "Other is not approved on Laptop. On that machine run: "
        f'tagalong node allow {_quoted(sys.executable)} -- "my agent.py"'
    )
    await hosts.shutdown()


async def test_the_approve_line_quotes_an_argument_the_shell_would_split(tmp_path):
    bodies = Bodies()
    node = FakeNode(bodies, tmp_path)
    node.connect()
    hosts = ExpertHosts(
        bodies=bodies,
        placements=Placements(open_db(tmp_path / "t.db")),
        needs=NodeNeeds(bodies),
    )
    other = InstalledExpert(
        "other", "Other", "1", [sys.executable, "a&b", 'say "hi"'], "registry", True
    )

    async def nothing(*_args):
        return None

    expert_run = hosts(
        other,
        host="pc",
        on_permission=nothing,
        on_question=nothing,
        on_progress=nothing,
        on_end=nothing,
    )
    with pytest.raises(ExpertError) as err:
        await expert_run.start(tmp_path)
    assert str(err.value).endswith('-- "a&b" "say \\"hi\\""')
    await hosts.shutdown()


async def test_an_expert_the_node_refuses_asks_the_desktop_and_a_not_now_keeps_the_old_line(
    tmp_path,
):
    from tests.test_node_needs import Desk

    bodies = Bodies()
    node = FakeNode(bodies, tmp_path, device_id="d1")
    node.connect()
    desk = Desk(bodies, "desk", "d1")
    needs = NodeNeeds(bodies)
    hosts = ExpertHosts(
        bodies=bodies, placements=Placements(open_db(tmp_path / "t.db")), needs=needs
    )
    other = InstalledExpert("other", "Other", "1", [sys.executable, "agent.py"], "registry", True)

    async def nothing(*_args):
        return None

    expert_run = hosts(
        other,
        host="pc",
        on_permission=nothing,
        on_question=nothing,
        on_progress=nothing,
        on_end=nothing,
    )
    starting = asyncio.create_task(expert_run.start(tmp_path))
    for _ in range(20):
        await asyncio.sleep(0)
    (frame,) = desk.needs()
    assert frame["expert"] == "other" and frame["need"] == "approve"
    await needs.answered("desk", NodeAnsweredParams(id=frame["id"], outcome="not_now"))
    with pytest.raises(ExpertError) as err:
        await starting
    assert str(err.value).startswith("Other is not approved on Laptop. On that machine run: ")
    await hosts.shutdown()
    await node.aclose()
