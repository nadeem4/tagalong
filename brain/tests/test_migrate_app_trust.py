"""Migration 0028: an installed app keeps whether it was Official or Community.

Runs on a file seeded at the version before it, with rows shaped as the installer saved them:
the name is the registry title (not its id) and the config holds only a URL or command, so
nothing there proves an app Official. Old apps therefore read Community until added again.
"""

import json
import sqlite3

import pytest

from brain.store.db import migrate

BEFORE = 27


@pytest.fixture
def db(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db", isolation_level=None)
    migrate(db, upto=BEFORE)
    for app_id, name, transport, config in [
        ("a", "Notion", "http", {"url": "https://mcp.notion.com/mcp"}),
        ("b", "notion-tools", "stdio", {"command": "npx", "args": ["notion-tools"]}),
        ("c", "My notes", "stdio", {"command": "notes"}),
    ]:
        db.execute(
            "INSERT INTO apps(id, name, transport, config, auth) VALUES (?,?,?,?,'oauth')",
            (app_id, name, transport, json.dumps(config)),
        )
    migrate(db)
    return db


def test_existing_apps_read_community_after_the_upgrade(db):
    rows = db.execute("SELECT id, trust FROM apps ORDER BY id").fetchall()
    assert rows == [("a", "community"), ("b", "community"), ("c", "community")]


def test_trust_only_takes_the_two_values(db):
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE apps SET trust='trusted' WHERE id='a'")
    db.execute("UPDATE apps SET trust='official' WHERE id='a'")
