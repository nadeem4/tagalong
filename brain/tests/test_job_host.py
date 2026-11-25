"""A job part records the machine it ran on and a saved session resumes only there: an offline
host leaves an open item and starts nothing elsewhere, and a folder is checked on the host."""

import sys

import pytest
from fake_node import FakeNode
from test_jobs import (  # noqa: F401
    AGENT,
    HANG,
    FakeAsks,
    FakeConnectedApps,
    finish,
    make_rig,
    until,
)

from brain.bodies import Bodies
from brain.jobs import JobError
from brain.placements import Placement
from brain.protocol import PipeSpec
from brain.setup.store import InstalledExpert

NODE_FOLDER = "/only/on/the/node"


@pytest.fixture
def setup(make_rig, tmp_path):  # noqa: F811
    bodies = Bodies()
    node = FakeNode(bodies, tmp_path)
    node.allowlist.allow(PipeSpec(command=sys.executable, args=[str(AGENT)]))
    node.experts.add(
        InstalledExpert("claude-acp", "Claude", "1", [sys.executable, str(AGENT)], "registry", None)
    )
    node.folders.add(NODE_FOLDER)
    node.connect()

    def build(steps=None, placed="pc", **kw):
        rig = make_rig(
            FakeAsks(), steps or [{"text": "ok"}], shared=True, load=True, bodies=bodies, **kw
        )
        if placed:
            rig.placements.set("expert", "claude-acp", Placement("body", placed))
        return rig

    return bodies, node, build


async def test_a_part_records_the_node_it_ran_on(setup):
    _, node, build = setup
    rig = build()
    job = await rig.jobs.start("go", NODE_FOLDER)
    await finish(rig, job)
    assert rig.records.get_job(job).parts[0].host == "pc"
    assert len(node.opened) == 1


async def test_a_folder_only_the_node_has_is_refused_on_the_brain(setup):
    _, _, build = setup
    rig = build(placed=None)
    with pytest.raises(JobError, match="no folder at"):
        await rig.jobs.start("go", NODE_FOLDER)


async def test_a_follow_up_resumes_on_the_same_host_after_the_placement_changes(setup):
    _, _, build = setup
    rig = build()
    first = await rig.jobs.start("one", NODE_FOLDER)
    await finish(rig, first)
    rig.placements.set("expert", "claude-acp", Placement("brain"))
    second = await rig.jobs.start("two", NODE_FOLDER, continue_job=first)
    await finish(rig, second)
    assert (second.session, rig.records.get_job(second).parts[0].host) == ("continued", "pc")


async def test_an_offline_host_leaves_an_open_item_and_the_job_does_not_move(setup):
    bodies, node, build = setup
    rig = build()
    first = await rig.jobs.start("one", NODE_FOLDER)
    await finish(rig, first)
    bodies.disconnect("pc", node)
    rig.placements.set("expert", "claude-acp", Placement("brain"))
    with pytest.raises(JobError) as err:
        await rig.jobs.start("two", NODE_FOLDER, continue_job=first)
    assert err.value.facts["problem"] == "host_offline"
    assert [i.kind for i in rig.items.list_open()] == ["host_offline"]
    assert [j.id for j in rig.records.list_jobs()] == [first]


async def test_a_host_that_drops_holds_the_part_blocked_with_its_session(setup):
    bodies, node, build = setup
    rig = build(HANG)
    task = rig.tasks.open("later", "scout")
    rig.tasks.wait(task)
    job = await rig.jobs.start("go", NODE_FOLDER, task_id=task)
    await until(lambda: rig.records.get_job(job).parts[0].progress)
    bodies.disconnect("pc", node)
    await until(lambda: rig.records.get_job(job).parts[0].state == "blocked")
    part = rig.records.get_job(job).parts[0]
    assert (part.host, bool(part.session_id)) == ("pc", True)
    assert rig.finished == []
    (news,) = [e for e in rig.emitted if e.kind == "job_ended"]
    assert news.source == f"job:{job}" and news.task == task
    assert "Paused:\npc dropped" in news.payload["report"]
    assert rig.tasks.get(task).state == "waiting"


async def test_apps_are_refused_for_an_expert_on_a_node_and_no_token_is_made(setup):
    _, _, build = setup
    rig = build(apps=FakeConnectedApps(mail="connected"))
    rig.hosts.bridge = rig.bridge
    with pytest.raises(JobError, match="can't take connected apps"):
        await rig.jobs.start("go", NODE_FOLDER, apps=["mail"])
    assert rig.bridge.grants == []


async def test_a_redo_without_a_session_runs_on_the_part_s_own_host(setup):
    _, node, build = setup
    rig = build()
    rig.records.add_job("old", "claude-acp", "do it", NODE_FOLDER, "plan", host="pc")
    rig.placements.set("expert", "claude-acp", Placement("brain"))
    work = rig.records.work
    work.transition("old.p1", "planned")
    row = work.transition("old.p1", "active", expect="planned")
    await rig.jobs.run_planned(row)
    await until(lambda: rig.records.get_job("old").parts[0].state == "done")
    assert len(node.opened) == 1


async def test_a_new_part_of_an_open_job_runs_on_the_job_s_host(setup):
    _, _, build = setup
    rig = build(HANG)
    job = await rig.jobs.start("one", NODE_FOLDER)
    rig.placements.set("expert", "claude-acp", Placement("brain"))
    await rig.jobs.start("two", NODE_FOLDER, job=str(job))
    assert [p.host for p in rig.records.get_job(job).parts] == ["pc", "pc"]


async def test_a_queued_hand_off_checks_the_folder_on_its_host_and_leaves_an_item(setup):
    bodies, node, build = setup
    rig = build(HANG, max_running=1)
    await rig.jobs.start("one", NODE_FOLDER)
    queued = await rig.jobs.start("two", NODE_FOLDER)
    assert queued.queued == 1
    bodies.disconnect("pc", node)
    await rig.jobs.stop(next(iter(rig.jobs._runs)))
    await until(lambda: rig.records.get_job(queued).state == "failed")
    assert [i.kind for i in rig.items.list_open()] == ["host_offline"]


async def test_a_queued_hand_off_fails_when_the_folder_is_missing_on_its_online_host(setup):
    _, node, build = setup
    rig = build(HANG, max_running=1)
    await rig.jobs.start("one", NODE_FOLDER)
    queued = await rig.jobs.start("two", NODE_FOLDER)
    node.folders.discard(NODE_FOLDER)
    await rig.jobs.stop(next(iter(rig.jobs._runs)))
    await until(lambda: rig.records.get_job(queued).state == "failed")
    assert rig.items.list_open() == []


async def test_a_part_for_a_queued_job_is_refused_as_busy_not_a_crash(setup):
    _, _, build = setup
    rig = build(HANG, max_running=1)
    await rig.jobs.start("one", NODE_FOLDER)
    queued = await rig.jobs.start("two", NODE_FOLDER)
    with pytest.raises(JobError, match="slots are busy"):
        await rig.jobs.start("more", NODE_FOLDER, job=str(queued))
