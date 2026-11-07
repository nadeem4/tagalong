"""Jobs and job parts become `work` rows (goal and expert_call) plus `work_job`.

Every old row is kept: a job is a goal with the same id, a part is an expert_call named
`<job>.<part>`. Reports over 2,000 characters move to `tool_outputs` (the row keeps the first
2,000 and a pointer). `job_activity` stays until its own slice. Uses only `db.execute`: the
runner holds the transaction, and `executescript` would commit it.
"""

import json
import logging
import uuid

SUMMARY_CAP = 2_000
TITLE_CAP = 200
EPOCH = "1970-01-01T00:00:00+00:00"  # a stand-in for a row that never saved a start time

_JOB_STATE = {"running": "active", "done": "done", "stopped": "cancelled", "error": "failed"}
_ENDED = ("done", "failed", "cancelled", "expired")
log = logging.getLogger(__name__)


def _state(old: str | None) -> str:
    return _JOB_STATE.get(old or "", "cancelled")


def _summary(db, text: str | None, at: str) -> tuple[str | None, str | None]:
    """(summary, detail_id): short text stays; longer text is stored whole and pointed at."""
    if text is None:
        return None, None
    if len(text) <= SUMMARY_CAP:
        return text, None
    output_id = uuid.uuid4().hex[:12]
    db.execute(
        "INSERT INTO tool_outputs(id, tool, chars, text, at) VALUES (?, 'job_report', ?, ?, ?)",
        (output_id, len(text), text, at),
    )
    return text[:SUMMARY_CAP], output_id


def _watch(raw: str | None) -> dict | None:
    try:
        items = json.loads(raw) if raw else None
    except ValueError:
        return None
    return {"watch": items} if isinstance(items, list) and items else None


def _insert(db, row: dict) -> None:
    cols = ", ".join(row)
    db.execute(
        f"INSERT INTO work({cols}) VALUES ({', '.join('?' * len(row))})", tuple(row.values())
    )


def _event(db, work_id: str, at: str, kind: str, data: dict) -> None:
    db.execute(
        "INSERT INTO work_events(work_id, at, kind, data) VALUES (?, ?, ?, ?)",
        (work_id, at, kind, json.dumps(data)),
    )


def migrate(db) -> None:
    db.execute(
        "CREATE TABLE work_job(work_id TEXT PRIMARY KEY, agent TEXT, folder TEXT, mode TEXT,"
        " task TEXT)"
    )
    jobs = db.execute(
        "SELECT id, task, folder, mode, state, started_at, ended_at, parent_job, watch, title,"
        " scout_result, closed_at FROM jobs ORDER BY rowid"
    ).fetchall()
    parts = db.execute(
        "SELECT job_id, id, agent, task, state, reason, progress, session_id, report, reported,"
        " started_at, ended_at, folder FROM job_parts ORDER BY rowid"
    ).fetchall()
    by_job: dict[str, list] = {}
    for p in parts:
        by_job.setdefault(p[0], []).append(p)
    known = {job[0] for job in jobs}
    orphans = [p for p in parts if p[0] not in known]
    if orphans:  # a part with no job has no goal to hang under; say so rather than drop quietly
        log.warning("migration 0019 dropped %d job part(s) with no job", len(orphans))
    for seq, job in enumerate(jobs, 1):
        mine = by_job.get(job[0], [])
        _goal(db, seq, job, any(p[4] == "error" for p in mine))
        for number, part in enumerate(mine, 1):
            _call(db, job, part, number)
    db.execute("DROP TABLE job_parts")
    db.execute("DROP TABLE jobs")


def _goal(db, seq: int, job: tuple, part_failed: bool) -> None:
    """Only a job Scout closed (closed_at set) becomes an ended goal. An open job stays open,
    blocked when a part failed, so a follow-up part can still be added to it."""
    id, task, folder, mode, old, started, ended, parent, watch, title, result, closed = job
    created = started or ended or closed or EPOCH
    summary, detail_id = _summary(db, result, closed or ended or created)
    if closed:
        state = _state(old)
        if state not in _ENDED:
            state = "cancelled"
    else:
        state = "blocked" if part_failed else "active"
    stopped = state in _ENDED
    _insert(
        db,
        {
            "id": id,
            "root_id": id,
            "seq": seq,
            "kind": "goal",
            "state": state,
            "title": (title or "")[:TITLE_CAP],
            "input": None if (w := _watch(watch)) is None else json.dumps(w),
            "summary": summary,
            "detail_id": detail_id,
            "created_at": created,
            "updated_at": closed or ended or created,
            "ended_at": closed if stopped else None,
            "end_reason": (old or "stopped") if stopped else None,
            "reported_at": closed if stopped else None,
        },
    )
    db.execute(
        "INSERT INTO work_job(work_id, folder, mode, task) VALUES (?, ?, ?, ?)",
        (id, folder, mode, task),
    )
    _event(db, id, created, "created", {"kind": "goal"})
    if parent:
        _event(db, id, created, "continued", {"from": parent})


def _call(db, job: tuple, part: tuple, number: int) -> None:
    job_id = job[0]
    (
        _,
        part_id,
        agent,
        task,
        old,
        reason,
        progress,
        session,
        report,
        reported,
        started,
        ended,
        folder,
    ) = part
    work_id = f"{job_id}.{part_id}"
    state = _state(old)
    created = started or job[5] or EPOCH
    try:
        seq = int(part_id[1:])
    except ValueError:
        seq = number
    summary, detail_id = _summary(db, report, ended or created)
    stopped = state in _ENDED
    ended_at = (ended or created) if stopped else None
    _insert(
        db,
        {
            "id": work_id,
            "parent_id": job_id,
            "root_id": job_id,
            "seq": seq,
            "kind": "expert_call",
            "state": state,
            "title": (task or "")[:TITLE_CAP],
            "input": json.dumps({"task": task or ""}),
            "summary": summary,
            "detail_id": detail_id,
            "progress": None if stopped else progress,  # an ended row has none, as at runtime
            "checkpoint": json.dumps({"session_id": session}) if session else None,
            "created_at": created,
            "updated_at": ended_at or created,
            "ended_at": ended_at,
            "end_reason": (reason or old or "stopped") if stopped else None,
            "reported_at": (ended or started or created) if reported else None,
        },
    )
    db.execute(
        "INSERT INTO work_job(work_id, agent, folder) VALUES (?, ?, ?)",
        (work_id, agent, folder or job[2]),
    )
    _event(db, work_id, created, "created", {"kind": "expert_call"})
