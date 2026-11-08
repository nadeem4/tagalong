"""The brain's pid file and `tagalong stop`.

The desktop starts the brain detached and never ends it, so something must: the brain writes
`<home>/brain.pid` while it runs and `stop_brain` ends the process named there. The real
`alive`, `kill` and `wait` are small and platform-aware; the stop logic takes them as
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


def write_pid(home: Path, pid: int) -> None:
    pid_path(home).write_text(str(pid))


def _read_pid(home: Path) -> int | None:
    try:
        return int(pid_path(home).read_text().strip())
    except (OSError, ValueError):
        return None


def clear_pid(home: Path, pid: int) -> None:
    """Remove the file only if it is still ours: a newer brain may have replaced it."""
    if _read_pid(home) == pid:
        pid_path(home).unlink(missing_ok=True)


def stop_brain(
    home: Path,
    *,
    alive: Callable[[int], bool],
    kill: Callable[[int], None],
    wait: Callable[[int], bool],
) -> Literal["stopped", "not_running", "failed"]:
    """`wait(pid)` returns True while the process is still alive after the kill."""
    pid = _read_pid(home)
    if pid is None or not alive(pid):
        pid_path(home).unlink(missing_ok=True)  # a stale file must not block the next start
        return "not_running"
    kill(pid)
    if wait(pid):
        return "failed"
    clear_pid(home, pid)
    return "stopped"


def real_alive(pid: int) -> bool:
    if sys.platform == "win32":
        # os.kill(pid, 0) would TERMINATE the process on Windows, so ask the OS instead.
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
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


def real_kill(pid: int) -> None:
    os.kill(pid, signal.SIGTERM)  # TerminateProcess on Windows


def real_wait(pid: int) -> bool:
    """Poll up to STOP_WAIT_S; True if the process is still alive at the end."""
    deadline = time.monotonic() + STOP_WAIT_S
    while time.monotonic() < deadline:
        if not real_alive(pid):
            return False
        time.sleep(0.1)
    return real_alive(pid)


def stop_real_brain(home: Path) -> Literal["stopped", "not_running", "failed"]:
    return stop_brain(home, alive=real_alive, kill=real_kill, wait=real_wait)
