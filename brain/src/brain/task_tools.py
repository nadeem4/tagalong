"""Scout's task tools: start a Do, Later or Own task, and end one.

Ask and Watch tasks are made by code, never by Scout. Ending a task cancels its planned timers
and watches, but never while a job still runs under it: Scout stops the job first.
"""

import json
from collections.abc import Callable

from brain.store.memory import MemoryRefused
from brain.tasks import Tasks
from brain.timers import Timers
from brain.toolbox import Handler, ToolSpec

KINDS = ("do", "later", "own")


def task_tools(
    tasks: Tasks,
    timers: Timers,
    jobs_running: Callable[[str], list[str]],
    cause: Callable[[], str | None],
) -> list[tuple[ToolSpec, Handler]]:
    """`cause` is the event the running turn took: the new task is caused by it."""

    async def task_start(args: dict) -> str:
        kind, title = args.get("kind"), args.get("title")
        if kind not in KINDS:
            raise MemoryRefused("task_start kind must be do, later or own.")
        if not isinstance(title, str) or not title.strip():
            raise MemoryRefused("task_start needs a title.")
        return json.dumps({"task": tasks.for_turn(cause(), kind, title.strip())})

    async def task_end(args: dict) -> str:
        id, result = args.get("task"), args.get("result")
        if not isinstance(id, str) or not isinstance(result, str):
            raise MemoryRefused("task_end needs task and result as text.")
        row = tasks.get(id)
        if row is None or row.state in ("done", "failed", "stopped", "declined"):
            raise MemoryRefused(f"no open task {id}.")
        if running := jobs_running(id):
            raise MemoryRefused(
                f"task {id} has a running job ({', '.join(running)}): stop the job first or "
                "wait for job_ended."
            )
        for tid in tasks.timers_of(id):
            timers.cancel(tid, "task ended")
        tasks.end(id, "done", result=result)
        return json.dumps({"task": id, "state": "done"})

    start = ToolSpec(
        "task_start",
        "Open a task for work that outlives this reply. kind do: background work (a hand-off or "
        "install); later: something to come back to (a timer); own: something you started on "
        "your own. Ask and watch tasks are made by the brain. Pass the returned task id to "
        "hand_off, installs and set_timer; without one they open a task themselves.",
        {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": list(KINDS)},
                "title": {"type": "string", "description": "A few words the person would use."},
            },
            "required": ["kind", "title"],
        },
        effect="change",
        default_mode="auto",
    )
    end = ToolSpec(
        "task_end",
        "End a task that is finished, with a one-line result. Refused while a job runs under it "
        "(stop the job first). Cancels the task's timers and watches.",
        {
            "type": "object",
            "properties": {"task": {"type": "string"}, "result": {"type": "string"}},
            "required": ["task", "result"],
        },
        effect="change",
        default_mode="auto",
    )
    return [(start, task_start), (end, task_end)]
