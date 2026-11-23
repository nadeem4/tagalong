"""The tools for the AI tools that may use Scout's memory.

Home's: mcp_client_make, mcp_clients_list, mcp_client_revoke. Home only: Scout must never mint a
pairing link or cut a client off. `mcp_client_make` shows a one-time link, which
`tagalong memory-mcp --pair` redeems on the AI tool's machine; the client's token is made then
and never passes through here. A listing carries neither a token nor its hash.

Scout's: connect_ai_tool makes the client and hands its token straight to the desktop body, which
sets the tool up on this PC, so the token is never in a result the model reads; ai_tool_howto
gives the person the steps to do it themselves.
"""

import json
import uuid

from brain.bodies import Bodies
from brain.devices import Devices
from brain.pairing import Pairing
from brain.protocol import ErrorCode, RpcError
from brain.toolbox import Handler, ToolSpec

_HOME = frozenset({"home"})
KIND = "mcp_client"


def mcp_client_tools(
    devices: Devices, pairing: Pairing, network: bool
) -> list[tuple[ToolSpec, Handler]]:
    async def make(args: dict) -> str:
        name = args.get("name")
        if not isinstance(name, str) or not name.strip():
            raise RpcError(ErrorCode.invalid_params, "name must say which tool this is for.")
        if not network:
            raise RpcError(
                ErrorCode.invalid_params,
                "Network access is off, so no pairing link can reach this brain. Set "
                "TAGALONG_NETWORK=1 and restart the brain.",
            )
        personal = args.get("personal") is True
        offer = pairing.make_code(KIND, personal=personal, name=name.strip())
        return json.dumps(
            {
                "name": name.strip(),
                "link": offer.link,
                "expires_at": offer.expires_at,
                "personal": personal,
            }
        )

    async def listing(args: dict) -> str:
        return json.dumps({"clients": [d for d in devices.list() if d["kind"] == KIND]})

    async def revoke(args: dict) -> str:
        device_id = args.get("id")
        client = next((d for d in devices.list() if d["id"] == device_id), None)
        if client is None or client["kind"] != KIND or not devices.revoke(device_id):
            raise RpcError(ErrorCode.not_found, "No such client, or it is already revoked.")
        return json.dumps({"ok": True})

    return [
        (
            ToolSpec(
                "mcp_client_make",
                "Let another AI tool use Scout's memory: returns a one-time link to redeem on the "
                "machine that runs the tool (`tagalong memory-mcp --pair <link> --client <name>`). "
                "personal=true also lets it read the facts the owner keeps back.",
                {
                    "type": "object",
                    "properties": {"name": {"type": "string"}, "personal": {"type": "boolean"}},
                    "required": ["name"],
                },
                _HOME,
            ),
            make,
        ),
        (
            ToolSpec(
                "mcp_clients_list",
                "The AI tools made clients of Scout's memory: name, whether it may read personal "
                "facts, when made, last used, revoked.",
                {"type": "object", "properties": {}},
                _HOME,
                effect="read",
            ),
            listing,
        ),
        (
            ToolSpec(
                "mcp_client_revoke",
                "Cut an AI tool off from Scout's memory: its token stops working at once.",
                {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
                _HOME,
            ),
            revoke,
        ),
    ]


# The step each tool takes. `cmd /c` because Windows tools cannot start the `.cmd` that puts
# `tagalong` on the path directly.
_BRIDGE = "cmd /c tagalong memory-mcp --client"
AI_TOOLS = {
    "claude-code": f"run `claude mcp add --scope user tagalong -- {_BRIDGE} claude-code`",
    "codex": f"run `codex mcp add tagalong -- {_BRIDGE} codex`",
    "cursor": (
        'add `"tagalong": {"command": "cmd", "args": ["/c", "tagalong", "memory-mcp", '
        '"--client", "cursor"]}` under "mcpServers" in %USERPROFILE%\\.cursor\\mcp.json'
    ),
}
_TOOL_SCHEMA = {"type": "string", "enum": list(AI_TOOLS)}
_INSTALL = "irm https://raw.githubusercontent.com/nadeem4/tagalong/main/install/install.ps1 | iex"


def _tool(args: dict) -> str:
    tool = args.get("tool")
    if tool not in AI_TOOLS:
        raise RpcError(ErrorCode.invalid_params, f"tool must be one of: {', '.join(AI_TOOLS)}.")
    return tool


def connect_ai_tool_tools(devices: Devices, bodies: Bodies) -> list[tuple[ToolSpec, Handler]]:
    async def connect(args: dict) -> str:
        name = _tool(args)
        # The desktop on the brain's own PC first: the tool most likely runs where the brain does.
        desktops = [b for b in bodies.online() if b.kind == "desktop"]
        if not desktops:
            raise RpcError(
                ErrorCode.body_offline,
                "No desktop is connected to set this up on. Offer to show the person how instead.",
            )
        desktop = min(desktops, key=lambda b: not bodies.is_local(b.id))
        device_id, token = devices.create(name, KIND, personal=args.get("personal") is True)
        try:
            output = await bodies.use(
                desktop.id,
                uuid.uuid4().hex,
                "connect_ai_tool",
                {"tool": name, "name": name, "token": token},
                timeout=90.0,
            )
        except RpcError:
            devices.revoke(device_id)
            raise
        for old in devices.list():
            if old["kind"] == KIND and old["name"] == name and old["id"] != device_id:
                devices.revoke(old["id"])
        return "".join(part.get("text", "") for part in output)

    async def howto(args: dict) -> str:
        name = _tool(args)
        return (
            f"On the PC that runs {name}: {AI_TOOLS[name]}. The tool starts "
            f"`tagalong memory-mcp --client {name}` itself, and that needs a pairing file: make a "
            f"link for {name} in Home, then run `tagalong memory-mcp --pair <link> --client "
            f"{name}`. On a PC without Tagalong, first run `{_INSTALL}` in PowerShell to get "
            "`tagalong`. No secret is in any of these lines."
        )

    return [
        (
            ToolSpec(
                "connect_ai_tool",
                "Set up Claude Code, Codex or Cursor on this PC to use Scout's memory. Ask first, "
                'as a choice: "Want me to set it up, or show you how?"; call this only for "set '
                'it up", and ai_tool_howto for "show me". Connecting again replaces the old '
                "access. personal=true also lets it read the facts the owner keeps back: set it "
                "only when the owner asked for that. If it fails because the tool is not "
                "installed, offer ai_tool_howto.",
                {
                    "type": "object",
                    "properties": {"tool": _TOOL_SCHEMA, "personal": {"type": "boolean"}},
                    "required": ["tool"],
                },
            ),
            connect,
        ),
        (
            ToolSpec(
                "ai_tool_howto",
                "The exact line and steps to connect Claude Code, Codex or Cursor to Scout's "
                "memory by hand, including a PC without Tagalong. Holds no secret.",
                {"type": "object", "properties": {"tool": _TOOL_SCHEMA}, "required": ["tool"]},
                effect="read",
            ),
            howto,
        ),
    ]
