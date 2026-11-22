"""Who is calling: a hello token becomes a Principal, or None.

The local token is the one in the home folder; a DeviceCheck (paired devices) is asked for
anything else. A listener that must not honour the local token is given none.
"""

import hmac
from dataclasses import dataclass
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
    def __init__(self, local_token: str | None, devices: DeviceCheck | None = None) -> None:
        self._local = local_token.encode() if local_token else None
        self._devices = devices

    def identify(self, token: str) -> Principal | None:
        if not token:
            return None
        if self._local and hmac.compare_digest(token.encode(), self._local):
            return LOCAL
        return self._devices.verify(token) if self._devices else None
