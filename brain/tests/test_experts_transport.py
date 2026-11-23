"""An expert run over a node pipe: the same ACP session as over local stdio, a command the node
does not list is refused with the line to approve it, and a node that drops ends the run."""

import json
import sys
from pathlib import Path

import pytest

from brain.bodies import Bodies
from brain.experts import ExpertError, ExpertHosts, ExpertRun
from brain.placements import Placements
from brain.protocol import PipeSpec
from brain.setup.store import InstalledExpert
from brain.store.db import open_db
from tests.fake_node import FakeNode

AGENT = str(Path(__file__).parent / "fake_acp_agent.py")


class Side:
    def __init__(self) -> None:
        self.progress: list[str] = []
        self.ends: list[tuple] = []

    async def on_permission(self, request):
        return None

    async def on_question(self, question):
        return None

    async def on_progress(self, text: str) -> None:
        self.progress.append(text)

    async def on_end(self, state, reason, result) -> None:
        self.ends.append((state, reason, result))


@pytest.fixture
def rig(tmp_path, monkeypatch):
    script = tmp_path / "script.json"
    monkeypatch.setenv("FAKE_ACP_SCRIPT", str(script))
    monkeypatch.setenv("FAKE_ACP_LOG", str(tmp_path / "log.jsonl"))
    bodies = Bodies()
    node = FakeNode(bodies, tmp_path)
    node.allowlist.allow(PipeSpec(command=sys.executable, args=[AGENT]))
    node.connect()
    hosts = ExpertHosts(bodies=bodies, placements=Placements(open_db(tmp_path / "t.db")))
    expert = InstalledExpert("fake", "Fake", "1", [sys.executable, AGENT], "registry", True)

    def run(side: Side, steps) -> ExpertRun:
        script.write_text(json.dumps(steps))
        return hosts(
            expert,
            host="pc",
            on_permission=side.on_permission,
            on_question=side.on_question,
            on_progress=side.on_progress,
            on_end=side.on_end,
        )

    return bodies, node, hosts, run, expert


async def test_an_expert_runs_over_a_node_pipe(rig, tmp_path):
    _, _, hosts, run, _ = rig
    side = Side()
    expert_run = run(side, [{"text": "hello"}])
    modes = await expert_run.start(tmp_path)
    await expert_run.begin(modes[0].id, "go")
    await expert_run._task
    assert side.ends == [("done", "end_turn", "hello")]
    await hosts.shutdown()


async def test_a_command_the_node_does_not_list_says_what_to_approve(rig, tmp_path):
    bodies, node, hosts, _, expert = rig
    other = InstalledExpert("other", "Other", "1", [sys.executable, "other.py"], "registry", True)
    side = Side()
    expert_run = hosts(
        other,
        host="pc",
        on_permission=side.on_permission,
        on_question=side.on_question,
        on_progress=side.on_progress,
        on_end=side.on_end,
    )
    with pytest.raises(ExpertError) as err:
        await expert_run.start(tmp_path)
    assert "tagalong node allow" in str(err.value) and "Laptop" in str(err.value)
    await hosts.shutdown()


async def test_a_node_that_drops_ends_the_run_as_an_error(rig, tmp_path):
    bodies, node, hosts, run, _ = rig
    side = Side()
    expert_run = run(side, [{"text": "working"}, {"hang": True}])
    modes = await expert_run.start(tmp_path)
    await expert_run.begin(modes[0].id, "go")
    bodies.disconnect("pc", node)
    await expert_run._task
    assert side.ends[0][0] == "error"
    await hosts.shutdown()
