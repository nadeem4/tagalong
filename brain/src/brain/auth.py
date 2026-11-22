"""Who is calling: a hello token becomes a Principal, or None.

The local token is the one in the home folder; a DeviceCheck (paired devices) is asked for
anything else.
"""

import hmac
from dataclasses import dataclass, replace
from typing import Protocol


@dataclass(frozen=True)
class Principal:
    key: str  # "local" or "device:<id>"; a body id is bound to this
    name: str
    kind: str  # "local" | desktop | browser | node | mcp_client
    local: bool
    device_id: str | None = None


class DeviceCheck(Protocol):
    def verify(self, token: str) -> Principal | None: ...


LOCAL = Principal(key="local", name="this computer", kind="local", local=True)


class Authenticator:
    def __init__(
        self,
        local_token: str | None,
        devices: DeviceCheck | None = None,
        loopback: bool = False,
    ) -> None:
        self._local = local_token.encode() if local_token else None
        self._devices = devices
        self._loopback = loopback  # a device on the loopback listener is on this machine

    def identify(self, token: str) -> Principal | None:
        if not token:
            return None
        if self._local and hmac.compare_digest(token.encode(), self._local):
            return LOCAL
        principal = self._devices.verify(token) if self._devices else None
        return replace(principal, local=True) if principal and self._loopback else principal


def listener_auth(local_token: str, devices: DeviceCheck) -> tuple[Authenticator, Authenticator]:
    """(loopback, network): the local token opens only the loopback listener."""
    return Authenticator(local_token, devices, loopback=True), Authenticator(None, devices)
