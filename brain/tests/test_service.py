"""The per-user service: unit text per OS against golden files, and the OS calls on a fake
runner. Nothing here registers a real task, agent or unit.
"""

import re
import sys
from pathlib import Path
from xml.sax.saxutils import unescape

import pytest

from brain.service import Service, ServiceError, real_service

GOLDEN = Path(__file__).parent / "fixtures" / "service"
EXE = {
    "windows": "C:\\Users\\me\\venv\\Scripts\\brain-service.exe",
    "macos": "/home/me/venv/bin/brain",
    "linux": "/home/me/venv/bin/brain",
}
GOLDEN_FILE = {"windows": "windows.xml", "macos": "macos.plist", "linux": "linux.service"}


class Calls:
    def __init__(self, code=0, output=""):
        self.calls: list[list[str]] = []
        self.code, self.output = code, output

    def __call__(self, argv):
        self.calls.append(argv)
        return self.code, self.output


PATH = {
    "windows": ("data", "service", "TagalongBrain.xml"),
    "macos": ("user", "Library", "LaunchAgents", "app.tagalong.brain.plist"),
    "linux": ("user", ".config", "systemd", "user", "tagalong-brain.service"),
}
HOME = {
    "windows": "C:\\Users\\me\\tag home",
    "macos": "/Users/me/tag home",
    "linux": "/home/me/tag home",
}


BASE_ENV = {"TAGALONG_STARTED_BY": "service"}
FULL_ENV = {
    "TAGALONG_HOME": HOME["windows"],
    "TAGALONG_BUILD": "1.4.0",
    "TAGALONG_STARTED_BY": "service",
}


def service(tmp_path, os_name, runner, env=None):
    return Service(
        os_name,
        EXE[os_name],
        tmp_path.joinpath(*PATH[os_name]),
        runner,
        env=BASE_ENV if env is None else env,
        log="/home/me/tag home/brain.log",
        domain="gui/501" if os_name == "macos" else "",
    )


@pytest.mark.parametrize("os_name", ["windows", "macos", "linux"])
def test_unit_text_matches_the_golden_file(tmp_path, os_name):
    text = service(tmp_path, os_name, Calls()).unit_text()
    assert text == (GOLDEN / GOLDEN_FILE[os_name]).read_text(encoding="utf-8")


@pytest.mark.parametrize("os_name", ["windows", "macos", "linux"])
def test_home_build_and_started_by_are_written_into_the_unit_matching_the_golden_file(
    tmp_path, os_name
):
    env = {**FULL_ENV, "TAGALONG_HOME": HOME[os_name]}
    text = service(tmp_path, os_name, Calls(), env=env).unit_text()
    golden = GOLDEN / f"env-{GOLDEN_FILE[os_name]}"
    assert text == golden.read_text(encoding="utf-8")


def test_windows_install_registers_a_logon_task_from_a_utf16_file_and_starts_it(tmp_path):
    runner = Calls()
    service(tmp_path, "windows", runner).install()
    xml = tmp_path.joinpath(*PATH["windows"])
    assert xml.read_bytes().startswith(b"\xff\xfe")  # Task Scheduler reads UTF-16
    assert runner.calls == [
        ["schtasks", "/Create", "/TN", "TagalongBrain", "/XML", str(xml), "/F"],
        ["schtasks", "/Run", "/TN", "TagalongBrain"],
    ]


def test_a_log_path_with_a_percent_is_escaped_for_systemd(tmp_path):
    svc = Service("linux", EXE["linux"], tmp_path / "u", Calls(), log="/home/me/100%/brain.log")
    assert "StandardOutput=append:/home/me/100%%/brain.log" in svc.unit_text()


def test_linux_install_enables_the_unit(tmp_path):
    runner = Calls()
    service(tmp_path, "linux", runner).install()
    assert tmp_path.joinpath(*PATH["linux"]).exists()
    assert ["systemctl", "--user", "enable", "--now", "tagalong-brain.service"] in runner.calls


def test_linux_remove_deletes_the_unit_file(tmp_path):
    runner = Calls()
    unit = tmp_path.joinpath(*PATH["linux"])
    unit.parent.mkdir(parents=True)
    unit.write_text("[Unit]")
    service(tmp_path, "linux", runner).remove()
    assert not unit.exists()
    assert ["systemctl", "--user", "disable", "--now", "tagalong-brain.service"] in runner.calls


def test_macos_install_replaces_a_loaded_agent_then_loads_it_into_the_users_session(tmp_path):
    runner = Calls()
    service(tmp_path, "macos", runner).install()
    plist = tmp_path.joinpath(*PATH["macos"])
    assert runner.calls == [
        ["launchctl", "bootout", "gui/501/app.tagalong.brain"],
        ["launchctl", "bootstrap", "gui/501", str(plist)],
    ]


def test_macos_install_goes_on_when_nothing_was_loaded_to_replace(tmp_path):
    def run(argv):
        return (3, "Could not find service") if argv[1] == "bootout" else (0, "")

    service(tmp_path, "macos", run).install()


def test_remove_when_nothing_is_installed_is_not_an_error(tmp_path):
    service(tmp_path, "linux", Calls(code=1, output="not loaded")).remove()


def test_a_failed_install_says_what_the_os_said(tmp_path):
    with pytest.raises(ServiceError, match="Access is denied"):
        service(tmp_path, "windows", Calls(code=1, output="Access is denied.")).install()


def test_the_installing_environment_decides_what_the_unit_carries(tmp_path):
    custom = tmp_path / "tag home"
    env = real_service(custom, {"TAGALONG_BUILD": "1.4.0"}).env
    assert env == {
        "TAGALONG_HOME": str(custom),
        "TAGALONG_BUILD": "1.4.0",
        "TAGALONG_STARTED_BY": "service",
    }
    assert real_service(Path.home() / ".tagalong", {}).env == {"TAGALONG_STARTED_BY": "service"}


def split_windows_args(line: str) -> list[str]:
    import ctypes
    from ctypes import wintypes

    shell32 = ctypes.WinDLL("shell32")
    shell32.CommandLineToArgvW.restype = ctypes.POINTER(wintypes.LPWSTR)
    count = ctypes.c_int()
    argv = shell32.CommandLineToArgvW(line, ctypes.byref(count))
    return [argv[i] for i in range(count.value)]


@pytest.mark.skipif(sys.platform != "win32", reason="Windows command-line rules")
def test_the_windows_arguments_split_into_the_variables_even_with_spaces(tmp_path):
    home = r"C:\Users\me\tag home" + "\\"
    text = service(
        tmp_path, "windows", Calls(), env={"TAGALONG_HOME": home, **BASE_ENV}
    ).unit_text()
    line = unescape(re.search(r"<Arguments>(.*)</Arguments>", text)[1])
    assert split_windows_args("prog " + line)[1:] == [
        f"TAGALONG_HOME={home}",
        "TAGALONG_STARTED_BY=service",
    ]
