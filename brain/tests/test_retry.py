"""Retry rules: which errors are transient, which tools are safe to run again, how the due
runner reruns a step, and how the person resolves a stuck one. Fakes only.
"""

import asyncio
import json
from datetime import UTC, datetime, timedelta

import anthropic
import httpx2 as httpx
import pytest

from brain.protocol import ErrorCode, RpcError
from brain.retry import classify, safe_to_retry
from brain.store.db import open_db
from brain.store.work import WorkStore
from brain.timers import Timers
from brain.toolbox import ToolSpec
from brain.tools import work_tools

_REQUEST = httpx.Request("POST", "https://example.invalid")


def _rate_limit() -> BaseException:
    return anthropic.RateLimitError(
        "slow down", response=httpx.Response(429, request=_REQUEST), body=None
    )


@pytest.mark.parametrize(
    "err",
    [
        TimeoutError(),
        ConnectionError("reset"),
        _rate_limit(),
        anthropic.APIConnectionError(request=_REQUEST),
        anthropic.APITimeoutError(request=_REQUEST),
        RpcError(ErrorCode.timeout, "no answer"),
    ],
)
def test_classify_known_transients(err):
    assert classify(err) == "transient"


@pytest.mark.parametrize(
    "err", [ValueError("bad"), KeyError("x"), RpcError(ErrorCode.denied, "no"), RuntimeError()]
)
def test_classify_unknown_is_permanent(err):
    assert classify(err) == "permanent"


def _spec(name: str, effect: str) -> ToolSpec:
    return ToolSpec(name, "d", {"type": "object"}, effect=effect)


def test_safe_to_retry_read_only():
    assert safe_to_retry(_spec("search_notes", "read"))
    assert not safe_to_retry(_spec("save_note", "change"))


def test_pay_and_delete_never_safe():
    assert not safe_to_retry(_spec("delete_cache", "read"))
    assert not safe_to_retry(_spec("app__pay_invoice", "read"))


NOW = datetime(2026, 1, 1, 9, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.at = NOW

    def __call__(self) -> datetime:
        return self.at

    def step(self, seconds: int) -> None:
        self.at += timedelta(seconds=seconds)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def work(tmp_path, clock):
    db = open_db(tmp_path / "t.db")
    yield WorkStore(db, clock)
    db.close()


def goal_with_step(work, kind="tool_call", state="active", safe=True):
    work.create("goal", "tidy", id="g1", state="active")
    return work.create(kind, "step", parent_id="g1", state=state, id="g1.s", safe_to_retry=safe)


class FakeJobs:
    """Records what the stop choice asks of Jobs; the real route is tested in test_jobs.py."""

    def __init__(self, work) -> None:
        self.calls = []
        self._work = work

    async def stop(self, job_id):
        self.calls.append(("stop", job_id))

    def close(self, job_id, outcome):
        self.calls.append(("close", job_id, outcome))
        self._work.close_goal(job_id, outcome, "")


@pytest.fixture
def resolve(work):
    changed = []
    jobs = FakeJobs(work)
    tools = {s.name: (s, h) for s, h in work_tools(work, jobs, lambda: changed.append(1))}

    async def run(args):
        return json.loads(await tools["resolve_step"][1](args))

    run.spec = tools["resolve_step"][0]
    run.changed = changed
    run.jobs = jobs
    return run


async def test_timers_rerun_a_due_step_and_leave_it_to_the_callback(work, clock):
    step = goal_with_step(work)
    work.fail(step.id, "transient", "timeout")
    seen = []

    async def rerun(row):
        seen.append((row.id, row.state))

    timers = Timers(work, lambda *a, **k: None, clock, rerun=rerun)
    timers.fire_due()
    assert seen == []  # not due yet
    clock.step(30)
    timers.fire_due()
    await asyncio.gather(*timers._runs)
    assert seen == [("g1.s", "active")]  # the runner moves it to active before the callback


async def test_timers_without_a_rerun_leave_steps_planned(work, clock):
    step = goal_with_step(work)
    work.fail(step.id, "transient", "timeout")
    clock.step(60)
    Timers(work, lambda *a, **k: None, clock).fire_due()
    assert work.get(step.id).state == "planned"


async def test_resolve_step_retry_skip_stop(work, resolve, clock):
    goal_with_step(work)
    work.fail("g1.s", "permanent", "boom")  # failed: the goal is blocked
    assert work.get("g1").state == "blocked"
    out = await resolve({"id": "g1.s", "choice": "retry"})
    assert out["state"] == "planned" and resolve.changed == [1]
    assert work.get("g1.s").due_at is not None and work.get("g1").state == "active"

    work.transition("g1.s", "active", expect="planned")
    work.fail("g1.s", "permanent", "boom again")
    out = await resolve({"id": "g1.s", "choice": "skip"})
    assert out["state"] == "cancelled" and work.get("g1").state == "active"

    work.create("tool_call", "next", parent_id="g1", state="active", id="g1.t")
    work.fail("g1.t", "permanent", "no")
    out = await resolve({"id": "g1.t", "choice": "stop"})
    assert work.get("g1").state == "failed"
    assert work.get("g1").end_reason == "closed by Scout"
    assert out["goal"] == "failed"
    assert resolve.jobs.calls == [("stop", "g1"), ("close", "g1", "failed")]  # through Jobs


async def test_resolve_step_refusals_are_plain_lines(work, resolve):
    goal_with_step(work)
    assert "no work" in (await resolve({"id": "zzz", "choice": "retry"}))["error"]
    assert "choice" in (await resolve({"id": "g1.s", "choice": "maybe"}))["error"]
    assert "not blocked or failed" in (await resolve({"id": "g1.s", "choice": "retry"}))["error"]


async def test_resolve_step_takes_only_tool_and_expert_calls(work, resolve):
    goal_with_step(work)
    work.create("timer", "later", parent_id="g1", state="planned", id="g1.t")
    for id in ("g1", "g1.t"):  # a goal and a timer are not steps
        for choice in ("retry", "skip", "stop"):
            assert "error" in await resolve({"id": id, "choice": choice})
    assert work.get("g1").state == "active" and work.get("g1.t").state == "planned"
    assert resolve.jobs.calls == []


async def test_resolve_step_skip_and_retry_only_when_failed_or_blocked(work, resolve):
    work.create("goal", "tidy", id="g1", state="active")
    work.create("expert_call", "run", parent_id="g1", state="active", id="g1.p1")
    for choice in ("skip", "retry"):  # running: leave it alone
        assert "error" in await resolve({"id": "g1.p1", "choice": choice})
    assert work.get("g1.p1").state == "active"


def test_resolve_step_is_for_scout_and_home(resolve):
    assert resolve.spec.audience == frozenset({"scout", "home"})
