"""Measurement: how long the brain's steps take and whether its event loop stalls.

`timed(step)` times a block (sync or async `with`) into the process-wide `TIMINGS`, a small
ring buffer per step. `LoopLagMonitor` warns when the loop was blocked past a threshold,
so a slow turn can be told apart from a blocked loop. `ask_event` writes one ask log line and
`dump_timings` repeats the timings into the log, so `tagalong perf` can read both from
brain.log without a running brain. All only observe; nothing decides.
"""

import asyncio
import logging
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

KEEP = 500  # samples kept per step
TICK_S = 0.1  # how often the monitor looks at the loop


@dataclass(frozen=True)
class StepStats:
    count: int
    p50: float
    p95: float
    max: float


class Timings:
    def __init__(self, keep: int = KEEP) -> None:
        self._keep = keep
        self._steps: dict[str, deque[tuple[float, dict]]] = defaultdict(
            lambda: deque(maxlen=self._keep)
        )

    def record(self, step: str, seconds: float, tags: dict) -> None:
        self._steps[step].append((seconds, tags))

    def samples(self, step: str) -> list[tuple[float, dict]]:
        return list(self._steps.get(step, ()))

    def clear(self) -> None:
        self._steps.clear()

    def summary(self) -> dict[str, StepStats]:
        out = {}
        for step, samples in self._steps.items():
            secs = sorted(s for s, _ in samples)
            if secs:
                out[step] = StepStats(len(secs), _pct(secs, 0.50), _pct(secs, 0.95), secs[-1])
        return out


def _pct(sorted_secs: list[float], q: float) -> float:
    return sorted_secs[max(0, round(q * len(sorted_secs)) - 1)]


TIMINGS = Timings()


class _Timer:
    """One object for `with` and `async with`, so a call site uses whichever it is in."""

    def __init__(self, step: str, tags: dict) -> None:
        self._step, self._tags = step, tags
        self._start = 0.0

    def __enter__(self) -> "_Timer":
        self._start = time.perf_counter()
        return self

    def __exit__(self, *_exc) -> None:
        TIMINGS.record(self._step, time.perf_counter() - self._start, self._tags)

    async def __aenter__(self) -> "_Timer":
        return self.__enter__()

    async def __aexit__(self, *exc) -> None:
        self.__exit__(*exc)


def timed(step: str, **tags) -> _Timer:
    return _Timer(step, tags)


class LoopLagMonitor:
    """Sleeps a fixed tick and compares the time really passed: the excess is time the loop
    could not run this task, that is, something else blocked it."""

    def __init__(
        self,
        threshold_s: float,
        clock: Callable[[], float] = time.monotonic,
        log: logging.Logger | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._threshold = threshold_s
        self._clock = clock
        self._log = log or logging.getLogger("brain.telemetry")
        self._sleep = sleep

    async def run(self) -> None:
        while True:
            before = self._clock()
            await self._sleep(TICK_S)
            lag = self._clock() - before - TICK_S
            if lag > self._threshold:
                TIMINGS.record("loop_lag", lag, {})
                self._log.warning("event loop blocked for %.2f s", lag)


PERF_EVERY_S = 60.0  # how often the timings are written to the log


def ask_event(event: str, ask_id: str, by: str, why: str = "") -> None:
    """One line per step of an ask's life: `ask.<event> t=<epoch> id=<id> by=<who> why=<why>`."""
    why = "_".join(why.split())
    logging.getLogger("brain.asks").info(
        "ask.%s t=%d id=%s by=%s why=%s", event, time.time(), ask_id, by, why
    )


async def dump_timings(every: float = PERF_EVERY_S) -> None:
    """Write the current timings to the log, one `perf` line per step, every `every` seconds."""
    log = logging.getLogger("brain.perf")
    last: dict[str, StepStats] = {}  # brain.log is never rotated: write a step only when it moved
    while True:
        await asyncio.sleep(every)
        for step, st in TIMINGS.summary().items():
            if last.get(step) == st:
                continue
            last[step] = st
            log.info(
                "perf t=%d step=%s n=%d p50=%.3f p95=%.3f max=%.3f",
                time.time(),
                step,
                st.count,
                st.p50,
                st.p95,
                st.max,
            )
