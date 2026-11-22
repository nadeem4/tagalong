"""`tagalong service install|remove|status` on a fake OS runner."""

from test_cli import Rig
from test_service import Calls

from brain.service import Service


def rig_with(tmp_path, runner):
    service = Service("linux", "/v/bin/brain", tmp_path / "unit", runner)
    return Rig(tmp_path), {"service_for": lambda home: service}


def test_install_registers_the_service_and_saves_the_network_switch_on(tmp_path):
    rig, kw = rig_with(tmp_path, Calls())
    assert rig.go("service", "install", **kw) == 0
    assert "TAGALONG_NETWORK=1" in (tmp_path / ".env").read_text()
    assert "Installed" in rig.text and "other devices" in rig.text
    assert "network listener on (TAGALONG_NETWORK=1" in rig.text


def test_the_network_switch_is_saved_before_the_service_starts_the_brain(tmp_path):
    seen = []

    def runner(argv):
        seen.append("TAGALONG_NETWORK=1" in (tmp_path / ".env").read_text())
        return 0, ""

    rig, kw = rig_with(tmp_path, runner)
    assert rig.go("service", "install", **kw) == 0
    assert seen and all(seen)
    assert "already running" in rig.text and "restarts" in rig.text


def test_a_refusing_os_puts_the_env_file_back_as_it_was(tmp_path):
    (tmp_path / ".env").write_text("A=1\n")
    rig, kw = rig_with(tmp_path, Calls(code=1, output="no systemd"))
    assert rig.go("service", "install", **kw) == 1
    assert (tmp_path / ".env").read_text() == "A=1\n"


def test_a_refusing_os_leaves_the_network_switch_alone(tmp_path):
    rig, kw = rig_with(tmp_path, Calls(code=1, output="no systemd"))
    assert rig.go("service", "install", **kw) == 1
    assert "no systemd" in rig.text
    assert not (tmp_path / ".env").exists()


def test_status_says_installed_or_not_installed(tmp_path):
    rig, kw = rig_with(tmp_path, Calls(code=0))
    assert rig.go("service", "status", **kw) == 0
    assert rig.lines == ["installed"]
    rig, kw = rig_with(tmp_path, Calls(code=1))
    assert rig.go("service", "status", **kw) == 0
    assert rig.lines == ["not installed"]


def test_remove_says_it_is_gone_and_keeps_the_network_switch(tmp_path):
    (tmp_path / ".env").write_text("TAGALONG_NETWORK=1\n")
    rig, kw = rig_with(tmp_path, Calls())
    assert rig.go("service", "remove", **kw) == 0
    assert "Removed" in rig.lines[-1]
    assert "TAGALONG_NETWORK=1" in (tmp_path / ".env").read_text()
