"""Approvals become ended `ask` rows, each with its facts in `work_ask`, then the table goes.

An ask keeps its integer id (Home's approval id and paging cursor) and takes the work id
`a<id>`. The outcome sets the state and stays as `end_reason`. A job that still exists is the
parent. A preference link survives only when it still names a preference: since migration 0022
a dead number may belong to a mode or offer rule. Uses only `db.execute`: the runner holds the
transaction.
"""

import json

from brain.store.work import TITLE_CAP

_STATE = {"approved": "done", "refused": "cancelled", "timed_out": "expired", "no_one": "expired"}


def migrate(db) -> None:
    db.execute(
        "CREATE TABLE work_ask(id INTEGER PRIMARY KEY, work_id TEXT NOT NULL UNIQUE, source TEXT,"
        " tool TEXT, summary TEXT, input TEXT, group_key TEXT, decided_by TEXT, rule_id INTEGER,"
        " rule_sentence TEXT)"
    )
    rows = db.execute(
        "SELECT id, source, tool, summary, input, job_id, group_key, outcome, decided_by,"
        " CASE WHEN EXISTS(SELECT 1 FROM rules WHERE id = preference_id AND kind = 'sentence')"
        " THEN preference_id END, at, preference_sentence FROM approvals ORDER BY id"
    ).fetchall()
    for id, source, tool, summary, input, job, group, outcome, by, rule, at, sentence in rows:
        work_id = f"a{id}"
        goal = db.execute("SELECT root_id FROM work WHERE id = ? AND kind = 'goal'", (job,))
        goal = goal.fetchone()
        parent, root = (job, goal[0]) if goal else (None, work_id)
        seq = db.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM work WHERE parent_id IS ?", (parent,)
        ).fetchone()[0]
        db.execute(
            "INSERT INTO work(id, parent_id, root_id, seq, kind, state, title, created_at,"
            " updated_at, ended_at, end_reason, reported_at)"
            " VALUES (?, ?, ?, ?, 'ask', ?, ?, ?, ?, ?, ?, ?)",
            (work_id, parent, root, seq, _STATE[outcome], summary[:TITLE_CAP], at, at, at, outcome,
             at),
        )  # fmt: skip
        db.execute(
            "INSERT INTO work_events(work_id, at, kind, data) VALUES (?, ?, 'decided', ?)",
            (work_id, at, json.dumps({"outcome": outcome, "decided_by": by})),
        )
        db.execute(
            "INSERT INTO work_ask(id, work_id, source, tool, summary, input, group_key,"
            " decided_by, rule_id, rule_sentence) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (id, work_id, source, tool, summary, input, group, by, rule, sentence),
        )
    db.execute("DROP TABLE approvals")
