"""A node for the brain-side tests: a body whose frames go to the real node pipes, with an
allow-list approving what the test names and a real child behind them (a fake MCP server)."""

import asyncio
import json
import sys
from pathlib import Path

from brain.auth import Principal
from brain.bodies import Bodies
from brain.node.allowlist import Allowlist
from brain.node.pipes import Pipes
from brain.protocol import Body, PipeSpec, RpcError

FAKE = str(Path(__file__).parent / "fake_mcp_server.py")


class FakeNode:
    def __init__(self, bodies: Bodies, tmp_path: Path, body_id: str = "pc") -> None:
        self.bodies = bodies
        self.body_id = body_id
        self.allowlist = Allowlist(tmp_path / "allowlist.json")
        self.allowlist.allow(PipeSpec(command=sys.executable, args=[FAKE]))
        self.pipes = Pipes(self.allowlist, lambda m, p: bodies.pipe_event(body_id, self, m, p))
        self.opened: list[PipeSpec] = []
        self._tasks: set[asyncio.Task] = set()
        self.closed = False

    def connect(self) -> None:
        body = Body(id=self.body_id, kind="node", name="Laptop", display=False)
        self.bodies.connect(body, [], self, None, Principal("device:pc", "Laptop", "node", False))

    def send(self, frame: str) -> None:
        message = json.loads(frame)
        task = asyncio.create_task(self._handle(message))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def close(self) -> None:
        self.closed = True

    async def _handle(self, message: dict) -> None:
        method, params = message["method"], message["params"]
        if method == "pipe_open":
            spec = PipeSpec.model_validate(params["spec"])
            self.opened.append(spec)
            try:
                await self.pipes.open(params["pipe"], spec)
                reply = {"jsonrpc": "2.0", "id": message["id"], "result": {}}
            except RpcError as err:
                reply = {
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {"code": int(err.code), "message": err.message},
                }
            self.bodies.resolve(self.body_id, self, reply)
        elif method == "pipe_data":
            self.pipes.write(params["pipe"], params["data"])
        elif method == "pipe_close":
            await self.pipes.close(params["pipe"])
