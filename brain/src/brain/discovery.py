"""Announce the brain on the home network (mDNS) so a device can offer it by name, and find the
address to announce.

Only a name and the protocol version are announced: the certificate fingerprint travels in the
pairing link, never on the network where anyone could read it.
"""

import ipaddress
import socket
from collections.abc import Callable, Iterable

import ifaddr
from zeroconf import ServiceInfo
from zeroconf.asyncio import AsyncZeroconf

SERVICE_TYPE = "_tagalong._tcp.local."


def lan_address() -> str:
    """This machine's address on the local network. A UDP connect sends no packet; it only makes
    the OS pick the interface it would use. Loopback when there is none."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


_TAILNET = ipaddress.ip_network("100.64.0.0/10")  # Tailscale's address range (carrier-grade NAT)


def tailnet_addresses(ips: Iterable[str] | None = None) -> list[str]:
    """This machine's Tailscale addresses, from its interfaces unless `ips` is given."""
    if ips is None:
        ips = [ip.ip for adapter in ifaddr.get_adapters() for ip in adapter.ips if ip.is_IPv4]
    return [ip for ip in ips if ":" not in ip and ipaddress.ip_address(ip) in _TAILNET]


class Advertiser:
    def __init__(self, zeroconf_factory: Callable[[], AsyncZeroconf]) -> None:
        self._factory = zeroconf_factory
        self._zeroconf: AsyncZeroconf | None = None
        self._info: ServiceInfo | None = None

    async def start(self, name: str, port: int, address: str) -> None:
        self._zeroconf = self._factory()
        self._info = ServiceInfo(
            SERVICE_TYPE,
            f"{name}.{SERVICE_TYPE}",
            port=port,
            addresses=[socket.inet_aton(address)],
            properties={"v": "3", "name": name},
        )
        await self._zeroconf.async_register_service(self._info)

    async def stop(self) -> None:
        if self._zeroconf is None or self._info is None:
            return
        await self._zeroconf.async_unregister_service(self._info)
        await self._zeroconf.async_close()
