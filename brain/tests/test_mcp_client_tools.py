"""Scout connecting an AI tool: the brain makes the client and hands its token to the desktop
body directly, so the token never reaches the model. Fake bodies; no real tool or API.
"""

import pytest

from brain.devices import Devices
from brain.mcp_client_tools import connect_ai_tool_tools
from brain.memory import Memory
from brain.protocol import Body, ErrorCode, RpcError

NOW = "2026-11-22T00:00:00Z"


class FakeBodies:
    def __init__(self, bodies, local=(), fail=None):
        self._bodies = bodies
        self._local = set(local)
        self._fail = fail
        self.used = []

    def online(self):
        return self._bodies

    def is_local(self, body_id):
        return body_id in self._local

    async def use(self, body_id, call_id, tool, tool_input, timeout=30.0):
        self.used.append((body_id, tool, tool_input))
        if self._fail:
            raise self._fail
        return [{"type": "text", "text": "Connected Claude Code. The bridge answered."}]


def rig(tmp_path, bodies):
    devices = Devices(Memory(tmp_path / "t.db").db, lambda: NOW)
    handlers = {s.name: h for s, h in connect_ai_tool_tools(devices, bodies)}
    return devices, handlers


DESKTOP = Body(id="desk", kind="desktop", name="PC")


async def test_the_token_goes_to_the_desktop_and_never_to_the_model(tmp_path):
    bodies = FakeBodies([DESKTOP], local=["desk"])
    devices, handlers = rig(tmp_path, bodies)
    answer = await handlers["connect_ai_tool"]({"tool": "claude-code", "personal": True})
    ((body_id, tool, given),) = bodies.used
    assert (body_id, tool) == ("desk", "connect_ai_tool")
    assert given["tool"] == "claude-code"
    principal = devices.verify(given["token"])
    assert (principal.kind, principal.name, principal.personal) == (
        "mcp_client",
        "claude-code",
        True,
    )
    assert given["token"] not in answer
    assert "Connected Claude Code" in answer


async def test_connecting_again_rotates_the_token(tmp_path):
    bodies = FakeBodies([DESKTOP], local=["desk"])
    devices, handlers = rig(tmp_path, bodies)
    await handlers["connect_ai_tool"]({"tool": "codex"})
    await handlers["connect_ai_tool"]({"tool": "codex"})
    first, second = (used[2]["token"] for used in bodies.used)
    assert devices.verify(first) is None
    assert devices.verify(second) is not None


async def test_a_desktop_on_the_brains_pc_is_chosen_over_another(tmp_path):
    other = Body(id="laptop", kind="desktop", name="Laptop")
    bodies = FakeBodies([other, DESKTOP], local=["desk"])
    _, handlers = rig(tmp_path, bodies)
    await handlers["connect_ai_tool"]({"tool": "cursor"})
    assert bodies.used[0][0] == "desk"


async def test_a_failed_set_up_cuts_the_new_client_off_and_says_why(tmp_path):
    failure = RpcError(ErrorCode.tool_failed, "claude is not installed")
    bodies = FakeBodies([DESKTOP], local=["desk"], fail=failure)
    devices, handlers = rig(tmp_path, bodies)
    with pytest.raises(RpcError, match="not installed"):
        await handlers["connect_ai_tool"]({"tool": "claude-code"})
    assert devices.verify(bodies.used[0][2]["token"]) is None


@pytest.mark.parametrize("bodies", [[], [Body(id="b", kind="browser", name="Chrome")]])
async def test_without_a_desktop_nothing_is_made(tmp_path, bodies):
    devices, handlers = rig(tmp_path, FakeBodies(bodies))
    with pytest.raises(RpcError):
        await handlers["connect_ai_tool"]({"tool": "claude-code"})
    assert devices.list() == []


async def test_an_unknown_tool_is_refused(tmp_path):
    _, handlers = rig(tmp_path, FakeBodies([DESKTOP], local=["desk"]))
    with pytest.raises(RpcError):
        await handlers["connect_ai_tool"]({"tool": "notepad"})


async def test_show_me_gives_the_line_and_no_secret(tmp_path):
    devices, handlers = rig(tmp_path, FakeBodies([DESKTOP], local=["desk"]))
    text = await handlers["ai_tool_howto"]({"tool": "codex"})
    assert "`codex mcp add tagalong -- cmd /c tagalong memory-mcp --client codex`" in text
    assert "--pair" in text and devices.list() == []


async def test_a_body_call_that_times_out_cuts_the_new_client_off_too(tmp_path):
    bodies = FakeBodies([DESKTOP], local=["desk"], fail=TimeoutError())
    devices, handlers = rig(tmp_path, bodies)
    with pytest.raises(TimeoutError):
        await handlers["connect_ai_tool"]({"tool": "codex"})
    assert devices.verify(bodies.used[0][2]["token"]) is None
