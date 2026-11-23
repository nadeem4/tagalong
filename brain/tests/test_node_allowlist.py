"""The node's allow-list is the security boundary: only a spec the person approved on this
machine runs, whoever asks. Real files in a temp folder stand in for executables; nothing runs.
"""

import sys
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


def test_a_link_runs_as_the_link_so_a_venv_python_keeps_its_venv(allowlist, exe, tmp_path):
    link = tmp_path / "python"
    try:
        link.symlink_to(exe)
    except OSError:
        pytest.skip("this machine cannot make symlinks")
    allowlist.allow(spec(link))
    assert allowlist.permits(spec(link)) == str(link)
    exe.write_bytes(b"binary two")
    assert allowlist.permits(spec(link)) is None


URL = "https://mcp.example.com/mcp"


def test_an_exact_url_is_permitted_and_another_is_not(allowlist):
    allowlist.allow(PipeSpec(url=URL))
    assert allowlist.permits(PipeSpec(url=URL)) == URL
    assert allowlist.permits(PipeSpec(url=URL + "/x")) is None
    assert allowlist.permits(PipeSpec(url="https://evil.example.com/mcp")) is None


def test_a_url_entry_never_permits_a_command_and_the_reverse(allowlist, exe):
    allowlist.allow(PipeSpec(url=URL))
    assert allowlist.permits(spec(exe)) is None
    allowlist.allow(spec(exe))
    assert allowlist.permits(PipeSpec(url="https://other.example.com/")) is None


def test_secrets_are_kept_with_the_entry_and_survive_approving_it_again(allowlist, exe):
    allowlist.allow(spec(exe), secret_env={"API_KEY": "s3cret"})
    assert allowlist.secrets(spec(exe)).env == {"API_KEY": "s3cret"}
    exe.write_bytes(b"binary two")
    allowlist.allow(spec(exe))
    assert allowlist.secrets(spec(exe)).env == {"API_KEY": "s3cret"}
    assert allowlist.secrets(spec(exe, "other")).env == {}


def test_a_url_secret_is_the_entrys_and_a_spec_cannot_ask_for_another_entrys(allowlist):
    allowlist.allow(PipeSpec(url=URL), url_query="key=abc")
    assert allowlist.secrets(PipeSpec(url=URL)).url_query == "key=abc"
    assert allowlist.secrets(PipeSpec(url=URL + "?x=1")).url_query is None


@pytest.mark.skipif(sys.platform == "win32", reason="chmod is not honoured on Windows")
def test_the_list_file_is_owner_only_once_it_holds_secrets(allowlist, exe, tmp_path):
    allowlist.allow(spec(exe), secret_env={"API_KEY": "s3cret"})
    assert (tmp_path / "node" / "allowlist.json").stat().st_mode & 0o077 == 0
