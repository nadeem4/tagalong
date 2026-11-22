"""The per-user service: unit text per OS against golden files, and the OS calls on a fake
runner. Nothing here registers a real task, agent or unit.
"""

from pathlib import Path

import pytest

from brain.service import Service, ServiceError, real_service

GOLDEN = Path(__file__).parent / "fixtures" / "service"
EXE = {
    "windows": "C:\\Users\\me\\venv\\Scripts\\brain.exe",
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


def service(tmp_path, os_name, runner, home=None):
    return Service(
        os_name,
        EXE[os_name],
        tmp_path.joinpath(*PATH[os_name]),
        runner,
        home=home,
        domain="gui/501" if os_name == "macos" else "",
    )


@pytest.mark.parametrize("os_name", ["windows", "macos", "linux"])
def test_unit_text_matches_the_golden_file(tmp_path, os_name):
    text = service(tmp_path, os_name, Calls()).unit_text()
    assert text == (GOLDEN / GOLDEN_FILE[os_name]).read_text(encoding="utf-8")


@pytest.mark.parametrize("os_name", ["windows", "macos", "linux"])
def test_a_custom_home_is_written_into_the_unit_matching_the_golden_file(tmp_path, os_name):
    text = service(tmp_path, os_name, Calls(), home=HOME[os_name]).unit_text()
    golden = GOLDEN / f"home-{GOLDEN_FILE[os_name]}"
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


def test_macos_install_loads_the_agent_into_the_users_session(tmp_path):
    runner = Calls()
    service(tmp_path, "macos", runner).install()
    plist = tmp_path.joinpath(*PATH["macos"])
    assert runner.calls == [["launchctl", "bootstrap", "gui/501", str(plist)]]


def test_remove_when_nothing_is_installed_is_not_an_error(tmp_path):
    service(tmp_path, "linux", Calls(code=1, output="not loaded")).remove()


def test_a_failed_install_says_what_the_os_said(tmp_path):
    with pytest.raises(ServiceError, match="Access is denied"):
        service(tmp_path, "windows", Calls(code=1, output="Access is denied.")).install()


def test_only_a_non_default_data_folder_is_written_into_the_unit(tmp_path):
    assert real_service(tmp_path).home == str(tmp_path)
    assert real_service(Path.home() / ".tagalong").home is None
