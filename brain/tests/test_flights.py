"""The in-flight registry on fakes: a request joins a running flight, never a finished one."""

import asyncio
from datetime import UTC, datetime

from brain.open_items import OpenItems
from brain.setup.flights import Flights
from brain.store.db import open_db


def make(tmp_path) -> Flights:
    items = OpenItems(open_db(tmp_path / "items.db"), lambda: datetime.now(UTC))
    return Flights(items, "install")


async def test_a_request_right_after_the_task_finished_starts_a_new_flight(tmp_path):
    flights = make(tmp_path)
    finished = asyncio.Event()

    async def run():
        finished.set()  # wakes the waiter below before this task's own done callback runs

    async def waiter():
        await finished.wait()
        return flights.start("x", run)

    first = flights.start("x", run)
    again = await asyncio.ensure_future(waiter())
    assert first.task.done()
    assert not again.joined and again.item.id != first.item.id
    await flights.stop()
