"""A scripted stand-in for the Claude Code ACP adapter, used by every expert test.

Run as a subprocess over stdio. FAKE_ACP_SCRIPT names a JSON list of steps replayed on
each session/prompt; FAKE_ACP_LOG names a file that gets every frame the client sent,
one JSON object per line. Needs only Python.

The script may instead be a list of step lists, one per prompt (the last is reused).
Steps: {"sleep": secs} pause | {"crash": code} os._exit mid-prompt | {"text": s} message
chunk | {"tool": {"id", "title", "kind"?, "input"?, "status"?, "locations"?: [paths]}} tool call
start | {"tool_update": {"id", "status", "text"?}} tool call progress | {"plan": [{"content",
"status"?}]} plan update |
{"auth_status": {...}} an `auth/status_update` notification |
{"permission": {"title", "kind"?, "options"?}} ask and wait |
{"question": {"message", "options": [labels]} or {"message", "questions": [...]}}
elicitation and wait | {"hang": true}
wait until session/cancel | {"stubborn": true} hang, ignoring cancel | {"end": stop_reason}
finish the prompt (default end_turn). Env FAKE_ACP_HANG_INIT=1 never answers initialize.
FAKE_ACP_REPLAY=1 makes session/load replay one tool call (id "replayed") before answering,
like an adapter replaying the old chat.
A tool may carry "terminal": true (adds terminal_info meta); a tool_update may carry
"terminal": {"output", "delta"?, "exit"?, "signal"?}, sent as terminal_output/_exit meta
(FAKE_ACP_META_ONLY=1: only to a client that advertised it, else as a console text block).
FAKE_ACP_NO_HTTP=1 stops it advertising http MCP servers.
FAKE_ACP_LOAD=1 advertises and serves session/load (ids starting "bad-" fail); "known" serves
only ids this process created (a restarted adapter forgot the rest), "nomodes" answers
without modes;
FAKE_ACP_AUTH (JSON list of {id, name, description?}) sets auth_methods, and
new_session/authenticate then fail with
auth-required unless FAKE_ACP_LOGGED_IN=1 or the file named by FAKE_ACP_LOGIN_FILE exists.
An entry with "type": "terminal" (and "args") is a terminal method, advertised only to a
client that sent auth.terminal, like claude-acp. authenticate with a login file named
creates it (a browser login finishing). FAKE_ACP_AUTH='[]' means login is required with
no methods advertised.
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
        self.sessions = 0
        self.created: set[str] = set()
        self.meta = False

    def on_connect(self, conn) -> None:
        self.conn = conn

    async def initialize(self, protocol_version, client_capabilities=None, **kw):
        if os.environ.get("FAKE_ACP_HANG_INIT"):
            await asyncio.Event().wait()  # an adapter that never answers the handshake
        meta = getattr(client_capabilities, "field_meta", None) or {}
        self.meta = bool(meta.get("terminal_output") or meta.get("terminal_output_delta"))
        auth = json.loads(os.environ.get("FAKE_ACP_AUTH", "[]"))
        auth_caps = getattr(client_capabilities, "auth", None)
        can_terminal = bool(auth_caps and auth_caps.terminal)
        methods = [
            schema.TerminalAuthMethod(**m)
            if m.get("type") == "terminal"
            else schema.AuthMethodAgent(**m)
            for m in auth
            if can_terminal or m.get("type") != "terminal"
        ]
        return schema.InitializeResponse(
            protocol_version=1,
            agent_info=schema.Implementation(name="fake-acp", version="0"),
            agent_capabilities=schema.AgentCapabilities(
                load_session=bool(os.environ.get("FAKE_ACP_LOAD")),
                # FAKE_ACP_NO_HTTP=1 plays an adapter that cannot take an http MCP server.
                mcp_capabilities=schema.McpCapabilities(
                    http=not os.environ.get("FAKE_ACP_NO_HTTP")
                ),
            ),
            auth_methods=methods,
        )

    def _meta_ok(self) -> bool:
        # With FAKE_ACP_META_ONLY=1 terminal _meta goes only to a client that advertised it.
        return self.meta or not os.environ.get("FAKE_ACP_META_ONLY")

    def _needs_login(self) -> bool:
        marker = os.environ.get("FAKE_ACP_LOGIN_FILE")
        if marker and Path(marker).exists():
            return False
        return bool(os.environ.get("FAKE_ACP_AUTH")) and not os.environ.get("FAKE_ACP_LOGGED_IN")

    async def authenticate(self, method_id, **kw):
        marker = os.environ.get("FAKE_ACP_LOGIN_FILE")
        if marker:  # the browser sign-in finished
            Path(marker).write_text(method_id, encoding="utf-8")
        elif self._needs_login():
            raise acp.RequestError.auth_required()
        return schema.AuthenticateResponse()

    async def load_session(self, cwd, session_id, **kw):
        # Method-not-found without the flag, like an adapter that cannot resume a session.
        if not os.environ.get("FAKE_ACP_LOAD"):
            raise acp.RequestError.method_not_found("session/load")
        if session_id.startswith("bad-"):  # a session the adapter no longer has
            raise acp.RequestError.invalid_params({"session": session_id})
        if os.environ.get("FAKE_ACP_REPLAY"):
            await self.conn.session_update(
                session_id, acp.start_tool_call("replayed", "Old", kind="execute")
            )
        mode = os.environ["FAKE_ACP_LOAD"]
        if mode == "known" and session_id not in self.created:
            raise acp.RequestError.invalid_params({"session": session_id})
        if mode == "nomodes":
            return schema.LoadSessionResponse()
        return schema.LoadSessionResponse(modes=self._modes())

    async def new_session(self, cwd, **kw):
        if self._needs_login():
            raise acp.RequestError.auth_required()
        modes = self._modes()
        # One id per session, so several sessions can share this process (the first is sess-1).
        self.sessions += 1
        self.created.add(f"sess-{self.sessions}")
        return schema.NewSessionResponse(session_id=f"sess-{self.sessions}", modes=modes)

    def _modes(self) -> schema.SessionModeState:
        return schema.SessionModeState(
            current_mode_id="default",
            available_modes=[schema.SessionMode(id=i, name=n, description=d) for i, n, d in MODES],
        )

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
            elif "tool" in step:
                start = _tool_start(step["tool"])
                if not self._meta_ok():
                    start.field_meta = None
                await self.conn.session_update(session_id, start)
            elif "tool_update" in step:
                spec = step["tool_update"]
                if "terminal" in spec and self._meta_ok():
                    for update in _terminal_updates(spec):
                        await self.conn.session_update(session_id, update)
                else:
                    if "terminal" in spec:  # no opt-in: the console text block, like the adapter
                        body = spec["terminal"]["output"]
                        spec = {**spec, "text": "```console\n" + body + "\n```"}
                    await self.conn.session_update(session_id, _tool_progress(spec))
            elif "auth_status" in step:
                # A notification the schema has no route for, which the real adapter sends.
                await self.conn._conn.send_notification("auth/status_update", step["auth_status"])
            elif "plan" in step:
                entries = [
                    acp.plan_entry(e["content"], status=e.get("status", "pending"))
                    for e in step["plan"]
                ]
                await self.conn.session_update(session_id, acp.update_plan(entries))
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
        # spec["questions"] ({header, description, options, multi?} each) builds several fields;
        # multi-select ones are arrays with items.anyOf, as in the real two-question frame.
        questions = spec.get("questions") or [
            {"header": spec.get("header", "Question"), "options": spec["options"]}
        ]
        properties = {}
        for i, q in enumerate(questions):
            choices = [{"const": o, "title": o} for o in q["options"]]
            prop: dict = {"type": "string", "title": q["header"], "oneOf": choices}
            if q.get("multi"):
                prop = {"type": "array", "title": q["header"], "items": {"anyOf": choices}}
            if "description" in q:
                prop["description"] = q["description"]
            properties[f"question_{i}"] = prop
            properties[f"question_{i}_custom"] = {"type": "string", "title": "Other"}
        mode = schema.ElicitationFormSessionMode(
            session_id=session_id,
            tool_call_id="call-2",
            requested_schema={"type": "object", "properties": properties},
        )
        await self.conn.create_elicitation(spec["message"], mode)


def _tool_start(spec: dict):
    locations = [schema.ToolCallLocation(path=p) for p in spec.get("locations", [])]
    update = acp.start_tool_call(
        spec["id"],
        spec["title"],
        kind=spec.get("kind", "other"),
        status=spec.get("status", "in_progress"),
        raw_input=spec.get("input"),
        locations=locations or None,
    )
    if spec.get("terminal"):
        update.field_meta = {"terminal_info": {"terminal_id": spec["id"]}}
    return update


def _tool_progress(spec: dict):
    text = spec.get("text")
    content = [acp.tool_content(acp.text_block(text))] if text is not None else None
    return acp.update_tool_call(spec["id"], status=spec["status"], content=content)


def _terminal_updates(spec: dict):
    """Progress updates carrying output then exit as `_meta`, like the real adapter."""
    term, tid = spec["terminal"], spec["id"]
    out = acp.update_tool_call(tid)
    key = "terminal_output_delta" if term.get("delta") else "terminal_output"
    out.field_meta = {key: {"terminal_id": tid, "data": term["output"]}}
    done = acp.update_tool_call(tid, status=spec["status"])
    exit_meta = {"terminal_id": tid, "exit_code": term.get("exit"), "signal": term.get("signal")}
    done.field_meta = {"terminal_exit": exit_meta}
    return [out, done]


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
        keys = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY")
        env = {k: os.environ.get(k) for k in keys}
        env["PATH_set"] = "PATH" in os.environ
        env["PATH"] = os.environ.get("PATH")
        with open(log, "a", encoding="utf-8") as f:
            f.write(json.dumps({"env": env}) + "\n")
    # run_agent returns when stdin closes, which is how the real adapter ends too.
    await acp.run_agent(FakeAgent(steps), use_unstable_protocol=True, observers=observers)


if __name__ == "__main__":
    asyncio.run(main())
