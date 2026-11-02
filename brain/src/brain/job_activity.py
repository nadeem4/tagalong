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
        self._terminals: dict[str, str] = {}  # terminal id -> tool call id (terminal_info)
        self._raw: dict[str, str] = {}  # tool call id -> raw output tail; memory only, never stored
        self._exited: set[str] = set()  # steps whose exit code already decided their status
        self._says: dict[object, tuple[int, str]] = {}  # message id -> (seq, raw text so far)
        self._last_say: object = None  # key of the message still being written, if any
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
        if state != "done":
            for step, old in list(self._steps.items()):
                if old.status in ("running", "pending"):
                    self._steps[step] = self._put(
                        old.seq, old.kind, old.text, "failed", step, exit=old.exit
                    )
        self._put(None, "end", text)
        self._on_change()

    def running_step(self) -> ActivityEntry | None:
        live = [e for e in self._steps.values() if e.status in ("running", "pending")]
        return max(live, key=lambda e: e.seq, default=None)

    def _tool(self, u) -> None:
        self._last_say = None
        step = u.tool_call_id
        old = self._steps.get(step)
        status = _STATUS.get(str(u.status)) if u.status else None
        if old is None:
            kind = _KIND.get(str(u.kind), "other") if u.kind else "other"
            entry = self._put(None, kind, _step_text(u, kind), status or "pending", step)
        elif status and status != old.status and step not in self._exited:
            entry = self._put(old.seq, old.kind, old.text, status, step, exit=old.exit)
        else:
            entry = old
        self._steps[step] = entry
        meta = getattr(u, "field_meta", None) or {}
        self._terminal(step, meta)
        output = None if _has_terminal_output(meta) else _output_text(u)
        if output is not None:
            self._write_output(step, output)

    def _terminal(self, step: str, meta: dict) -> None:
        """Adapter `_meta`: the terminal id, the command's output (whole or appended) and exit."""
        info = meta.get("terminal_info")
        if isinstance(info, dict) and isinstance(info.get("terminal_id"), str):
            self._terminals[info["terminal_id"]] = step
        for key in ("terminal_output", "terminal_output_delta"):
            part = meta.get(key)
            if not isinstance(part, dict) or not isinstance(part.get("data"), str):
                continue
            target = self._terminals.get(part.get("terminal_id"), step)
            if target not in self._steps:
                continue
            old = self._raw.get(target, "") if key.endswith("delta") else ""
            self._raw[target] = (old + part["data"])[-OUTPUT_CAP:]
            self._write_output(target, self._raw[target])
        done = meta.get("terminal_exit")
        if isinstance(done, dict):
            target = self._terminals.get(done.get("terminal_id"), done.get("terminal_id"))
            if target in self._steps:
                self._finish_command(target, done.get("exit_code"))

    def _finish_command(self, step: str, code: object) -> None:
        old = self._steps[step]
        code = code if isinstance(code, int) and not isinstance(code, bool) else None
        status = "done" if code == 0 else "failed"
        self._exited.add(step)
        if (old.status, old.exit) != (status, code):
            self._steps[step] = self._put(old.seq, old.kind, old.text, status, step, exit=code)

    def _write_output(self, step: str, text: str) -> None:
        out = self._put(self._outputs.get(step), "output", text, None, step, _cut_output)
        self._outputs[step] = out.seq

    def _say(self, u) -> None:
        text = getattr(u.content, "text", None)
        if text is None:
            return
        key = u.message_id
        if key is None and self._last_say is None:
            self._says.pop(None, None)  # no id: chunks join only until a tool or plan intervenes
        seq, raw = self._says.get(key, (None, ""))
        raw = (raw + text)[: SAY_CAP * 2]
        seq = self._put(seq, "say", raw, None, None, lambda t: t[:SAY_CAP]).seq
        self._says[key] = (seq, raw)
        self._last_say = key if key is not None else "anon"

    def _plan(self, u) -> None:
        self._last_say = None
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
        exit: int | None = None,
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
            exit=exit,
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
        return _strip_fence("".join(parts))
    raw = getattr(u, "raw_output", None)
    return raw if isinstance(raw, str) else None


def _has_terminal_output(meta: dict) -> bool:
    return "terminal_output" in meta or "terminal_output_delta" in meta


def _strip_fence(text: str) -> str:
    """Without the opt-in an adapter wraps output in a console fence; show the same text."""
    head, tail = "```console" + chr(10), chr(10) + "```"
    if text.startswith(head) and text.endswith(tail):
        return text[len(head) : -len(tail)]
    return text


def _cut_output(text: str) -> str:
    if len(text.encode()) <= OUTPUT_CAP:
        return text
    return CUT_MARKER + "\n" + text.encode()[-OUTPUT_CAP:].decode(errors="ignore")
