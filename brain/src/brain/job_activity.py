"""What a running job did, step by step: ACP session updates reduced into activity entries.

One JobActivity per job. Every text is masked before it is stored and capped after, so no
raw secret and no unbounded output reaches the database or a reader. Entries are written
through Memory.
"""

from collections.abc import Callable
from datetime import datetime

from brain.memory import ActivityEntry, Memory

KINDS = ("command", "output", "edit", "read", "search", "other", "say", "plan", "end")
STATUSES = ("pending", "running", "done", "failed")

OUTPUT_CAP = 65536  # bytes of one command's output kept (the tail)
CARRY = 1024  # extra raw chars kept so a cut never lands inside a secret (dropped after masking)
SAY_CAP = 8192  # characters of one message
ENTRY_CAP = 2000  # entries per job
JOB_BYTES_CAP = 1_000_000  # text bytes per job
PAGE_LIMIT = 500  # entries per page a reader asks for

SUMMARY_CAP = 1500  # characters of the digest a wake carries
LINE_CAP = 200  # characters of the one-line form in list_jobs
FAILED_TAIL_LINES = 3  # last output lines shown under a failed command
RECENT_COMMANDS = 5  # last commands listed with their exit codes
FAILED_SHOWN = 3  # failed commands listed in full
_PART_CAP = 200  # one command or output line in the digest
_STEP_KINDS = ("command", "edit", "read", "search", "other")

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
        on_failed: Callable[[ActivityEntry], None] = lambda entry: None,
    ) -> None:
        self._on_failed = on_failed  # called once per step id, after the update is written
        self._failed_seen: set[str] = set()
        self._touched: set[str] = set()
        self._job = job_id
        self._memory = memory
        self._mask = mask
        self._now = now
        self._on_change = on_change
        self._seq = 0
        self._steps: dict[str, ActivityEntry] = {}  # tool call id -> its command/edit/... entry
        self._outputs: dict[str, int] = {}  # tool call id -> seq of its output entry
        self._terminals: dict[str, str] = {}  # terminal id -> tool call id (terminal_info)
        self._raw: dict[str, str] = {}  # tool call id -> raw delta tail; memory only, never stored
        self._exited: set[str] = set()  # steps whose exit code already decided their status
        self._says: dict[object, tuple[int, str]] = {}  # message id -> (seq, raw text so far)
        self._last_say: object = None  # key of the message still being written, if any
        self._plan_seq: int | None = None
        self._wrote = False

    def on_update(self, update: object) -> None:
        self._wrote = False
        self._touched = set()
        match getattr(update, "session_update", None):
            case "tool_call" | "tool_call_update":
                self._tool(update)
            case "agent_message_chunk":
                self._say(update)
            case "plan":
                self._plan(update)
        self._report_failed()
        if self._wrote:
            self._on_change()

    def _report_failed(self) -> None:
        """Once per step id, after the whole update (its output included) is stored."""
        for step in self._touched:
            entry = self._steps.get(step)
            if entry is not None and step not in self._failed_seen and is_failed(entry):
                self._failed_seen.add(step)
                self._on_failed(entry)

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
        self._touched.add(step)
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
            if key.endswith("delta"):
                self._append_delta(target, part["data"])
            else:
                self._write_output(target, part["data"])
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
        self._touched.add(step)
        self._raw.pop(step, None)
        if (old.status, old.exit) != (status, code):
            self._steps[step] = self._put(old.seq, old.kind, old.text, status, step, exit=code)

    def _append_delta(self, step: str, data: str) -> None:
        """Keep a little more raw than the cap, so the cut is made after masking."""
        raw = self._raw.get(step, "") + data
        if len(raw) <= OUTPUT_CAP + CARRY:
            self._raw[step] = raw
            self._write_output(step, raw)
            return
        self._raw[step] = raw[-(OUTPUT_CAP + CARRY) :]
        self._write_output(step, self._raw[step], _cut_trimmed)

    def _write_output(self, step: str, text: str, cap: Callable[[str], str] | None = None) -> None:
        out = self._put(self._outputs.get(step), "output", text, None, step, cap or _cut_output)
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


def _cut_trimmed(text: str) -> str:
    """The text already lost its head: drop the unsafe carry, always say so."""
    tail = text[CARRY:].encode()[-OUTPUT_CAP:].decode(errors="ignore")
    return CUT_MARKER + chr(10) + tail


def is_failed(entry: ActivityEntry) -> bool:
    """A step failed by its status, or a command that exited non-zero whatever its status says."""
    return entry.status == "failed" or (entry.kind == "command" and entry.exit not in (None, 0))


def _clip(text: str, cap: int = _PART_CAP) -> str:
    text = " ".join(text.split())
    return text if len(text) <= cap else text[: cap - 1] + "…"


def _exit(entry: ActivityEntry) -> str:
    return f"exit {entry.exit}" if entry.exit is not None else (entry.status or "?")


def _digest(memory: Memory, job_id: str) -> tuple[list[ActivityEntry], dict[str, str]]:
    rows = sorted(memory.activity_after(job_id, 0, ENTRY_CAP), key=lambda e: e.seq)
    outputs = {e.step: e.text for e in rows if e.kind == "output" and e.step}
    return [e for e in rows if e.kind in _STEP_KINDS], outputs


def activity_summary(memory: Memory, job_id: str, now: datetime, cap: int = SUMMARY_CAP) -> str:
    """Facts about what a job did, for a wake: counts, failed commands with their output tail,
    the last commands and the step running now. Plain reads; the stored text is already masked."""
    steps, outputs = _digest(memory, job_id)
    if not steps:
        return "no activity recorded"
    failed = [e for e in steps if is_failed(e)]
    lines = [f"steps: {len(steps)}, failed: {len(failed)}"]
    for entry in failed[-FAILED_SHOWN:]:
        lines.append(f"failed: {_clip(entry.text)} ({_exit(entry)})")
        tail = [ln for ln in outputs.get(entry.step or "", "").splitlines() if ln.strip()]
        lines.extend(f"  {_clip(ln)}" for ln in tail[-FAILED_TAIL_LINES:])
    commands = [e for e in steps if e.kind == "command"]
    if commands:
        lines.append("recent:")
        lines.extend(f"  {_clip(e.text)} ({_exit(e)})" for e in commands[-RECENT_COMMANDS:])
    live = [e for e in steps if e.status in ("running", "pending")]
    if live:
        entry = live[-1]
        minutes = max(0, int((now - datetime.fromisoformat(entry.at)).total_seconds() // 60))
        lines.append(f"running: {_clip(entry.text)}, {minutes} min")
    return _fit(lines, cap)


def _fit(lines: list[str], cap: int) -> str:
    """Whole lines first; the line that crosses the cap is cut with an ellipsis."""
    out: list[str] = []
    used = 0
    for line in lines:
        room = cap - used - (1 if out else 0)
        if len(line) <= room:
            out.append(line)
            used += len(line) + (1 if len(out) > 1 else 0)
            continue
        if room > 1:
            out.append(line[: room - 1] + "…")
        break
    return "\n".join(out)


def activity_line(memory: Memory, job_id: str, now: datetime) -> str:
    """One line for list_jobs: counts, then what is running or the last failure."""
    steps, _ = _digest(memory, job_id)
    if not steps:
        return ""
    failed = [e for e in steps if is_failed(e)]
    line = f"{len(steps)} steps, {len(failed)} failed"
    live = [e for e in steps if e.status in ("running", "pending")]
    if live:
        line += f"; running: {_clip(live[-1].text, 80)}"
    elif failed:
        line += f"; last failure: {_clip(failed[-1].text, 80)} ({_exit(failed[-1])})"
    return _clip(line, LINE_CAP)
