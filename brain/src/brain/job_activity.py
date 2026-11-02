"""What a running job did, step by step: ACP session updates reduced into activity entries.

One JobActivity per job. Every text is masked before it is stored and capped after, so no
raw secret and no unbounded output reaches the database or a reader. Entries are written
through Memory; the transport that serves them comes later.
"""

from collections.abc import Callable
from datetime import datetime

from brain.memory import ActivityEntry, Memory

KINDS = ("command", "output", "edit", "read", "search", "other", "say", "plan", "end")
STATUSES = ("pending", "running", "done", "failed")

OUTPUT_CAP = 65536  # bytes of one command's output kept (the tail)
SAY_CAP = 8192  # characters of one message
ENTRY_CAP = 2000  # entries per job
JOB_BYTES_CAP = 1_000_000  # text bytes per job
PAGE_LIMIT = 500  # entries per page a reader asks for

CUT_MARKER = "[earlier output cut]"
_STATUS = {"pending": "pending", "in_progress": "running", "completed": "done", "failed": "failed"}
_KIND = {
    "execute": "command",
    "edit": "edit",
    "delete": "edit",
    "move": "edit",
    "read": "read",
    "search": "search",
}


class JobActivity:
    def __init__(
        self,
        job_id: str,
        memory: Memory,
        mask: Callable[[str], str],
        now: Callable[[], datetime],
        on_change: Callable[[], None],
    ) -> None:
        self._job = job_id
        self._memory = memory
        self._mask = mask
        self._now = now
        self._on_change = on_change
        self._seq = 0
        self._steps: dict[str, ActivityEntry] = {}  # tool call id -> its command/edit/... entry
        self._outputs: dict[str, int] = {}  # tool call id -> seq of its output entry
        self._says: dict[object, tuple[int, str]] = {}  # message id -> (seq, raw text so far)
        self._plan_seq: int | None = None
        self._wrote = False

    def on_update(self, update: object) -> None:
        self._wrote = False
        match getattr(update, "session_update", None):
            case "tool_call" | "tool_call_update":
                self._tool(update)
            case "agent_message_chunk":
                self._say(update)
            case "plan":
                self._plan(update)
        if self._wrote:
            self._on_change()

    def end(self, state: str, reason: str) -> None:
        text = {"done": "# done", "stopped": "# stopped"}.get(state, f"# error: {reason}")
        self._put(None, "end", text)
        self._on_change()

    def running_step(self) -> ActivityEntry | None:
        running = [e for e in self._steps.values() if e.status == "running"]
        return max(running, key=lambda e: e.seq, default=None)

    def _tool(self, u) -> None:
        step = u.tool_call_id
        old = self._steps.get(step)
        status = _STATUS.get(str(u.status)) if u.status else None
        if old is None:
            kind = _KIND.get(str(u.kind), "other") if u.kind else "other"
            entry = self._put(None, kind, _step_text(u, kind), status or "pending", step)
        elif status and status != old.status:
            entry = self._put(old.seq, old.kind, old.text, status, step)
        else:
            entry = old
        self._steps[step] = entry
        output = _output_text(u)
        if output is not None:
            out = self._put(self._outputs.get(step), "output", output, None, step, _cut_output)
            self._outputs[step] = out.seq

    def _say(self, u) -> None:
        text = getattr(u.content, "text", None)
        if text is None:
            return
        seq, raw = self._says.get(u.message_id, (None, ""))
        raw = (raw + text)[: SAY_CAP * 2]
        seq = self._put(seq, "say", raw, None, None, lambda t: t[:SAY_CAP]).seq
        self._says[u.message_id] = (seq, raw)

    def _plan(self, u) -> None:
        lines = [f"[{'x' if str(e.status) == 'completed' else ' '}] {e.content}" for e in u.entries]
        self._plan_seq = self._put(self._plan_seq, "plan", "\n".join(lines)).seq

    def _put(
        self,
        seq: int | None,
        kind: str,
        text: str,
        status: str | None = None,
        step: str | None = None,
        cap: Callable[[str], str] = lambda t: t,
    ) -> ActivityEntry:
        """Write one entry (a new one when seq is None); masks first, then caps."""
        if seq is None:
            self._seq += 1
            seq = self._seq
        entry = ActivityEntry(
            rev=self._memory.last_rev(self._job) + 1,
            seq=seq,
            at=self._now().isoformat(),
            kind=kind,
            text=cap(self._mask(text)),
            status=status,
            step=step,
        )
        self._memory.save_activity(self._job, entry)
        self._memory.trim_activity(self._job, ENTRY_CAP, JOB_BYTES_CAP)
        self._wrote = True
        return entry


def _step_text(u, kind: str) -> str:
    title = u.title or ""
    if (
        kind == "command"
        and isinstance(u.raw_input, dict)
        and isinstance(u.raw_input.get("command"), str)
    ):
        return u.raw_input["command"]
    if kind == "edit" and u.locations:
        return f"edited {u.locations[0].path}"
    return title


def _output_text(u) -> str | None:
    parts = [
        c.content.text
        for c in u.content or []
        if getattr(c, "type", None) == "content" and hasattr(c.content, "text")
    ]
    if parts:
        return "".join(parts)
    raw = getattr(u, "raw_output", None)
    return raw if isinstance(raw, str) else None


def _cut_output(text: str) -> str:
    if len(text.encode()) <= OUTPUT_CAP:
        return text
    return CUT_MARKER + "\n" + text.encode()[-OUTPUT_CAP:].decode(errors="ignore")
