"""Telemetry: the loop-lag alarm and the step timings. A fake clock and a fake sleep drive
the monitor, so no test waits and none depends on the machine's speed.
"""

import asyncio
import logging

import pytest

from brain.telemetry import TIMINGS, LoopLagMonitor, Timings, ask_event, dump_timings, timed


class FakeTime:
    """A clock the fake sleep moves: each stall is extra time a blocked loop would add."""

    def __init__(self, stalls):
        self.now = 0.0
        self.stalls = list(stalls)

    def clock(self):
        return self.now

    async def sleep(self, seconds):
        if not self.stalls:
            raise asyncio.CancelledError  # ends run() after the scripted ticks
        self.now += seconds + self.stalls.pop(0)


async def run_monitor(stalls, threshold=0.2):
    fake = FakeTime(stalls)
    monitor = LoopLagMonitor(threshold, fake.clock, logging.getLogger("lag"), sleep=fake.sleep)
    with pytest.raises(asyncio.CancelledError):
        await monitor.run()


async def test_loop_lag_logs_when_blocked(caplog):
    TIMINGS.clear()
    with caplog.at_level(logging.WARNING, logger="lag"):
        await run_monitor([0.0, 0.5, 0.0])
    lines = [r.getMessage() for r in caplog.records]
    assert len(lines) == 1
    assert "0.50" in lines[0]
    assert len(TIMINGS.samples("loop_lag")) == 1


async def test_loop_lag_quiet_under_threshold(caplog):
    with caplog.at_level(logging.WARNING, logger="lag"):
        await run_monitor([0.0, 0.05, 0.1])
    assert caplog.records == []


def test_timed_records_step_and_tags():
    TIMINGS.clear()
    with timed("tool", name="see_screen"):
        pass
    [(seconds, tags)] = TIMINGS.samples("tool")
    assert seconds >= 0
    assert tags == {"name": "see_screen"}


async def test_timed_async_with_records_even_on_error():
    TIMINGS.clear()
    with pytest.raises(ValueError):
        async with timed("model"):
            raise ValueError
    assert len(TIMINGS.samples("model")) == 1


def test_summary_percentiles():
    t = Timings()
    for ms in range(1, 101):
        t.record("x", ms / 1000, {})
    s = t.summary()["x"]
    assert s.count == 100
    assert s.p50 == pytest.approx(0.050, abs=0.001)
    assert s.p95 == pytest.approx(0.095, abs=0.001)
    assert s.max == pytest.approx(0.100)


def test_ring_buffer_drops_oldest():
    t = Timings(keep=3)
    for n in range(5):
        t.record("x", float(n), {})
    assert [s for s, _ in t.samples("x")] == [2.0, 3.0, 4.0]
    assert t.summary()["x"].count == 3


async def test_dump_timings_writes_one_perf_line_per_step_and_only_when_changed(caplog):
    TIMINGS.clear()
    TIMINGS.record("turn", 1.5, {})
    caplog.set_level("INFO", logger="brain.perf")
    task = asyncio.create_task(dump_timings(every=0.01))
    await asyncio.sleep(0.1)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("perf ")]
    assert len(lines) == 1  # nothing changed after the first write
    for part in ("t=", "step=turn", "n=1", "p50=1.500", "p95=1.500", "max=1.500"):
        assert part in lines[0]
    TIMINGS.clear()


def test_ask_event_turns_spaces_in_why_into_underscores(caplog):
    caplog.set_level("INFO", logger="brain.asks")
    ask_event("closed", "a1", "brain", "job ended: stopped")
    [line] = [r.getMessage() for r in caplog.records]
    assert "why=job_ended:_stopped" in line
