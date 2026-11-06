"""Tests for Home's reading_status tool: the cached reading rows as JSON."""

import json

from brain.protocol import ReadingData
from brain.reading import ReadingStore
from brain.reading_tools import reading_home_tools


def tool(store):
    ((spec, handler),) = reading_home_tools(store)
    return spec, handler


async def test_reading_status_returns_rows_as_json():
    store = ReadingStore()
    row = {"capability": "window-text", "engine": "windows-uia", "where": "this-pc"}
    store.set("desktop", ReadingData.model_validate({"rows": [{**row, "state": "working"}]}))
    spec, handler = tool(store)
    assert spec.name == "reading_status" and spec.audience == frozenset({"home"})
    assert spec.effect == "read"
    assert json.loads(await handler({})) == {"rows": [{**row, "state": "working"}]}


async def test_reading_status_returns_no_rows_without_a_body():
    _, handler = tool(ReadingStore())
    assert json.loads(await handler({})) == {"rows": []}
