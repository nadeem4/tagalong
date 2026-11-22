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
      <Command>{exe}</Command>
    </Exec>
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
  <key>RunAtLoad</key>
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
Restart=on-failure
RestartSec=60

[Install]
WantedBy=default.target
"""


class ServiceError(Exception):
    """The OS refused; the message is what it said."""


def real_run(argv: list[str]) -> tuple[int, str]:
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as err:
        return 127, str(err)
    return done.returncode, (done.stdout + done.stderr).strip()


@dataclass(frozen=True)
class Service:
    """`exe` is the brain's launcher; `data_dir` holds the Windows task file."""

    os: Os
    exe: str
    user_home: Path
    data_dir: Path
    uid: int
    run: Runner

    def unit_text(self) -> str:
        if self.os == "windows":
            return _WINDOWS.format(exe=escape(self.exe))
        if self.os == "macos":
            return _MACOS.format(label=LABEL, exe=escape(self.exe))
        return _LINUX.format(exe=shlex.quote(self.exe))

    def _path(self) -> Path:
        if self.os == "windows":
            return self.data_dir / "service" / f"{TASK}.xml"
        if self.os == "macos":
            return self.user_home / "Library" / "LaunchAgents" / f"{LABEL}.plist"
        return self.user_home / ".config" / "systemd" / "user" / UNIT

    def install(self) -> None:
        path = self._path()
        path.parent.mkdir(parents=True, exist_ok=True)
        # Task Scheduler reads the file as UTF-16, which its XML header says.
        path.write_text(self.unit_text(), encoding="utf-16" if self.os == "windows" else "utf-8")
        steps = {
            "windows": [
                ["schtasks", "/Create", "/TN", TASK, "/XML", str(path), "/F"],
                ["schtasks", "/Run", "/TN", TASK],
            ],
            "macos": [["launchctl", "bootstrap", f"gui/{self.uid}", str(path)]],
            "linux": [
                ["systemctl", "--user", "daemon-reload"],
                ["systemctl", "--user", "enable", "--now", UNIT],
            ],
        }[self.os]
        for argv in steps:
            code, output = self.run(argv)
            if code != 0:
                raise ServiceError(output or f"{argv[0]} exited with {code}")

    def remove(self) -> None:
        """Nothing installed is already the goal, so the OS's complaint is not an error."""
        steps = {
            "windows": [
                ["schtasks", "/End", "/TN", TASK],
                ["schtasks", "/Delete", "/TN", TASK, "/F"],
            ],
            "macos": [["launchctl", "bootout", f"gui/{self.uid}/{LABEL}"]],
            "linux": [["systemctl", "--user", "disable", "--now", UNIT]],
        }[self.os]
        for argv in steps:
            self.run(argv)
        self._path().unlink(missing_ok=True)
        if self.os == "linux":
            self.run(["systemctl", "--user", "daemon-reload"])

    def installed(self) -> bool:
        query = {
            "windows": ["schtasks", "/Query", "/TN", TASK],
            "macos": ["launchctl", "print", f"gui/{self.uid}/{LABEL}"],
            "linux": ["systemctl", "--user", "is-enabled", UNIT],
        }[self.os]
        return self.run(query)[0] == 0


def real_service(data_dir: Path) -> Service:
    """This machine's service; the launcher is the `brain` script beside the running Python."""
    os_name: Os = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")  # type: ignore[assignment]
    launcher = "brain.exe" if os_name == "windows" else "brain"
    return Service(
        os_name,
        str(Path(sys.executable).parent / launcher),
        user_home=Path.home(),
        data_dir=data_dir,
        uid=os.getuid() if hasattr(os, "getuid") else 0,
        run=real_run,
    )
