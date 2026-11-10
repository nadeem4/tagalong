"""Checks the brain's version and build id, which the desktop compares to its own.

The source hash must match the TypeScript one byte for byte (same fixture, same literal), so a
dev desktop and a dev brain agree when they run the same files.
"""

import shutil
import tomllib
from pathlib import Path

from brain.build_info import app_version, build_id, source_hash

FIXTURE = Path(__file__).parent / "fixtures" / "build-hash"
FIXTURE_HASH = "944069bbc26e"


def test_source_hash_is_stable_and_ignores_pycache():
    assert source_hash(FIXTURE) == FIXTURE_HASH


def test_source_hash_changes_when_a_file_changes(tmp_path):
    copy = tmp_path / "copy"
    shutil.copytree(FIXTURE, copy)
    (copy / "a.py").write_text("x = 2\n")
    assert source_hash(copy) != source_hash(FIXTURE)


def test_build_id_prefers_env():
    assert build_id("1.2.3", FIXTURE) == "1.2.3"
    assert build_id("", FIXTURE) == FIXTURE_HASH
    assert build_id(None, FIXTURE) == FIXTURE_HASH


def test_app_version_matches_pyproject():
    pyproject = Path(__file__).parents[1] / "pyproject.toml"
    assert app_version() == tomllib.loads(pyproject.read_text())["project"]["version"]
