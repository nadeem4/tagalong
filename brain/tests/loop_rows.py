"""Test helper: a LoopStore over a Memory's database, with the mail apps' rows in place.

The per-app mail switch lives on the `apps` row, so a test that switches mail on needs one.
"""

from datetime import timedelta

from brain.loops.store import LoopStore
from brain.store.work import WorkStore


def loop_store(mem, now, mask=lambda text: text, apps=("gmail", "app1")) -> LoopStore:
    """The daily digest starts due, as on the first return of a new day."""
    for app_id in apps:
        mem.db.execute(
            "INSERT OR IGNORE INTO apps(id, name, transport, config, auth) VALUES (?,?,?,?,?)",
            (app_id, app_id, "http", "{}", "none"),
        )
    work = WorkStore(mem.db, now, mask)
    work.update("loop-digest", due_at=now() - timedelta(seconds=1))
    return LoopStore(work, mem.db, now)
