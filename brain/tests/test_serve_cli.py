"""`tagalong serve` and `tagalong update` on fakes: no brain starts, no service is installed."""

import asyncio

from test_cli import Rig
from test_service import Calls

from brain.devices import Devices
from brain.service import Service
from brain.setup.facts import CmdResult
from brain.store.db import open_db, utc_now_text

HOST = {"host_addr": lambda: "192.168.1.5"}


def serving(tmp_path, runner=None, env=None):
    started: list[str] = []
    service = Service("linux", "/v/bin/brain", tmp_path / "unit", runner or Calls())
    rig = Rig(tmp_path)

    def run_brain() -> None:
        asyncio.run(asyncio.sleep(0))
        started.append((tmp_path / ".env").read_text())

    kw = {"run_brain": run_brain, "service_for": lambda home: service, **HOST}
    return rig, kw, started, env or {}


def test_serve_turns_the_network_on_prints_a_pairing_link_and_starts_the_brain(tmp_path):
    rig, kw, started, env = serving(tmp_path)
    assert rig.go("serve", env=env, **kw) == 0
    assert len(started) == 1 and "TAGALONG_NETWORK=1" in started[0]
    assert "tagalong://pair?addr=192.168.1.5:47323" in rig.text
    assert "\u2588" in rig.text or "\u2580" in rig.text


def test_serve_prints_the_pairing_link_before_the_brain_starts(tmp_path):
    rig, kw, _, env = serving(tmp_path)
    kw["run_brain"] = lambda: rig.out("brain started")
    rig.go("serve", env=env, **kw)
    assert rig.lines.index("brain started") == len(rig.lines) - 1


def test_serve_prints_no_link_once_a_device_is_paired(tmp_path):
    Devices(open_db(tmp_path / "tagalong.db"), utc_now_text).create("laptop", "desktop")
    rig, kw, started, env = serving(tmp_path)
    assert rig.go("serve", env=env, **kw) == 0
    assert len(started) == 1
    assert "tagalong://" not in rig.text and "tagalong pair" in rig.text


def test_serve_pairs_by_the_public_host_when_the_machine_is_behind_docker(tmp_path):
    rig, kw, _, env = serving(tmp_path, env={"TAGALONG_PUBLIC_HOST": "brain.example.net"})
    del kw["host_addr"]
    assert rig.go("serve", env=env, **kw) == 0
    assert "addr=brain.example.net:47323" in rig.text


def test_serve_with_install_service_installs_it_prints_the_link_and_does_not_run_the_brain(
    tmp_path,
):
    rig, kw, started, env = serving(tmp_path)
    assert rig.go("serve", "--install-service", env=env, **kw) == 0
    assert "Installed" in rig.text
    assert "tagalong://pair?addr=192.168.1.5:47323" in rig.text
    assert started == []
    assert "TAGALONG_NETWORK=1" in (tmp_path / ".env").read_text()


def test_serve_with_a_refusing_service_prints_no_link_and_fails(tmp_path):
    rig, kw, started, env = serving(tmp_path, runner=Calls(code=1, output="no systemd"))
    assert rig.go("serve", "--install-service", env=env, **kw) == 1
    assert "no systemd" in rig.text and "tagalong://" not in rig.text
    assert started == []


def test_update_upgrades_the_installed_brain_and_says_to_restart(tmp_path):
    rig = Rig(tmp_path)
    calls = []

    async def run(argv, env, cwd):
        calls.append(argv)
        return CmdResult(0, "", "")

    assert rig.go("update", run=run) == 0
    assert calls == [["uv", "tool", "upgrade", "brain"]]
    assert "tagalong stop" in rig.text


def test_update_shows_what_uv_said_when_it_fails(tmp_path):
    rig = Rig(tmp_path)

    async def run(argv, env, cwd):
        return CmdResult(2, "", "`brain` is not installed")

    assert rig.go("update", run=run) == 1
    assert "`brain` is not installed" in rig.text


def test_pair_after_serve_reads_the_network_switch_and_public_host_saved_in_env(tmp_path):
    (tmp_path / ".env").write_text("TAGALONG_NETWORK=1\nTAGALONG_PUBLIC_HOST=h\n")
    rig = Rig(tmp_path)
    assert rig.go("pair") == 0
    assert "addr=h:47323" in rig.text
