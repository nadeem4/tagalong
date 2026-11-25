"""A node for the brain-side tests: a body whose frames go to the real node pipes, with an
allow-list approving what the test names and a real child behind them (a fake MCP server)."""

import asyncio
import base64
import json
import sys
from pathlib import Path

from brain.auth import Principal
from brain.bodies import Bodies
from brain.node.allowlist import Allowlist
from brain.node.pipes import Child, Pipes, spawn_process
from brain.protocol import Body, PipeSpec, RpcError
from brain.setup.store import ExpertStore

FAKE = str(Path(__file__).parent / "fake_mcp_server.py")


class FakeNode:
    def __init__(
        self, bodies: Bodies, tmp_path: Path, body_id: str = "pc", device_id: str | None = None
    ) -> None:
        self.bodies = bodies
        self.device_id = device_id
        self.body_id = body_id
        self.allowlist = Allowlist(tmp_path / "allowlist.json")
        self.allowlist.allow(PipeSpec(command=sys.executable, args=[FAKE]))
        self._children: list[Child] = []
        # every frame to or from the brain, pipe_data bodies also decoded, and the pipe_open replies
        self.frames: list[str] = []
        self.experts = ExpertStore(tmp_path)
        self.pipes = Pipes(self.allowlist, self._to_brain, self.experts, self._spawn)
        self.opened: list[PipeSpec] = []
        self.folders: set[str] = set()
        self._tasks: set[asyncio.Task] = set()
        self.closed = False
        self.hold_open = False
        self.opened_ids: list[str] = []
        self.closed_pipes: list[str] = []

    async def _spawn(self, path: str, args: list[str], env: dict[str, str]) -> Child:
        child = await spawn_process(path, args, env)
        self._children.append(child)
        return child

    async def aclose(self) -> None:
        """End every child and wait for it, so no subprocess outlives the test's loop."""
        await self.pipes.close_all()
        await asyncio.gather(*(child.wait() for child in self._children))

    def connect(self) -> None:
        body = Body(id=self.body_id, kind="node", name="Laptop", display=False)
        principal = Principal("device:pc", "Laptop", "node", False, self.device_id)
        self.bodies.connect(body, [], self, None, principal)

    def _to_brain(self, method: str, params: dict) -> None:
        self._record(json.dumps({"method": method, "params": params}), params)
        self.bodies.pipe_event(self.body_id, self, method, params)

    def send(self, frame: str) -> None:
        message = json.loads(frame)
        self._record(frame, message.get("params", {}))
        task = asyncio.create_task(self._handle(message))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _record(self, frame: str, params: dict) -> None:
        self.frames.append(frame)
        if "data" in params:
            self.frames.append(base64.b64decode(params["data"]).decode("utf-8", "replace"))

    def close(self) -> None:
        self.closed = True

    async def _handle(self, message: dict) -> None:
        method, params = message["method"], message["params"]
        if method == "pipe_open":
            spec = PipeSpec.model_validate(params["spec"])
            self.opened.append(spec)
            self.opened_ids.append(params["pipe"])
            if self.hold_open:
                return
            try:
                await self.pipes.open(params["pipe"], spec)
                reply = {"jsonrpc": "2.0", "id": message["id"], "result": {}}
            except RpcError as err:
                reply = {
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {"code": int(err.code), "message": err.message},
                }
            self.frames.append(json.dumps(reply))
            self.bodies.resolve(self.body_id, self, reply)
        elif method == "folder_check":
            exists = params["path"] in self.folders
            self.bodies.resolve(
                self.body_id,
                self,
                {"jsonrpc": "2.0", "id": message["id"], "result": {"exists": exists}},
            )
        elif method == "pipe_data":
            self.pipes.write(params["pipe"], params["data"])
        elif method == "pipe_close":
            self.closed_pipes.append(params["pipe"])
            await self.pipes.close(params["pipe"])
