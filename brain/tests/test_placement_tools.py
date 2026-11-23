"""Home's placement tools: read what is set, set a new one, and an app moves when it is set."""

import json

import pytest

from brain.placement_tools import placement_tools
from brain.placements import Placements
from brain.protocol import RpcError
from brain.store.db import open_db


class Rig:
    def __init__(self, tmp_path):
        self.placements = Placements(open_db(tmp_path / "t.db"))
        self.moved: list[str] = []
        self.told: list[tuple[str, dict]] = []

        async def relocate(app_id):
            self.moved.append(app_id)

        tools = placement_tools(
            self.placements, lambda: ["gh"], relocate, lambda m, p: self.told.append((m, p))
        )
        self.handlers = {spec.name: handler for spec, handler in tools}

    async def run(self, name, args=None):
        return json.loads(await self.handlers[name](args or {}))


@pytest.fixture
def rig(tmp_path):
    return Rig(tmp_path)


async def test_set_then_list_shows_the_placement_and_moves_the_app(rig):
    args = {"kind": "app", "id": "gh", "mode": "both", "body_id": "pc", "prefer": "ask"}
    await rig.run("placement_set", args)
    listed = await rig.run("placement_list")
    assert listed["placements"] == [
        {"kind": "app", "id": "gh", "mode": "both", "body_id": "pc", "prefer": "ask"}
    ]
    assert rig.moved == ["gh"]
    assert rig.told == [("changed", {"what": "placements"})]


@pytest.mark.parametrize(
    "args",
    [
        {"kind": "app", "id": "nope", "mode": "brain"},
        {"kind": "app", "id": "gh", "mode": "body"},
        {"kind": "app", "id": "gh", "mode": "both", "body_id": "pc"},
        {"kind": "tool", "id": "gh", "mode": "brain"},
    ],
)
async def test_a_bad_placement_is_refused_and_nothing_is_saved(rig, args):
    with pytest.raises(RpcError):
        await rig.run("placement_set", args)
    assert (await rig.run("placement_list"))["placements"] == []
