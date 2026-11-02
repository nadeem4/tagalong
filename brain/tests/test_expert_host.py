"""Checks ExpertHost: one adapter process shared by several sessions, resume and idle stop.

Runs on the scripted fake ACP agent (FAKE_ACP_LOAD turns on session/load). The fake logs one
`env` line per process it starts, so counting those lines counts spawns. The idle wait uses an
injected sleep, so no test waits in real time.
"""

import asyncio
import json
import sys
from pathlib import Path

import pytest

from brain.experts import ExpertError, ExpertHost, ExpertRun

AGENT = Path(__file__).parent / "fake_acp_agent.py"


class Side:
    """One session's callbacks and what reached them."""

    def __init__(self) -> None:
        self.permissions: list[str] = []
        self.progress: list[str] = []
        self.ends: list[tuple] = []

    async def on_permission(self, request):
        self.permissions.append(request.title)
        return "allow-once"

    async def on_question(self, question):
        return None

    async def on_progress(self, text: str) -> None:
        self.progress.append(text)

    async def on_end(self, state, reason, result) -> None:
        self.ends.append((state, reason, result))


class Rig:
    def __init__(self, tmp_path, monkeypatch, steps, load: bool = False, idle_s: float = 300):
        script = tmp_path / "script.json"
        script.write_text(json.dumps(steps))
        monkeypatch.setenv("FAKE_ACP_SCRIPT", str(script))
        monkeypatch.setenv("FAKE_ACP_LOG", str(tmp_path / "log.jsonl"))
        if load:
            monkeypatch.setenv("FAKE_ACP_LOAD", "1")
        self.log = tmp_path / "log.jsonl"
        self.folder = tmp_path
        self.gate = asyncio.Event()  # the injected sleep: idle time passes when this is set
        self.slept: list[float] = []
        self.host = ExpertHost(
            [sys.executable, str(AGENT)], "fake", idle_s=idle_s, grace=2, sleep=self.sleep
        )
        self.runs: list[ExpertRun] = []

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        await self.gate.wait()

    def run(self, side: Side) -> ExpertRun:
        run = ExpertRun(
            host=self.host,
            timeout=30,
            on_permission=side.on_permission,
            on_question=side.on_question,
            on_progress=side.on_progress,
            on_end=side.on_end,
        )
        self.runs.append(run)
        return run

    def spawns(self) -> int:
        lines = self.log.read_text().splitlines() if self.log.exists() else []
        return sum(1 for line in lines if "env" in json.loads(line))

    def frames(self) -> list[dict]:
        return [json.loads(x) for x in self.log.read_text().splitlines() if "env" not in x]


@pytest.fixture
async def make_rig(tmp_path, monkeypatch):
    rigs: list[Rig] = []

    def make(steps=(), **kw) -> Rig:
        rigs.append(Rig(tmp_path, monkeypatch, list(steps), **kw))
        return rigs[-1]

    yield make
    for rig in rigs:  # nothing may outlive the test
        for run in rig.runs:
            await run.close()
        await rig.host.shutdown()


async def until(condition, timeout: float = 10) -> None:
    async def poll() -> None:
        while not condition():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(poll(), timeout)


def alive(host: ExpertHost) -> bool:
    return host.process is not None and host.process.returncode is None


async def test_two_sessions_share_one_process(make_rig):
    rig = make_rig()
    a, b = rig.run(Side()), rig.run(Side())
    await a.start(rig.folder)
    await b.start(rig.folder)
    assert rig.spawns() == 1
    assert a.session_id != b.session_id and a.process is b.process


async def test_callbacks_are_routed_to_the_right_session(make_rig):
    rig = make_rig([[{"text": "one"}], [{"text": "two"}]])
    sa, sb = Side(), Side()
    a, b = rig.run(sa), rig.run(sb)
    await a.start(rig.folder)
    await b.start(rig.folder)
    await a.begin("default", "task a")
    await until(lambda: sa.ends)
    await b.begin("default", "task b")
    await until(lambda: sb.ends)
    assert sa.progress[-1] == "one" and sb.progress[-1] == "two"
    assert sa.ends[0][0] == "done" and sb.ends[0][0] == "done"


async def test_permission_asks_from_two_sessions_do_not_cross(make_rig):
    steps = [
        [{"permission": {"title": "A-ask"}}, {"hang": True}],
        [{"permission": {"title": "B-ask"}}, {"hang": True}],
    ]
    rig = make_rig(steps)
    sa, sb = Side(), Side()
    a, b = rig.run(sa), rig.run(sb)
    await a.start(rig.folder)
    await b.start(rig.folder)
    await a.begin("default", "x")
    await until(lambda: sa.permissions)
    await b.begin("default", "y")
    await until(lambda: sb.permissions)
    assert sa.permissions == ["A-ask"] and sb.permissions == ["B-ask"]


async def test_the_process_stops_after_the_idle_period_and_restarts_on_demand(make_rig):
    rig = make_rig(idle_s=300)
    side = Side()
    run = rig.run(side)
    await run.start(rig.folder)
    await run.begin("default", "t")
    await until(lambda: side.ends)
    await until(lambda: rig.slept)
    assert alive(rig.host) and rig.slept == [300]  # kept for the follow-up
    process = rig.host.process
    rig.gate.set()  # the idle time passes
    await until(lambda: process.returncode is not None)
    again = rig.run(Side())
    await again.start(rig.folder)
    assert rig.spawns() == 2 and alive(rig.host)


async def test_a_new_session_cancels_the_idle_stop(make_rig):
    rig = make_rig(idle_s=300)
    run = rig.run(Side())
    await run.start(rig.folder)
    await run.close()
    await until(lambda: rig.slept)
    second = rig.run(Side())
    await second.start(rig.folder)
    rig.gate.set()
    await asyncio.sleep(0.2)
    assert alive(rig.host) and rig.spawns() == 1


async def test_a_crash_ends_open_sessions_with_error_and_the_next_one_starts_a_new_process(
    make_rig,
):
    rig = make_rig([[{"hang": True}], [{"crash": 3}]])
    sa, sb = Side(), Side()
    a, b = rig.run(sa), rig.run(sb)
    await a.start(rig.folder)
    await b.start(rig.folder)
    await a.begin("default", "x")
    await b.begin("default", "y")  # the second prompt crashes the shared process
    await until(lambda: sa.ends and sb.ends)
    assert sa.ends[0][0] == "error" and sb.ends[0][0] == "error"
    fresh = rig.run(Side())
    await fresh.start(rig.folder)
    assert rig.spawns() == 2


async def test_resume_uses_load_session_when_supported(make_rig):
    rig = make_rig(load=True)
    run = rig.run(Side())
    modes = await run.start(rig.folder, resume="sess-9")
    assert run.session_id == "sess-9" and run.resumed is True and run.fresh_reason is None
    assert rig.host.can_resume is True
    assert any(f.get("method") == "session/load" for f in rig.frames())
    assert modes  # the adapter's load response carries them


async def test_resume_falls_back_to_a_fresh_session_when_unsupported(make_rig):
    rig = make_rig(load=False)
    run = rig.run(Side())
    await run.start(rig.folder, resume="sess-9")
    assert run.resumed is False and run.fresh_reason == "expert cannot reopen sessions"
    assert rig.host.can_resume is False
    assert run.session_id == "sess-1"
    assert not any(f.get("method") == "session/load" for f in rig.frames())


async def test_resume_falls_back_when_load_session_fails(make_rig):
    rig = make_rig(load=True)
    run = rig.run(Side())
    await run.start(rig.folder, resume="bad-1")
    assert run.resumed is False and run.fresh_reason == "session could not be loaded"
    assert run.session_id == "sess-1"


async def test_no_resume_asked_leaves_the_resume_facts_empty(make_rig):
    rig = make_rig(load=True)
    run = rig.run(Side())
    await run.start(rig.folder)
    assert run.resumed is None and run.fresh_reason is None


async def test_can_resume_is_unknown_until_the_adapter_started(make_rig):
    rig = make_rig(load=True)
    assert rig.host.can_resume is None


async def test_stopping_one_session_leaves_the_other_running(make_rig):
    rig = make_rig([[{"hang": True}], [{"hang": True}]])
    sa, sb = Side(), Side()
    a, b = rig.run(sa), rig.run(sb)
    await a.start(rig.folder)
    await b.start(rig.folder)
    await a.begin("default", "x")
    await b.begin("default", "y")
    await a.stop()
    assert sa.ends[0][0] == "stopped" and sb.ends == []
    assert alive(rig.host)
    await b.stop()
    assert sb.ends[0][0] == "stopped"


async def test_startup_that_never_answers_is_an_error_and_leaves_no_process(make_rig, monkeypatch):
    monkeypatch.setenv("FAKE_ACP_HANG_INIT", "1")
    rig = make_rig()
    rig.host._startup_timeout = 0.5
    run = rig.run(Side())
    with pytest.raises(ExpertError, match="did not answer"):
        await run.start(rig.folder)
    assert not alive(rig.host)
