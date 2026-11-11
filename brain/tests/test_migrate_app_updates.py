"""Migration 0030: an app keeps the version it was installed at.

Runs on a file seeded at the version before it. The version is read back from the package
argument the installer pinned (`pkg@1.2.0`, `@scope/pkg@1.2.0`, `pkg==1.2.0`); anything else
reads as no version, and an app added by hand has none.
"""

import json
import sqlite3

import pytest

from brain.store.db import migrate

BEFORE = 29
APPS = [
    ("a", "stdio", {"command": "node", "args": ["npm", "exec", "--yes", "--", "acme-notes@1.2.0"]}),
    ("b", "stdio", {"command": "node", "args": ["npm", "exec", "--", "@acme/notes@2.0.1"]}),
    ("c", "stdio", {"command": "uvx", "args": ["--", "acme-py==0.4.3"]}),
    ("d", "stdio", {"command": "node", "args": ["npm", "exec", "--", "@acme/notes"]}),
    ("e", "stdio", {"command": "notes"}),
    ("f", "http", {"url": "https://x.test/mcp"}),
]


@pytest.fixture
def db(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    for app_id, transport, config in APPS:
        db.execute(
            "INSERT INTO apps(id, name, transport, config, auth) VALUES (?,?,?,?,'none')",
            (app_id, app_id, transport, json.dumps(config)),
        )
    migrate(db)
    return db


def test_the_pinned_version_is_read_from_the_package_argument(db):
    got = dict(db.execute("SELECT id, version FROM apps"))
    assert got == {"a": "1.2.0", "b": "2.0.1", "c": "0.4.3", "d": "", "e": "", "f": ""}
