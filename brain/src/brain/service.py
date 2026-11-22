"""Runs the brain at logon as a per-user service: a Windows scheduled task, a macOS launchd
agent or a Linux systemd user unit. The unit text is rendered here and every OS call goes
through `run`, so tests read the text and the calls and never touch a real service.
"""

import os
import shlex
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from xml.sax.saxutils import escape

Os = Literal["windows", "macos", "linux"]
Runner = Callable[[list[str]], tuple[int, str]]  # argv -> (exit code, output)

TASK = "TagalongBrain"  # also named in the desktop installer (build/installer.nsh)
LABEL = "app.tagalong.brain"
UNIT = "tagalong-brain.service"

_WINDOWS = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <Hidden>true</Hidden>
  </Settings>
  <Actions Context="Author">
    <Exec>
{exec}    </Exec>
  </Actions>
</Task>
"""

_MACOS = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{exe}</string>
  </array>
{env}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
"""

_LINUX = """[Unit]
Description=Tagalong brain

[Service]
ExecStart={exe}
{env}Restart=on-failure
RestartSec=60

[Install]
WantedBy=default.target
"""


class ServiceError(Exception):
    """The OS refused; the message is what it said."""


def real_run(argv: list[str]) -> tuple[int, str]:
    try:
        done = subprocess.run(
            argv, capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL
        )
    except (OSError, subprocess.TimeoutExpired) as err:
        return 127, str(err)
    return done.returncode, (done.stdout + done.stderr).strip()


@dataclass(frozen=True)
class Service:
    """`exe` is the brain's launcher and `path` where the unit file goes. A `home` other than
    the default is written into the unit so the logon brain uses the same data folder; `domain`
    is the launchd session the agent loads into."""

    os: Os
    exe: str
    path: Path
    run: Runner
    home: str | None = None
    domain: str = ""

    def unit_text(self) -> str:
        return _SPECS[self.os].render(self.exe, self.home)

    def install(self) -> None:
        spec = _SPECS[self.os]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(self.unit_text(), encoding=spec.encoding)
        for argv in spec.install(self):
            code, output = self.run(argv)
            if code != 0:
                raise ServiceError(output or f"{argv[0]} exited with {code}")

    def remove(self) -> None:
        """Nothing installed is already the goal, so the OS's complaint is not an error."""
        spec = _SPECS[self.os]
        for argv in spec.remove(self):
            self.run(argv)
        self.path.unlink(missing_ok=True)
        for argv in spec.after_remove:
            self.run(argv)

    def installed(self) -> bool:
        return self.run(_SPECS[self.os].query(self))[0] == 0


def _windows(exe: str, home: str | None) -> str:
    if home is None:
        run = f"      <Command>{escape(exe)}</Command>\n"
    else:
        # Task Scheduler has no environment, so cmd sets it; /s keeps the outer quotes meaningful.
        line = f'/d /s /c ""set "TAGALONG_HOME={home}" && "{exe}""'
        run = f"      <Command>cmd.exe</Command>\n      <Arguments>{escape(line)}</Arguments>\n"
    return _WINDOWS.format(exec=run)


def _macos(exe: str, home: str | None) -> str:
    env = ""
    if home is not None:
        env = (
            "  <key>EnvironmentVariables</key>\n  <dict>\n    <key>TAGALONG_HOME</key>\n"
            f"    <string>{escape(home)}</string>\n  </dict>\n"
        )
    return _MACOS.format(label=LABEL, exe=escape(exe), env=env)


def _linux(exe: str, home: str | None) -> str:
    env = ""
    if home is not None:
        quoted = home.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
        env = f'Environment="TAGALONG_HOME={quoted}"\n'
    return _LINUX.format(exe=shlex.quote(exe), env=env)


@dataclass(frozen=True)
class _Spec:
    render: Callable[[str, str | None], str]
    encoding: str
    install: Callable[[Service], list[list[str]]]
    remove: Callable[[Service], list[list[str]]]
    query: Callable[[Service], list[str]]
    after_remove: tuple[list[str], ...] = ()


_SPECS: dict[Os, _Spec] = {
    "windows": _Spec(
        _windows,
        "utf-16",  # Task Scheduler reads the file as UTF-16, which its XML header says
        lambda s: [
            ["schtasks", "/Create", "/TN", TASK, "/XML", str(s.path), "/F"],
            ["schtasks", "/Run", "/TN", TASK],
        ],
        lambda s: [["schtasks", "/End", "/TN", TASK], ["schtasks", "/Delete", "/TN", TASK, "/F"]],
        lambda s: ["schtasks", "/Query", "/TN", TASK],
    ),
    "macos": _Spec(
        _macos,
        "utf-8",
        lambda s: [["launchctl", "bootstrap", s.domain, str(s.path)]],
        lambda s: [["launchctl", "bootout", f"{s.domain}/{LABEL}"]],
        lambda s: ["launchctl", "print", f"{s.domain}/{LABEL}"],
    ),
    "linux": _Spec(
        _linux,
        "utf-8",
        lambda s: [
            ["systemctl", "--user", "daemon-reload"],
            ["systemctl", "--user", "enable", "--now", UNIT],
        ],
        lambda s: [["systemctl", "--user", "disable", "--now", UNIT]],
        lambda s: ["systemctl", "--user", "is-enabled", UNIT],
        after_remove=(["systemctl", "--user", "daemon-reload"],),
    ),
}


def real_service(data_dir: Path) -> Service:
    """This machine's service; the launcher is the `brain` script beside the running Python."""
    os_name: Os = (
        "windows" if sys.platform == "win32" else "macos" if sys.platform == "darwin" else "linux"
    )
    user = Path.home()
    path = {
        "windows": data_dir / "service" / f"{TASK}.xml",
        "macos": user / "Library" / "LaunchAgents" / f"{LABEL}.plist",
        "linux": user / ".config" / "systemd" / "user" / UNIT,
    }[os_name]
    launcher = "brain.exe" if os_name == "windows" else "brain"
    return Service(
        os_name,
        str(Path(sys.executable).parent / launcher),
        path,
        real_run,
        home=None if data_dir == user / ".tagalong" else str(data_dir),
        domain=f"gui/{os.getuid()}" if os_name == "macos" else "",
    )
