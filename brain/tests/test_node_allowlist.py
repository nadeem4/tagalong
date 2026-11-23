"""The node's allow-list is the security boundary: only a spec the person approved on this
machine runs, whoever asks. Real files in a temp folder stand in for executables; nothing runs.
"""

from pathlib import Path

import pytest

from brain.node.allowlist import Allowlist, NotRunnable
from brain.protocol import PipeSpec


@pytest.fixture
def exe(tmp_path: Path) -> Path:
    path = tmp_path / "expert.exe"
    path.write_bytes(b"binary one")
    path.chmod(0o755)
    return path


@pytest.fixture
def allowlist(tmp_path: Path) -> Allowlist:
    return Allowlist(tmp_path / "node" / "allowlist.json")


def spec(command: Path | str, *args: str) -> PipeSpec:
    return PipeSpec(command=str(command), args=list(args))


def test_an_empty_list_refuses_everything(allowlist, exe):
    assert allowlist.permits(spec(exe)) is None


def test_an_approved_spec_is_permitted_and_names_the_file_to_run(allowlist, exe):
    allowlist.allow(spec(exe, "--stdio"))
    assert allowlist.permits(spec(exe, "--stdio")) == str(exe)


def test_other_args_are_refused(allowlist, exe):
    allowlist.allow(spec(exe, "--stdio"))
    assert allowlist.permits(spec(exe, "--stdio", "--extra")) is None
    assert allowlist.permits(spec(exe)) is None


def test_another_command_is_refused(allowlist, exe, tmp_path):
    other = tmp_path / "other.exe"
    other.write_bytes(b"binary one")
    allowlist.allow(spec(exe))
    assert allowlist.permits(spec(other)) is None


def test_a_changed_executable_is_refused(allowlist, exe):
    allowlist.allow(spec(exe))
    exe.write_bytes(b"binary two")
    assert allowlist.permits(spec(exe)) is None


def test_the_list_persists(allowlist, exe, tmp_path):
    allowlist.allow(spec(exe, "-x"))
    again = Allowlist(tmp_path / "node" / "allowlist.json")
    assert again.permits(spec(exe, "-x")) == str(exe)


def test_a_command_that_is_not_there_cannot_be_approved(allowlist, tmp_path):
    with pytest.raises(NotRunnable):
        allowlist.allow(spec(tmp_path / "missing.exe"))


def test_a_damaged_list_file_permits_nothing(exe, tmp_path):
    path = tmp_path / "node" / "allowlist.json"
    path.parent.mkdir()
    path.write_text("not json")
    assert Allowlist(path).permits(spec(exe)) is None
