"""`tagalong pair`: a QR and a link from a terminal, with no brain running."""

import os
import subprocess
import sys

from test_cli import Rig

from brain.store.db import open_db

HOST = {"host_addr": lambda: "192.168.1.5"}


def test_pair_prints_a_link_and_a_qr(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("pair", env={"TAGALONG_NETWORK": "1"}, **HOST) == 0
    assert "tagalong://pair?addr=192.168.1.5:47323" in rig.text
    assert "10 minutes" in rig.text
    assert "\u2588" in rig.text or "\u2580" in rig.text


def test_pair_says_how_to_turn_the_network_on_when_it_is_off(tmp_path):
    rig = Rig(tmp_path)
    assert rig.go("pair", **HOST) == 1
    assert "TAGALONG_NETWORK=1" in rig.text and "tagalong://" not in rig.text


def test_the_code_in_the_link_is_stored_only_hashed(tmp_path):
    rig = Rig(tmp_path)
    rig.go("pair", env={"TAGALONG_NETWORK": "1"}, **HOST)
    link = next(line for line in rig.lines if line.startswith("tagalong://"))
    secret = link.split("code=")[1]
    stored = open_db(tmp_path / "tagalong.db").execute("SELECT secret_hash FROM pair_codes")
    assert [r[0] for r in stored] != [secret] and secret not in "".join(r[0] for r in stored)


def test_pair_for_a_node_makes_a_node_code(tmp_path):
    rig = Rig(tmp_path)
    rig.go("pair", "--kind", "node", env={"TAGALONG_NETWORK": "1"}, **HOST)
    kinds = open_db(tmp_path / "tagalong.db").execute("SELECT kind FROM pair_codes").fetchall()
    assert kinds == [("node",)]


def test_the_qr_prints_on_a_console_that_is_not_utf8(tmp_path):
    env = {
        **os.environ,
        "TAGALONG_HOME": str(tmp_path),
        "TAGALONG_NETWORK": "1",
        "PYTHONIOENCODING": "cp1252",
    }
    done = subprocess.run(
        [sys.executable, "-c", "import sys; from brain.cli import main; sys.exit(main(['pair']))"],
        env=env,
        capture_output=True,
        timeout=60,
    )
    assert done.returncode == 0, done.stderr.decode()
    assert b"tagalong://pair?" in done.stdout
