"""Home's tools for the AI tools that may use Scout's memory: mcp_client_make, mcp_clients_list,
mcp_client_revoke.

Home only: Scout must never mint a token or cut a client off. `mcp_client_make` shows the URL and
the bearer once; a listing carries neither the token nor its hash.
"""

import json
from collections.abc import Callable

from brain.devices import Devices
from brain.protocol import ErrorCode, RpcError
from brain.toolbox import Handler, ToolSpec

_HOME = frozenset({"home"})
KIND = "mcp_client"


def mcp_client_tools(devices: Devices, url: Callable[[], str]) -> list[tuple[ToolSpec, Handler]]:
    async def make(args: dict) -> str:
        name = args.get("name")
        if not isinstance(name, str) or not name.strip():
            raise RpcError(ErrorCode.invalid_params, "name must say which tool this is for.")
        if not url():
            raise RpcError(
                ErrorCode.tool_failed,
                "The memory endpoint is not running: its port is taken. Set TAGALONG_MCP_PORT "
                "and restart the brain.",
            )
        device_id, token = devices.create(name.strip(), KIND, personal=args.get("personal") is True)
        return json.dumps(
            {
                "id": device_id,
                "name": name.strip(),
                "url": url(),
                "bearer": token,
                "personal": args.get("personal") is True,
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
                "Let another AI tool use Scout's memory: returns its URL and bearer token, shown "
                "this once. personal=true also lets it read the facts the owner keeps back.",
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
