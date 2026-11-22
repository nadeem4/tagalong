"""Home's tools for paired devices: devices_list, device_rename, device_revoke, pair_make.

Home only: Scout must never mint a pairing code or cut a device off. A listing carries no token
or hash, and `pair_make`'s code is the one place a secret leaves the brain.
"""

import json

from brain.devices import Devices
from brain.pairing import PAIR_KINDS, Pairing, render_qr
from brain.protocol import ErrorCode, RpcError
from brain.toolbox import Handler, ToolSpec

_HOME = frozenset({"home"})


def _device_id(args: dict) -> str:
    device_id = args.get("id")
    if not isinstance(device_id, str):
        raise RpcError(ErrorCode.invalid_params, "id must be a device id.")
    return device_id


def device_tools(
    devices: Devices, pairing: Pairing, network: bool
) -> list[tuple[ToolSpec, Handler]]:
    async def devices_list(args: dict) -> str:
        return json.dumps({"devices": devices.list()})

    async def device_rename(args: dict) -> str:
        name = args.get("name")
        if not isinstance(name, str) or not devices.rename(_device_id(args), name):
            raise RpcError(ErrorCode.not_found, "No such device, or the name is empty.")
        return json.dumps({"ok": True})

    async def device_revoke(args: dict) -> str:
        if not devices.revoke(_device_id(args)):
            raise RpcError(ErrorCode.not_found, "No such device, or it is already revoked.")
        return json.dumps({"ok": True})

    async def pair_make(args: dict) -> str:
        kind = args.get("kind", "desktop")
        if kind not in PAIR_KINDS:
            raise RpcError(
                ErrorCode.invalid_params,
                "kind must be " + ", ".join(PAIR_KINDS[:-1]) + " or " + PAIR_KINDS[-1] + ".",
            )
        if kind != "browser" and not network:
            raise RpcError(
                ErrorCode.invalid_params,
                "Network access is off, so only the browser add-on can pair. Set "
                "TAGALONG_NETWORK=1 and restart the brain.",
            )
        offer = pairing.make_code(kind)
        return json.dumps(
            {
                "link": offer.link,
                "secret": offer.secret,
                "expires_at": offer.expires_at,
                "qr": render_qr(offer.link),
            }
        )

    empty = {"type": "object", "properties": {}}
    device = {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}
    return [
        (
            ToolSpec(
                "devices_list",
                "The paired devices: name, kind, when paired, last seen, revoked.",
                empty,
                _HOME,
                effect="read",
            ),
            devices_list,
        ),
        (
            ToolSpec(
                "device_rename",
                "Rename a paired device.",
                {
                    "type": "object",
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                    "required": ["id", "name"],
                },
                _HOME,
            ),
            device_rename,
        ),
        (
            ToolSpec(
                "device_revoke",
                "Cut a paired device off: its connection closes and its token stops working.",
                device,
                _HOME,
            ),
            device_revoke,
        ),
        (
            ToolSpec(
                "pair_make",
                "Make a one-time pairing code (valid 10 minutes). The browser add-on gets a "
                "6-digit code; other devices get a link and its QR.",
                {
                    "type": "object",
                    "properties": {"kind": {"enum": list(PAIR_KINDS)}},
                },
                _HOME,
            ),
            pair_make,
        ),
    ]
