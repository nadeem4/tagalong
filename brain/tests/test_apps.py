"""Tests for connected apps: slugs, env expansion, validation, and the apps table store."""

import sqlite3

import pytest

from brain import memory
from brain.apps import AppError, AppRow, expand_env, slug_for, validate_app
from brain.memory import Memory


@pytest.fixture
def mem(tmp_path):
    m = Memory(tmp_path / "a.db")
    yield m
    m.close()


def test_migration_adds_apps(tmp_path):
    path = tmp_path / "m.db"
    Memory(path).close()
    db = sqlite3.connect(path)
    cols = [r[1] for r in db.execute("PRAGMA table_info(apps)")]
    assert cols == ["id", "name", "transport", "config", "auth", "enabled"]
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO apps VALUES('x','X','ftp','{}','none',1)")
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO apps VALUES('x','X','http','{}','basic',1)")
    db.close()
    assert len(memory.MIGRATIONS) >= 5


def test_slug_basic():
    assert slug_for("My Linear App!", set()) == "my-linear-app"


def test_slug_clash():
    assert slug_for("Linear", {"linear"}) == "linear-2"
    assert slug_for("Linear", {"linear", "linear-2"}) == "linear-3"


def test_slug_avoids_body_ids():
    assert slug_for("Desktop", set()) == "desktop-2"
    assert slug_for("extension", set()) == "extension-2"


def test_slug_max_24():
    slug = slug_for("a" * 40, set())
    assert slug == "a" * 24
    assert len(slug_for("a" * 40, {slug})) <= 24
    assert slug_for("a" * 40, {slug}).endswith("-2")


def test_slug_empty_name():
    assert slug_for("!!!", set()) == "app"


def test_expand_env():
    env = {"A": "1", "E": ""}
    assert expand_env("x-${A}-y", env) == "x-1-y"
    assert expand_env("${B:-d}", env) == "d"
    assert expand_env("${A:-d}", env) == "1"
    assert expand_env("plain", env) == "plain"


def test_expand_env_unset_names_variable_not_values():
    with pytest.raises(AppError) as err:
        expand_env("${A}", {"SECRET": "hunter2"})
    assert str(err.value) == "needs A set in brain's environment"
    assert "hunter2" not in str(err.value)


def good_http(**over):
    return {
        "name": "Linear",
        "transport": "http",
        "config": {"url": "https://mcp.linear.app/mcp"},
        **over,
    }


def test_validate_http_scheme():
    row = validate_app(good_http())
    assert row == AppRow(
        "linear", "Linear", "http", {"url": "https://mcp.linear.app/mcp"}, "none", True
    )
    with pytest.raises(AppError, match="https"):
        validate_app(good_http(config={"url": "http://example.com"}))
    assert validate_app(good_http(config={"url": "http://localhost:3000"})).config["url"]
    assert validate_app(good_http(config={"url": "http://127.0.0.1:3000/x"}))


def test_validate_http_needs_url():
    with pytest.raises(AppError, match="url"):
        validate_app(good_http(config={}))


def test_validate_stdio():
    row = validate_app(
        {
            "name": "Files",
            "transport": "stdio",
            "config": {"command": "npx", "args": ["-y", "srv"], "env": {"K": "${K}"}},
            "auth": "none",
        }
    )
    assert row.config["env"] == {"K": "${K}"}  # refs stay verbatim
    with pytest.raises(AppError, match="command"):
        validate_app({"name": "F", "transport": "stdio", "config": {}})
    with pytest.raises(AppError, match="args"):
        validate_app({"name": "F", "transport": "stdio", "config": {"command": "x", "args": "no"}})


def test_validate_rejects_token_param():
    with pytest.raises(AppError, match="token"):
        validate_app(good_http(token="secret"))


def test_validate_rejects_bad_fields():
    with pytest.raises(AppError, match="name"):
        validate_app(good_http(name=" "))
    with pytest.raises(AppError, match="transport"):
        validate_app(good_http(transport="ftp"))
    with pytest.raises(AppError, match="auth"):
        validate_app(good_http(auth="basic"))


def test_validate_id_avoids_taken():
    assert validate_app(good_http(), taken={"linear"}).id == "linear-2"


def test_store_roundtrip(mem):
    row = validate_app(good_http())
    mem.add_app(row)
    assert mem.list_apps() == [row]
    mem.set_app_enabled("linear", False)
    assert mem.list_apps()[0].enabled is False
    mem.remove_app("linear")
    assert mem.list_apps() == []


def test_store_survives_reopen(tmp_path):
    m = Memory(tmp_path / "r.db")
    m.add_app(validate_app(good_http()))
    m.close()
    m = Memory(tmp_path / "r.db")
    assert m.list_apps()[0].config == {"url": "https://mcp.linear.app/mcp"}
    m.close()
