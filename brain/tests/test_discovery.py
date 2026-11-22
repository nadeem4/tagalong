"""The brain announces its name and port on the home network, and nothing that identifies it."""

from brain.discovery import Advertiser


class FakeZeroconf:
    def __init__(self):
        self.registered = []
        self.closed = False

    async def async_register_service(self, info):
        self.registered.append(info)

    async def async_unregister_service(self, info):
        self.registered.remove(info)

    async def async_close(self):
        self.closed = True


async def test_start_registers_one_service_with_only_a_name_and_the_version():
    zc = FakeZeroconf()
    await Advertiser(lambda: zc).start("Desk PC", 47323, "192.168.1.5")
    (info,) = zc.registered
    assert info.type == "_tagalong._tcp.local."
    assert info.port == 47323 and info.parsed_addresses() == ["192.168.1.5"]
    assert info.properties == {b"v": b"3", b"name": b"Desk PC"}


async def test_stop_withdraws_the_service_and_closes():
    zc = FakeZeroconf()
    advertiser = Advertiser(lambda: zc)
    await advertiser.start("Desk PC", 47323, "192.168.1.5")
    await advertiser.stop()
    assert zc.registered == [] and zc.closed
