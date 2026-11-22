"""Stopping an announcement that never started is safe."""

from brain.discovery import Advertiser, tailnet_addresses


async def test_stop_before_start_does_nothing():
    def never() -> None:
        raise AssertionError("no zeroconf should be made")

    await Advertiser(never).stop()


def test_only_tailscale_addresses_are_kept_from_an_interface_list():
    ips = ["192.168.1.5", "100.64.0.7", "100.127.255.1", "100.128.0.1", "fe80::1", "127.0.0.1"]
    assert tailnet_addresses(ips) == ["100.64.0.7", "100.127.255.1"]
