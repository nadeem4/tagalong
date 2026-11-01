"""Checks choosing the official Node build for this machine, from a saved index sample."""

import json
from pathlib import Path

from brain.setup.node_runtime import (
    archive_name,
    pick_build,
)

INDEX = json.loads((Path(__file__).parent / "fixtures" / "node-index.sample.json").read_text())
VERSION = "v22.12.0"


def test_picks_the_newest_lts_at_or_above_min_major():
    build = pick_build(INDEX, 22, "linux", "x64")
    assert build is not None
    assert build.version == VERSION
    assert build.filename == "node-v22.12.0-linux-x64.tar.xz"
    assert build.url == "https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz"


def test_skips_non_lts():
    assert pick_build(INDEX, 23, "linux", "x64") is None


def test_filename_per_os_and_arch_for_the_five_hosts():
    assert archive_name(VERSION, "windows", "x64") == "node-v22.12.0-win-x64.zip"
    assert archive_name(VERSION, "windows", "arm64") == "node-v22.12.0-win-arm64.zip"
    assert archive_name(VERSION, "linux", "x64") == "node-v22.12.0-linux-x64.tar.xz"
    assert archive_name(VERSION, "linux", "arm64") == "node-v22.12.0-linux-arm64.tar.xz"
    assert archive_name(VERSION, "macos", "arm64") == "node-v22.12.0-darwin-arm64.tar.gz"


def test_no_build_for_an_unsupported_arch_returns_none():
    assert pick_build(INDEX, 22, "macos", "x64") is None
    assert pick_build(INDEX, 22, "linux", "riscv") is None
