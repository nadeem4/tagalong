"""Stopping an announcement that never started is safe."""

from brain.discovery import Advertiser


async def test_stop_before_start_does_nothing():
    def never() -> None:
        raise AssertionError("no zeroconf should be made")

    await Advertiser(never).stop()
