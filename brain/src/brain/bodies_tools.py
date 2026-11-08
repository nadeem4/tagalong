"""Home's tools for bodies and WhatsApp setup: bodies_status, whatsapp_status, whatsapp_set.

Status only ever says which values are set, never a value. whatsapp_set writes each given
value once to <TAGALONG_HOME>/.env and then tells the bridge supervisor to begin again; an
absent key leaves its value as it was. The raw args are checked by hand, because a pydantic
error would quote the input, and the input may be a secret.
"""

import asyncio
import json
import re
from collections.abc import Callable, MutableMapping
from pathlib import Path
from typing import Any, Protocol

from brain.bodies import Bodies
from brain.bridges import DEFAULT_PORT, WhatsAppSettings
from brain.config import upsert_env_values
from brain.protocol import BODY_BROWSER, BODY_DESKTOP, BODY_WHATSAPP, ErrorCode, RpcError
from brain.toolbox import Handler, ToolSpec

_KINDS = ((BODY_DESKTOP, "Desktop"), (BODY_BROWSER, "Browser"), (BODY_WHATSAPP, "WhatsApp"))
_PREFIX = "TAGALONG_WHATSAPP_"
_TEXT_FIELDS = {  # tool argument -> environment variable
    "access_token": _PREFIX + "ACCESS_TOKEN",
    "app_secret": _PREFIX + "APP_SECRET",
    "verify_token": _PREFIX + "VERIFY_TOKEN",
    "phone_number_id": _PREFIX + "PHONE_NUMBER_ID",
    "allowed_number": _PREFIX + "ALLOWED_NUMBER",
}
_HOME = frozenset({"home"})


class Supervisor(Protocol):
    state: str

    async def apply(self) -> None: ...


def _refuse(text: str) -> RpcError:
    return RpcError(ErrorCode.invalid_params, text)


def _checked(args: dict) -> dict[str, str]:
    """The environment lines to write; raises with fixed text that never quotes a value."""
    if not isinstance(args, dict):
        raise _refuse("whatsapp_set needs an object.")
    out: dict[str, str] = {}
    if "enabled" in args:
        if not isinstance(args["enabled"], bool):
            raise _refuse("enabled must be true or false.")
        out[_PREFIX + "ENABLED"] = "1" if args["enabled"] else "0"
    if "port" in args:
        port = args["port"]
        if isinstance(port, bool) or not isinstance(port, int) or not 1024 <= port <= 65535:
            raise _refuse("port must be a whole number from 1024 to 65535.")
        out[_PREFIX + "PORT"] = str(port)
    for name, var in _TEXT_FIELDS.items():
        if name not in args:
            continue
        value = args[name]
        if not isinstance(value, str) or not value.strip():
            raise _refuse(f"{name} must be a non-empty string.")
        value = value.strip()
        # A line break would add a line to .env. splitlines also splits on \x85, U+2028 and
        # U+2029, which the file reader treats as breaks; isprintable rejects the other
        # control characters.
        if len(value.splitlines()) != 1 or not value.isprintable():
            raise _refuse(f"{name} must be one line.")
        if name == "allowed_number":
            value = re.sub(r"[ +\-]", "", value)
            if not value.isascii() or not value.isdigit():
                raise _refuse("allowed_number must be a phone number with digits only.")
        out[var] = value
    return out


def bodies_tools(
    bodies: Bodies,
    bridges: Callable[[], Supervisor | None],
    data_dir: Path,
    env: MutableMapping[str, str],
    notify: Callable[[str, dict], Any],
    on_saved: Callable[[], Any],
) -> list[tuple[ToolSpec, Handler]]:
    """`bridges` is a getter: the supervisor needs the brain's port, known after the tools.
    `on_saved` runs after the write and before the bridge restarts, so the log masker knows
    the new secrets before the respawned bridge prints its first line."""
    # Serialises apply() only. The file write is atomic on its own; a `tagalong key set` in
    # another process is not covered by this lock.
    lock = asyncio.Lock()
    env_path = data_dir / ".env"

    def whatsapp_json() -> str:
        settings = WhatsAppSettings.from_env(env)
        supervisor = bridges()
        raw_port = settings.values.get(_PREFIX + "PORT", "")
        return json.dumps(
            {
                "enabled": settings.enabled,
                "set": {n: bool(settings.values.get(v)) for n, v in _TEXT_FIELDS.items()},
                "complete": settings.complete,
                "state": supervisor.state if supervisor is not None else "off",
                "port": int(raw_port) if raw_port.isdigit() else DEFAULT_PORT,
            }
        )

    async def bodies_status(args: dict) -> str:
        online = bodies.online()
        rows = []
        for kind, label in _KINDS:
            match = next((b for b in online if b.kind == kind), None)
            rows.append(
                {"kind": kind, "name": match.name if match else label, "connected": bool(match)}
            )
        return json.dumps({"bodies": rows})

    async def whatsapp_status(args: dict) -> str:
        return whatsapp_json()

    async def whatsapp_set(args: dict) -> str:
        changes = _checked(args)
        async with lock:
            try:
                upsert_env_values(data_dir, changes, env)  # all values or none
            except OSError as err:
                raise RpcError(
                    ErrorCode.tool_failed,
                    f"Scout could not save the WhatsApp settings to {env_path}.",
                ) from err
            on_saved()
            supervisor = bridges()
            if supervisor is not None:
                await supervisor.apply()
            notify("changed", {"what": "bodies"})
            return whatsapp_json()

    empty = {"type": "object", "properties": {}}
    text = {"type": "string"}
    return [
        (
            ToolSpec(
                "bodies_status",
                "Which of Scout's bodies (desktop, browser, WhatsApp) are connected now.",
                empty,
                _HOME,
                effect="read",
            ),
            bodies_status,
        ),
        (
            ToolSpec(
                "whatsapp_status",
                "WhatsApp setup: on or off, which values are set (never the values), the "
                "bridge state and the port.",
                empty,
                _HOME,
                effect="read",
            ),
            whatsapp_status,
        ),
        (
            ToolSpec(
                "whatsapp_set",
                "Save WhatsApp settings and switch the bridge on or off. Only the keys given "
                "change. Secrets are saved once and never returned.",
                {
                    "type": "object",
                    "properties": {
                        "enabled": {"type": "boolean"},
                        "access_token": text,
                        "app_secret": text,
                        "verify_token": text,
                        "phone_number_id": text,
                        "allowed_number": text,
                        "port": {"type": "integer", "minimum": 1024, "maximum": 65535},
                    },
                },
                _HOME,
                effect="change",
            ),
            whatsapp_set,
        ),
    ]
