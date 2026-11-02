"""Open a visible terminal window that runs one command: where a person logs an expert in.

`OpenTerminal` is a seam so tests never open a window and other systems can plug in later.
The window's wrapper writes the command's exit code to a done file, which works even where the
opener returns at once. Windows only for now; elsewhere there is `NoTerminal`, a fact Scout
turns into "run this command yourself".
"""

import subprocess
import sys
import threading
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path

OpenTerminal = Callable[[list[str], Mapping[str, str], Path], Awaitable[None]]


class NoTerminal(Exception):
    def __init__(self, argv: list[str]) -> None:
        super().__init__("no terminal window can be opened here")
        self.command = subprocess.list2cmdline(argv)


_UNSAFE = set('"%!&|<>^')  # cmd would act on these (list2cmdline does not quote for cmd)


def terminal_line(argv: list[str], done_file: Path) -> str:
    """The cmd line: run the command, then write its exit code (delayed expansion, so it is
    the code of the command and not of the line's start). cmd drops the outer quotes.
    Refuses anything cmd would expand or split on; the person then runs the command themselves."""
    if any(_UNSAFE & set(part) for part in [*argv, str(done_file)]):
        raise NoTerminal(argv)
    return f'cmd /v:on /c "{subprocess.list2cmdline(argv)} & echo !errorlevel! > "{done_file}""'


async def real_open_terminal(argv: list[str], env: Mapping[str, str], done_file: Path) -> None:
    # Later openers: macOS `osascript` Terminal `do script`; Linux `x-terminal-emulator -e` or
    # `gnome-terminal --`.
    if sys.platform != "win32":
        raise NoTerminal(argv)
    done_file.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(  # noqa: S603 - argv is the installed expert's own command
        terminal_line(argv, done_file),
        env=dict(env),
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )

    def watch() -> None:
        # Closing the window with X kills cmd before it writes the done file; say so, so the
        # login ends as failed now instead of after the full wait.
        proc.wait()
        if not done_file.exists():
            done_file.write_text("closed", encoding="utf-8")

    threading.Thread(target=watch, daemon=True).start()
