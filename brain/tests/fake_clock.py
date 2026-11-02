"""A clock and sleep the test moves by hand, so quiet-clock tests never wait in real time."""

import asyncio


class FakeClock:
    """A clock the test moves; sleep() returns once advance() has passed its time."""

    def __init__(self) -> None:
        self.now = 0.0
        self._waiters: list[tuple[float, asyncio.Future]] = []

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        future = asyncio.get_running_loop().create_future()
        self._waiters.append((self.now + seconds, future))
        await future

    async def advance(self, seconds: float) -> None:
        self.now += seconds
        for due, future in list(self._waiters):
            if due <= self.now and not future.done():
                future.set_result(None)
                self._waiters.remove((due, future))
        for _ in range(5):  # let the sleeper loop run
            await asyncio.sleep(0)
