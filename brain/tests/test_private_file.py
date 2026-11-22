"""write_private: owner-only secrets on POSIX and Windows; the Windows call is faked."""

import sys

import pytest

from brain.private_file import write_private


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX modes")
def test_posix_file_is_0600(tmp_path):
    p = tmp_path / "secret"
    write_private(p, "x")
    assert p.read_text() == "x"
    assert p.stat().st_mode & 0o777 == 0o600


def test_windows_strips_inherited_access_with_icacls(tmp_path):
    calls = []
    p = tmp_path / "secret"
    write_private(p, "x", platform="win32", run=lambda argv, **kw: calls.append(argv))
    assert p.read_text() == "x"
    assert calls[0][0] == "icacls"
    assert "/inheritance:r" in calls[0]
    assert any(a.endswith(":F") for a in calls[0])  # the current user keeps full control


def test_failure_to_lock_down_raises_and_removes_the_file(tmp_path):
    p = tmp_path / "secret"

    def boom(argv, **kw):
        raise OSError("no icacls")

    with pytest.raises(OSError):
        write_private(p, "x", platform="win32", run=boom)
    assert not p.exists()
