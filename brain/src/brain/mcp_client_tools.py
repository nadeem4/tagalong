"""Home's tools for the AI tools that may use Scout's memory: mcp_client_make, mcp_clients_list,
mcp_client_revoke.

Home only: Scout must never mint a pairing link or cut a client off. `mcp_client_make` shows a
one-time link, which `tagalong memory-mcp --pair` redeems on the AI tool's machine; the client's
token is made then and never passes through here. A listing carries neither a token nor its hash.
"""

import json

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
