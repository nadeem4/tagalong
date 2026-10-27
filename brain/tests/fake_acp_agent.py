"""A scripted stand-in for the Claude Code ACP adapter, used by every expert test.

Run as a subprocess over stdio. FAKE_ACP_SCRIPT names a JSON list of steps replayed on
each session/prompt; FAKE_ACP_LOG names a file that gets every frame the client sent,
one JSON object per line. Frame shapes follow tests/fixtures/acp/. Needs only Python.

The script may instead be a list of step lists, one per prompt (the last is reused).
Steps: {"sleep": secs} pause | {"crash": code} os._exit mid-prompt | {"text": s} message
chunk | {"permission": {"title", "kind"?, "options"?}} ask and wait |
{"question": {"message", "options": [labels]}} elicitation and wait | {"hang": true}
wait until session/cancel | {"stubborn": true} hang, ignoring cancel | {"end": stop_reason}
finish the prompt (default end_turn). Env FAKE_ACP_HANG_INIT=1 never answers initialize.
"""

import asyncio
import json
import os
from pathlib import Path

import acp
from acp import schema
from acp.connection import StreamDirection

MODES = [
    ("default", "Manual", "Always ask before making changes"),
    ("acceptEdits", "Accept edits", "Automatically accept all file edits"),
    ("plan", "Plan", "Create a plan before making changes"),
    ("auto", "Auto", "Claude handles permission decisions"),
    ("bypassPermissions", "Bypass permissions", "Accepts all permissions"),
]
# The same two options the real adapter offers for a tool call.
DEFAULT_OPTIONS = [
    {"id": "allow-once", "name": "Yes", "kind": "allow_once"},
    {"id": "reject", "name": "No", "kind": "reject_once"},
]


class FakeAgent:
    def __init__(self, steps: list[dict]) -> None:
        self.steps = steps
        self.running: dict[str, asyncio.Task] = {}
        self.turn = 0
        self.stubborn = False

    def on_connect(self, conn) -> None:
        self.conn = conn

    async def initialize(self, protocol_version, client_capabilities=None, **kw):
        if os.environ.get("FAKE_ACP_HANG_INIT"):
            await asyncio.Event().wait()  # an adapter that never answers the handshake
        return schema.InitializeResponse(
            protocol_version=1, agent_info=schema.Implementation(name="fake-acp", version="0")
        )

    async def new_session(self, cwd, **kw):
        modes = schema.SessionModeState(
            current_mode_id="default",
            available_modes=[schema.SessionMode(id=i, name=n, description=d) for i, n, d in MODES],
        )
        return schema.NewSessionResponse(session_id="sess-1", modes=modes)

    async def set_session_mode(self, session_id, mode_id, **kw):
        return schema.SetSessionModeResponse()

    async def prompt(self, session_id, prompt, **kw):
        steps = self._steps_for_turn()
        task = asyncio.ensure_future(self._run_steps(session_id, steps))
        self.running[session_id] = task
        try:
            return schema.PromptResponse(stop_reason=await task)
        except asyncio.CancelledError:
            if task.cancelled():
                return schema.PromptResponse(stop_reason="cancelled")
            raise
        finally:
            self.running.pop(session_id, None)

    async def cancel(self, session_id, **kw):
        # Only a running prompt can be cancelled; a late cancel must not hit the next one.
        if self.stubborn:
            return
        if task := self.running.get(session_id):
            task.cancel()

    def _steps_for_turn(self) -> list[dict]:
        # A list of lists gives each prompt its own steps; the last list is reused after that.
        if not self.steps or not all(isinstance(s, list) for s in self.steps):
            return self.steps
        turn, self.turn = self.turn, self.turn + 1
        return self.steps[min(turn, len(self.steps) - 1)]

    async def ext_method(self, method, params):
        return {}

    async def ext_notification(self, method, params):
        pass

    async def _run_steps(self, session_id: str, steps: list[dict]) -> str:
        for step in steps:
            if "text" in step:
                await self.conn.session_update(
                    session_id, acp.update_agent_message_text(step["text"])
                )
            elif "permission" in step:
                await self._ask_permission(session_id, step["permission"])
            elif "question" in step:
                await self._ask_question(session_id, step["question"])
            elif "sleep" in step:
                await asyncio.sleep(step["sleep"])
            elif "crash" in step:
                # Abrupt exit, no cleanup: what a crashed adapter looks like to the runner.
                os._exit(step["crash"])
            elif step.get("stubborn"):
                # Hangs and ignores session/cancel, like a wedged adapter.
                self.stubborn = True
                await asyncio.Event().wait()
            elif step.get("hang"):
                await asyncio.Event().wait()
            elif "end" in step:
                return step["end"]
        return "end_turn"

    async def _ask_permission(self, session_id: str, spec: dict) -> None:
        call = schema.ToolCallUpdate(
            tool_call_id="call-1",
            title=spec["title"],
            kind=spec.get("kind", "other"),
            raw_input=spec.get("input", {}),
        )
        options = [
            schema.PermissionOption(option_id=o["id"], name=o["name"], kind=o["kind"])
            for o in spec.get("options", DEFAULT_OPTIONS)
        ]
        await self.conn.request_permission(session_id, call, options)

    async def _ask_question(self, session_id: str, spec: dict) -> None:
        # Same form Claude Code builds for AskUserQuestion: one choice plus a free-text box.
        properties = {
            "question_0": {
                "type": "string",
                "title": spec.get("header", "Question"),
                "oneOf": [{"const": o, "title": o} for o in spec["options"]],
            },
            "question_0_custom": {"type": "string", "title": "Other"},
        }
        mode = schema.ElicitationFormSessionMode(
            session_id=session_id,
            tool_call_id="call-2",
            requested_schema={"type": "object", "properties": properties},
        )
        await self.conn.create_elicitation(spec["message"], mode)


def frame_logger(path: str):
    def observe(event) -> None:
        if event.direction == StreamDirection.INCOMING:
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(event.message) + "\n")

    return observe


async def main() -> None:
    script = os.environ.get("FAKE_ACP_SCRIPT")
    steps = json.loads(Path(script).read_text()) if script else []
    log = os.environ.get("FAKE_ACP_LOG")
    observers = [frame_logger(log)] if log else []
    if log:
        # Lets tests prove which secrets reached the child and that the rest was inherited.
        env = {k: os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
        env["PATH_set"] = "PATH" in os.environ
        with open(log, "a", encoding="utf-8") as f:
            f.write(json.dumps({"env": env}) + "\n")
    # run_agent returns when stdin closes, which is how the real adapter ends too.
    await acp.run_agent(FakeAgent(steps), use_unstable_protocol=True, observers=observers)


if __name__ == "__main__":
    asyncio.run(main())
