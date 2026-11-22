"""write_private: owner-only secrets on POSIX and Windows; the Windows call is faked."""

import subprocess
import sys

import pytest

from brain.private_file import write_private


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX modes")
def test_posix_file_is_0600(tmp_path):
    p = tmp_path / "secret"
    write_private(p, "x")
    assert p.read_text() == "x"
    assert p.stat().st_mode & 0o777 == 0o600


def test_windows_keeps_full_control_for_the_current_user_only(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("USERNAME", "alice")
    monkeypatch.setattr(subprocess, "run", lambda argv, **kw: calls.append(argv))
    p = tmp_path / "secret"
    write_private(p, "x")
    assert p.read_text() == "x"
    assert "/inheritance:r" in calls[0]
    assert "alice:F" in calls[0]


def test_failure_to_lock_down_raises_and_removes_the_file(tmp_path, monkeypatch):
    def boom(argv, **kw):
        raise OSError("no icacls")

    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("USERNAME", "alice")
    monkeypatch.setattr(subprocess, "run", boom)
    p = tmp_path / "secret"
    with pytest.raises(OSError):
        write_private(p, "x")
    assert not p.exists()
