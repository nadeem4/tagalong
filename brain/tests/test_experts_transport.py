"""An expert on a node: a command the node does not list is refused with the line to approve it."""

import sys

import pytest

from brain.bodies import Bodies
from brain.experts import ExpertError, ExpertHosts
from brain.placements import Placements
from brain.protocol import PipeSpec
from brain.setup.store import InstalledExpert
from brain.store.db import open_db
from tests.fake_node import FakeNode


async def test_a_command_the_node_does_not_list_says_what_to_approve(tmp_path):
    bodies = Bodies()
    node = FakeNode(bodies, tmp_path)
    node.allowlist.allow(PipeSpec(command=sys.executable, args=[]))
    node.connect()
    hosts = ExpertHosts(bodies=bodies, placements=Placements(open_db(tmp_path / "t.db")))
    other = InstalledExpert(
        "other", "Other", "1", ["C:\\Program Files\\other.exe", "my agent.py"], "registry", True
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
        'tagalong node allow "C:\\Program Files\\other.exe" -- "my agent.py"'
    )
    await hosts.shutdown()


async def test_the_approve_line_quotes_an_argument_the_shell_would_split(tmp_path):
    bodies = Bodies()
    node = FakeNode(bodies, tmp_path)
    node.connect()
    hosts = ExpertHosts(bodies=bodies, placements=Placements(open_db(tmp_path / "t.db")))
    other = InstalledExpert(
        "other", "Other", "1", ["agent.exe", "a&b", 'say "hi"'], "registry", True
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
    assert str(err.value).endswith('tagalong node allow agent.exe -- "a&b" "say \\"hi\\""')
    await hosts.shutdown()
