"""The brain's pid file and `tagalong stop`.

The desktop starts the brain detached and never ends it, so something must: the brain writes
`<home>/brain.pid` while it runs and `stop_brain` ends the process named there. The real
`alive`, `kill`, `wait` and `started` are small and platform-aware; the stop logic takes them as
parameters so tests never signal a real process.
"""

import os
import signal
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Literal

STOP_WAIT_S = 5.0
_STILL_ACTIVE = 259  # GetExitCodeProcess's "has not exited" value


def pid_path(home: Path) -> Path:
    return home / "brain.pid"


def write_pid(home: Path, pid: int, started: str | None = None) -> None:
    """`started` is the process's creation time: pids are reused, so the pid alone could
    later name an unrelated process."""
    pid_path(home).write_text(f"{pid} {started}" if started else str(pid))


def _read(home: Path) -> tuple[int, str | None] | None:
    try:
        parts = pid_path(home).read_text().split()
        return int(parts[0]), (parts[1] if len(parts) > 1 else None)
    except (OSError, ValueError, IndexError):
        return None


def clear_pid(home: Path, pid: int) -> None:
    """Remove the file only if it is still ours: a newer brain may have replaced it."""
    entry = _read(home)
    if entry and entry[0] == pid:
        pid_path(home).unlink(missing_ok=True)


def stop_brain(
    home: Path,
    *,
    alive: Callable[[int], bool],
    kill: Callable[[int], None],
    wait: Callable[[int], bool],
    started: Callable[[int], str | None],
) -> Literal["stopped", "not_running", "failed"]:
    """`wait(pid)` returns True while the process is still alive after the kill. A live pid
    whose creation time differs from the file's is some other process: never kill it."""
    entry = _read(home)
    if entry is None or not alive(entry[0]) or _reused(entry, started(entry[0])):
        pid_path(home).unlink(missing_ok=True)  # a stale file must not block the next start
        return "not_running"
    pid = entry[0]
    try:
        kill(pid)
    except PermissionError:
        return "failed"
    if wait(pid):
        return "failed"
    clear_pid(home, pid)
    return "stopped"


def _reused(entry: tuple[int, str | None], live: str | None) -> bool:
    # Where no creation time can be had (other OSes, old files) the pid alone decides.
    return entry[1] is not None and live is not None and entry[1] != live


def _win_open(pid: int):
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel32.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(ctypes.c_ulonglong)] * 4
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    return kernel32, kernel32.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION


def real_alive(pid: int) -> bool:
    if sys.platform == "win32":
        # os.kill(pid, 0) would send Ctrl+C or kill the process on Windows; ask the OS instead.
        import ctypes
        from ctypes import wintypes

        kernel32, handle = _win_open(pid)
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and (
                code.value == _STILL_ACTIVE
            )
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def real_started(pid: int) -> str | None:
    """The process's creation time as text, or None where this OS gives no cheap way."""
    if sys.platform == "win32":
        import ctypes

        kernel32, handle = _win_open(pid)
        if not handle:
            return None
        try:
            times = [ctypes.c_ulonglong() for _ in range(4)]
            if not kernel32.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
                return None
            return str(times[0].value)
        finally:
            kernel32.CloseHandle(handle)
    try:  # Linux: field 22 of /proc/<pid>/stat, counted after the "(comm)" field
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def real_kill(pid: int) -> None:
    try:
        os.kill(pid, signal.SIGTERM)  # TerminateProcess on Windows
    except ProcessLookupError:
        pass  # already gone; `wait` decides the outcome


def real_wait(pid: int) -> bool:
    """Poll up to STOP_WAIT_S; True if the process is still alive at the end."""
    deadline = time.monotonic() + STOP_WAIT_S
    while time.monotonic() < deadline:
        if not real_alive(pid):
            return False
        time.sleep(0.1)
    return real_alive(pid)


def stop_real_brain(home: Path) -> Literal["stopped", "not_running", "failed"]:
    return stop_brain(home, alive=real_alive, kill=real_kill, wait=real_wait, started=real_started)
