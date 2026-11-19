"""Tests for Home's chat_since tool: the saved chat after an id, for a body catching up."""

import json

import pytest

from brain.chat_tools import chat_tools
from brain.store import conversation
from brain.store.db import open_db

AT = "2026-11-17T09:00:00+00:00"


@pytest.fixture
def rig(tmp_path):
    db = open_db(tmp_path / "t.db")
    ((spec, handler),) = chat_tools(db)
    yield db, spec, handler
    db.close()


def _save(db, n):
    msgs = [{"role": "assistant", "content": f"m{i}"} for i in range(n)]
    return conversation.save_messages(db, msgs, AT, sources=["desktop"] * n)


async def test_chat_since_shape_and_limit_cap(rig):
    db, _, handler = rig
    ids = _save(db, 60)
    out = json.loads(await handler({}))
    assert len(out["messages"]) == 20 and out["more"]
    assert out["messages"][-1] == {
        "id": str(ids[-1]),
        "role": "assistant",
        "text": "m59",
        "source": "desktop",
        "at": AT,
    }
    assert len(json.loads(await handler({"limit": 500}))["messages"]) == 50
    after = json.loads(await handler({"after_id": str(ids[57])}))
    assert [m["text"] for m in after["messages"]] == ["m58", "m59"] and not after["more"]


async def test_chat_since_is_home_only(rig):
    _, spec, _ = rig
    assert spec.name == "chat_since" and spec.audience == frozenset({"home"})
